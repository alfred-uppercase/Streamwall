import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapenaka-stores-test-'));
process.env.TAPENAKA_DB_FILE = path.join(tempDir, 'stores.sqlite');
process.env.TAPENAKA_SILENT_LOGS = '1';

const { clearErrorLogs, listErrorLogs, recordErrorLog, sanitizeLogContext } = await import(
  '../src/server/errorLogger.ts'
);
const {
  createDefaultPrivacyConfig,
  getPrivacyPageConfig,
  resetPrivacyPageConfig,
  sanitizePrivacyConfig,
  updatePrivacyPageConfig,
} = await import('../src/server/privacyStore.ts');
const {
  createBrokenReport,
  createOrVoteContentRequest,
  listBrokenReports,
  listContentRequests,
  toggleVoteContentRequest,
  updateBrokenReportStatus,
  updateContentRequestStatus,
} = await import('../src/server/requestsStore.ts');
const {
  getPushStats,
  getVapidPublicKey,
  removePushSubscription,
  syncPushSubscriptionProFlag,
  upsertPushSubscription,
} = await import('../src/server/webPushStore.ts');
const {
  acceptFriendRequest,
  cancelFriendRequest,
  cleanupUserFriendRequests,
  createOrMatchFriendRequest,
  declineFriendRequest,
  listUserFriendRequests,
} = await import('../src/server/friendsStore.ts');

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('errorLogger redacts sensitive fields, filters, counts, and clears logs', () => {
  clearErrorLogs();

  const redacted = sanitizeLogContext({
    email: 'user@example.com',
    password: 'super-secret-password',
    nested: {
      accessToken: 'jwt-token-value',
      apiKey: 'secret-api-key',
      safeField: 'visible',
    },
  }) as Record<string, unknown>;

  assert.equal(redacted.password, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).accessToken, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).apiKey, '[REDACTED]');
  assert.equal((redacted.nested as Record<string, unknown>).safeField, 'visible');

  recordErrorLog({
    level: 'fatal',
    source: 'api',
    message: 'Crash critique test',
    route: '/api/test',
    method: 'POST',
    statusCode: 500,
    context: { token: 'abc123', action: 'checkout' },
  });
  recordErrorLog({
    level: 'warn',
    source: 'upstream',
    message: 'Timeout TMDB test',
  });

  const all = listErrorLogs();
  assert.equal(all.counts.total, 2);
  assert.equal(all.counts.fatal, 1);
  assert.equal(all.counts.warn, 1);
  const fatalEntry = all.logs.find((l) => l.level === 'fatal');
  assert.equal(fatalEntry?.context?.token, '[REDACTED]');

  const filtered = listErrorLogs({ level: 'fatal', source: 'api' });
  assert.equal(filtered.logs.length, 1);
  assert.equal(filtered.logs[0]?.message, 'Crash critique test');

  const deleted = clearErrorLogs();
  assert.equal(deleted, 2);
  assert.equal(listErrorLogs().counts.total, 0);
});

test('privacyStore provides defaults, sanitizes updates, and resets cleanly', () => {
  const defaults = createDefaultPrivacyConfig();
  assert.equal(defaults.sections.length, 4);
  const initial = getPrivacyPageConfig();
  assert.equal(initial.sections.length, 4);

  const sanitized = sanitizePrivacyConfig({
    title: '  Confidentialité Custom  ',
    sections: [
      {
        id: 'sec-custom',
        title: 'Ma Section',
        items: [
          {
            id: 'it-1',
            icon: 'not-a-valid-icon',
            title: 'Point test',
            description: 'Description test',
            technicalDetails: 'AES-256',
          },
        ],
      },
    ],
  });
  assert.equal(sanitized.title, 'Confidentialité Custom');
  assert.equal(sanitized.sections[0]?.items[0]?.icon, 'shield');

  const updated = updatePrivacyPageConfig(sanitized);
  assert.equal(updated.title, 'Confidentialité Custom');
  assert.equal(getPrivacyPageConfig().sections.length, 1);

  const reset = resetPrivacyPageConfig();
  assert.equal(reset.sections.length, 4);
});

test('requestsStore persists broken reports, content requests, and merges duplicate votes', () => {
  const report = createBrokenReport({
    itemType: 'serie',
    itemId: '9650',
    itemTitle: 'GIFT',
    season: 1,
    episode: 2,
    reason: 'Lecteur hors ligne',
    comment: 'Erreur 404 sur le lecteur',
    userId: null,
    username: 'Testeur',
  });
  assert.equal(report.status, 'pending');
  assert.equal(listBrokenReports().length, 1);

  const resolved = updateBrokenReportStatus(report.id, 'resolved', 'Lien remplacé');
  assert.equal(resolved?.status, 'resolved');
  assert.equal(resolved?.adminNote, 'Lien remplacé');

  const first = createOrVoteContentRequest({
    mediaType: 'film',
    title: 'Inception',
    year: 2010,
    tmdbId: '27205',
    viewerKey: 'v:guest-1',
    username: 'Invité 1',
  });
  assert.equal(first.merged, false);
  assert.equal(first.request.votes, 1);

  const duplicate = createOrVoteContentRequest({
    mediaType: 'film',
    title: 'inception',
    year: 2010,
    tmdbId: '27205',
    viewerKey: 'v:guest-2',
    username: 'Invité 2',
  });
  assert.equal(duplicate.merged, true);
  assert.equal(duplicate.request.votes, 2);

  const toggledOff = toggleVoteContentRequest(first.request.id, 'v:guest-2');
  assert.equal(toggledOff?.votes, 1);

  const added = updateContentRequestStatus(first.request.id, {
    status: 'added',
    resolvedItemUrl: '/film/24417',
  });
  assert.equal(added?.status, 'added');
  assert.equal(listContentRequests().length, 1);
});

test('webPushStore manages VAPID key, member/guest subscriptions, Pro sync, and cleanup', () => {
  const publicKey = getVapidPublicKey();
  assert.ok(publicKey.length > 30);

  upsertPushSubscription({
    endpoint: 'https://push.example.com/sub-guest',
    p256dh: 'guest-p256dh',
    auth: 'guest-auth',
    userId: null,
    isPro: false,
    userAgent: 'Mozilla/5.0 Chrome Windows',
  });
  upsertPushSubscription({
    endpoint: 'https://push.example.com/sub-member',
    p256dh: 'member-p256dh',
    auth: 'member-auth',
    userId: 'user-42',
    isPro: false,
    userAgent: 'Mozilla/5.0 Firefox Linux',
  });

  let stats = getPushStats();
  assert.equal(stats.totalDevices, 2);
  assert.equal(stats.guestDevices, 1);
  assert.equal(stats.memberDevices, 1);
  assert.equal(stats.proDevices, 0);

  syncPushSubscriptionProFlag('user-42', true);
  stats = getPushStats();
  assert.equal(stats.proDevices, 1);

  assert.equal(removePushSubscription('https://push.example.com/sub-guest'), true);
  assert.equal(removePushSubscription('https://push.example.com/sub-member'), true);
  assert.equal(getPushStats().totalDevices, 0);
});

test('friendsStore handles requests, permission guards, decline, cancel, and mutual match', () => {
  const alice = { id: 'u-alice', username: 'alice', avatar: null, isPro: false };
  const bob = { id: 'u-bob', username: 'bob', avatar: null, isPro: true };
  const charlie = { id: 'u-charlie', username: 'charlie', avatar: null, isPro: false };

  const created = createOrMatchFriendRequest({ fromUser: alice, toUser: bob });
  assert.equal(created.outcome, 'created');
  assert.ok(created.request);
  assert.equal(listUserFriendRequests(alice.id).outgoing.length, 1);
  assert.equal(listUserFriendRequests(bob.id).incoming.length, 1);

  // Duplicate outgoing returns already_pending without duplicating
  const dup = createOrMatchFriendRequest({ fromUser: alice, toUser: bob });
  assert.equal(dup.outcome, 'already_pending');
  assert.equal(listUserFriendRequests(bob.id).incoming.length, 1);

  // Sender cannot accept their own request
  const unauthorized = acceptFriendRequest(created.request.id, alice.id);
  assert.equal(unauthorized.ok, false);

  // Bob declines; Alice can send again later
  const declined = declineFriendRequest(created.request.id, bob.id);
  assert.equal(declined.ok, true);
  assert.equal(listUserFriendRequests(bob.id).incoming.length, 0);

  const reRequested = createOrMatchFriendRequest({ fromUser: alice, toUser: bob });
  assert.equal(reRequested.outcome, 'created');
  assert.ok(reRequested.request);

  // Bob accepts
  const accepted = acceptFriendRequest(reRequested.request.id, bob.id);
  assert.equal(accepted.ok, true);
  assert.equal(listUserFriendRequests(bob.id).incoming.length, 0);

  // Mutual auto-accept when Charlie asks Alice, then Alice asks Charlie
  const cToA = createOrMatchFriendRequest({ fromUser: charlie, toUser: alice });
  assert.equal(cToA.outcome, 'created');
  const aToC = createOrMatchFriendRequest({ fromUser: alice, toUser: charlie });
  assert.equal(aToC.outcome, 'matched_accept');
  assert.equal(listUserFriendRequests(alice.id).incoming.length, 0);

  // Cancel test
  const bToC = createOrMatchFriendRequest({ fromUser: bob, toUser: charlie });
  assert.ok(bToC.request);
  const cancelled = cancelFriendRequest(bToC.request.id, bob.id);
  assert.equal(cancelled.ok, true);
  assert.equal(listUserFriendRequests(charlie.id).incoming.length, 0);

  cleanupUserFriendRequests(alice.id);
  cleanupUserFriendRequests(bob.id);
  cleanupUserFriendRequests(charlie.id);
});
