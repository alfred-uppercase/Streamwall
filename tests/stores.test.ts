import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapenaka-stores-test-'));
process.env.TAPENAKA_DB_FILE = path.join(tempDir, 'stores.sqlite');
process.env.TAPENAKA_SILENT_LOGS = '1';

const {
  isRemoteMirrorAllowed,
  readModuleSnapshot,
  writeModuleSnapshot,
} = await import('../src/server/persistentDb.ts');
const { InFlightCoalescer, TimedLruCache } = await import('../src/server/cacheUtils.ts');
const { sbResolveUser } = await import('../src/server/supabaseAdapter.ts');
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
const {
  DEFAULT_PINOY_DOWNLOAD_MESSAGE,
  DEFAULT_PINOY_MEDIA_BASE_URL,
  DEFAULT_PINOY_PLAYER_TEMPLATE,
  validatePinoyApiUrl,
  validatePinoyMediaBaseUrl,
  validatePinoyPlayerTemplate,
  resolvePinoyPlayerUrl,
  embedToDirectDownloadUrl,
  isDirectDownloadUrl,
  sanitizePinoyDownloadMessage,
  sanitizeExternalHttpUrl,
  resolvePinoyMediaUrl,
  fetchPinoyFacets,
  fetchPinoyList,
  fetchPinoyDetail,
} = await import('../src/server/pinoyService.ts');

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

test('persistentDb blocks high-churn analytics and store modules from Supabase app_settings mirroring', () => {
  assert.equal(isRemoteMirrorAllowed('analytics'), false);
  assert.equal(isRemoteMirrorAllowed('store'), false);
  assert.equal(isRemoteMirrorAllowed('notifications'), false);
  assert.equal(isRemoteMirrorAllowed('mail_logs'), false);
  assert.equal(isRemoteMirrorAllowed('pending_signups'), false);
  assert.equal(isRemoteMirrorAllowed('otp_challenges'), false);
  assert.equal(isRemoteMirrorAllowed('email_cooldowns'), false);

  assert.equal(isRemoteMirrorAllowed('billing'), true);
  assert.equal(isRemoteMirrorAllowed('popups'), true);
  assert.equal(isRemoteMirrorAllowed('privacy'), true);

  writeModuleSnapshot('analytics', { test: true, count: 42 });
  const loaded = readModuleSnapshot<{ test: boolean; count: number }>('analytics');
  assert.deepEqual(loaded, { test: true, count: 42 });
});

test('sbResolveUser rejects malformed or expired JWTs locally without hitting Supabase Auth', async () => {
  assert.equal(await sbResolveUser(null), null);
  assert.equal(await sbResolveUser('not-a-jwt'), null);

  const expiredPayload = Buffer.from(
    JSON.stringify({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 })
  ).toString('base64url');
  const expiredJwt = `eyJhbGciOiJIUzI1NiJ9.${expiredPayload}.sig`;
  assert.equal(await sbResolveUser(expiredJwt), null);
});

test('TimedLruCache evicts oldest entry, keeps stale fallback, and supports prefix deletion', async () => {
  const cache = new TimedLruCache<string>(16);
  for (let i = 0; i < 20; i++) {
    cache.set(`k:${i}`, `val-${i}`, 5_000, 10_000);
  }
  assert.equal(cache.size, 16);
  assert.equal(cache.get('k:0'), null);
  assert.equal(cache.get('k:19'), 'val-19');

  cache.set('short:1', 'fresh', 5, 5_000);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cache.get('short:1'), null);
  assert.equal(cache.getStale('short:1'), 'fresh');

  assert.ok(cache.deleteByPrefix('k:') >= 15);
  assert.equal(cache.get('k:19'), null);
});

test('InFlightCoalescer deduplicates concurrent calls and clears on success or error', async () => {
  const coalescer = new InFlightCoalescer();
  let calls = 0;

  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      coalescer.run('hot-key', async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return 'shared-payload';
      })
    )
  );

  assert.equal(calls, 1);
  assert.equal(results.length, 50);
  assert.ok(results.every((r) => r === 'shared-payload'));
  assert.equal(coalescer.activeCount, 0);

  await assert.rejects(
    () =>
      coalescer.run('err-key', async () => {
        throw new Error('boom');
      }),
    /boom/
  );
  assert.equal(coalescer.activeCount, 0);
});

test('Security module enforces single-use SVG CAPTCHA, 3-attempt login lockout, and injection sanitization', async () => {
  const {
    checkLoginLockout,
    clearLoginFailures,
    consumeRateLimit,
    createCaptchaChallenge,
    escapeHtml,
    hasPathTraversalProbe,
    hasSqlInjectionProbe,
    hasXssProbe,
    isHoneypotTriggered,
    isSuspiciousBotUserAgent,
    peekCaptchaAnswerForTest,
    recordLoginFailure,
    resetRateLimitsForTest,
    sanitizeJsonPayload,
    sanitizeSafeUrl,
    stripDangerousText,
    verifyCaptchaChallenge,
  } = await import('../src/server/security.ts');

  resetRateLimitsForTest();

  // 1. Cryptographic SVG CAPTCHA
  const challenge = createCaptchaChallenge('10.0.0.5');
  assert.ok(challenge.captchaToken.includes('.'));
  assert.ok(challenge.svgDataUri.startsWith('data:image/svg+xml;base64,'));
  const answer = peekCaptchaAnswerForTest(challenge.captchaToken);
  assert.ok(answer && answer.length === 5);

  // Wrong answer rejected & consumes single-use token
  const wrong = verifyCaptchaChallenge({
    captchaToken: challenge.captchaToken,
    captchaAnswer: 'ZZZZZ',
    ip: '10.0.0.5',
    minSolveMs: 0,
  });
  assert.equal(wrong.ok, false);

  const replay = verifyCaptchaChallenge({
    captchaToken: challenge.captchaToken,
    captchaAnswer: answer,
    ip: '10.0.0.5',
    minSolveMs: 0,
  });
  assert.equal(replay.ok, false);

  // Fresh token succeeds once, then replay fails
  const fresh = createCaptchaChallenge('10.0.0.5');
  const freshAns = peekCaptchaAnswerForTest(fresh.captchaToken)!;
  assert.equal(
    verifyCaptchaChallenge({
      captchaToken: fresh.captchaToken,
      captchaAnswer: freshAns.toLowerCase(),
      ip: '10.0.0.5',
      minSolveMs: 0,
    }).ok,
    true
  );
  assert.equal(
    verifyCaptchaChallenge({
      captchaToken: fresh.captchaToken,
      captchaAnswer: freshAns,
      ip: '10.0.0.5',
      minSolveMs: 0,
    }).ok,
    false
  );

  // 2. 3-attempt login lockout
  const email = 'sec-user@example.com';
  const ip = '10.0.0.8';
  assert.equal(checkLoginLockout(email, ip).locked, false);
  assert.equal(recordLoginFailure(email, ip).remainingAttempts, 2);
  assert.equal(recordLoginFailure(email, ip).remainingAttempts, 1);
  const third = recordLoginFailure(email, ip);
  assert.equal(third.locked, true);
  assert.equal(third.remainingAttempts, 0);
  assert.ok(third.retryAfterSeconds > 60);
  assert.equal(checkLoginLockout(email, ip).locked, true);

  clearLoginFailures(email, ip);
  assert.equal(checkLoginLockout(email, ip).locked, false);

  // 3. Injection, XSS, prototype pollution, URL, bot UA, and rate limits
  assert.equal(hasSqlInjectionProbe("' OR '1'='1"), true);
  assert.equal(hasSqlInjectionProbe('1 UNION SELECT password FROM users'), true);
  assert.equal(hasSqlInjectionProbe('Spider-Man: No Way Home'), false);

  assert.equal(hasXssProbe('<script>alert(1)</script>'), true);
  assert.equal(hasXssProbe('javascript:alert(1)'), true);
  assert.equal(hasPathTraversalProbe('../../etc/passwd'), true);

  assert.equal(isSuspiciousBotUserAgent('python-requests/2.31.0'), true);
  assert.equal(isSuspiciousBotUserAgent('sqlmap/1.7'), true);
  assert.equal(
    isSuspiciousBotUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36'),
    false
  );
  assert.equal(isHoneypotTriggered({ website: 'https://spam.example' }), true);
  assert.equal(isHoneypotTriggered({ website: '' }), false);

  const sanitizedObj = sanitizeJsonPayload({
    safe: 'ok\0test',
    __proto__: { polluted: true },
    constructor: 'bad',
  });
  assert.equal(sanitizedObj.blocked, false);
  const cleanRecord = sanitizedObj.clean as Record<string, unknown>;
  assert.equal(cleanRecord.safe, 'oktest');
  assert.equal(Object.prototype.hasOwnProperty.call(cleanRecord, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cleanRecord, 'constructor'), false);

  assert.equal(sanitizeSafeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeSafeUrl('https://streamwall.example/film/1'), 'https://streamwall.example/film/1');
  assert.equal(sanitizeSafeUrl('/film/24417'), '/film/24417');
  assert.equal(stripDangerousText('<script>xss()</script>Bonjour'), 'Bonjour');
  assert.equal(escapeHtml('<img src=x onerror="1">'), '&lt;img src=x onerror=&quot;1&quot;&gt;');

  assert.equal(consumeRateLimit('test-ip', 2, 10_000).allowed, true);
  assert.equal(consumeRateLimit('test-ip', 2, 10_000).allowed, true);
  assert.equal(consumeRateLimit('test-ip', 2, 10_000).allowed, false);
});

test('pinoyService validates URLs safely, sanitizes media/player URLs, and handles unconfigured state', async () => {
  // SSRF / internal addresses & bad schemes blocked
  assert.equal(validatePinoyApiUrl('http://127.0.0.1/korotoko_ph.php').ok, false);
  assert.equal(validatePinoyApiUrl('http://localhost/korotoko_ph.php').ok, false);
  assert.equal(validatePinoyApiUrl('http://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(validatePinoyApiUrl('http://192.168.1.10/korotoko_ph.php').ok, false);
  assert.equal(validatePinoyApiUrl('ftp://example.com/korotoko_ph.php').ok, false);
  assert.equal(validatePinoyApiUrl('https://user:pass@example.com/korotoko_ph.php').ok, false);

  // Empty allowed (clears configuration) and public HTTPS allowed
  assert.deepEqual(validatePinoyApiUrl(''), { ok: true, url: '' });
  const valid = validatePinoyApiUrl('https://example.com/korotoko_ph.php#frag');
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.url, 'https://example.com/korotoko_ph.php');
  }

  // External HTTP(S) sanitization & media domain resolution
  assert.equal(sanitizeExternalHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalHttpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeExternalHttpUrl('https://cdn.example.com/poster.jpg'), 'https://cdn.example.com/poster.jpg');

  assert.equal(validatePinoyMediaBaseUrl('http://127.0.0.1/').ok, false);
  const validMedia = validatePinoyMediaBaseUrl('https://streamwall.behoririka.mg');
  assert.equal(validMedia.ok, true);
  if (validMedia.ok) {
    assert.equal(validMedia.url, DEFAULT_PINOY_MEDIA_BASE_URL);
  }
  assert.equal(
    resolvePinoyMediaUrl('uploads/pinoy/posters/milf-2026.jpg', DEFAULT_PINOY_MEDIA_BASE_URL),
    'https://streamwall.behoririka.mg/uploads/pinoy/posters/milf-2026.jpg'
  );
  assert.equal(
    resolvePinoyMediaUrl('/uploads/pinoy/galerie/frame-1.jpg', 'https://cdn.example.com/media'),
    'https://cdn.example.com/media/uploads/pinoy/galerie/frame-1.jpg'
  );
  assert.equal(
    resolvePinoyMediaUrl(
      'https://api.example.com/sub/uploads/pinoy/posters/milf-2026.jpg',
      'https://streamwall.behoririka.mg/',
      'https://api.example.com/sub/korotoko_ph.php'
    ),
    'https://streamwall.behoririka.mg/uploads/pinoy/posters/milf-2026.jpg'
  );
  assert.equal(
    resolvePinoyMediaUrl('https://image.tmdb.org/t/p/w500/poster.jpg', 'https://streamwall.behoririka.mg/'),
    'https://image.tmdb.org/t/p/w500/poster.jpg'
  );
  assert.equal(resolvePinoyMediaUrl('../secret/passwd', DEFAULT_PINOY_MEDIA_BASE_URL), null);
  assert.equal(resolvePinoyMediaUrl('javascript:alert(1)', DEFAULT_PINOY_MEDIA_BASE_URL), null);

  // Pinoy player template validation & {id} substitution
  assert.equal(validatePinoyPlayerTemplate('http://127.0.0.1/pinoy/{id}').ok, false);
  assert.equal(validatePinoyPlayerTemplate(DEFAULT_PINOY_PLAYER_TEMPLATE).ok, true);
  assert.equal(
    resolvePinoyPlayerUrl(DEFAULT_PINOY_PLAYER_TEMPLATE, { id: 15, slug: 'milf-2026' }),
    'https://streamwall.behoririka.mg/pinoy/15'
  );
  assert.equal(
    resolvePinoyPlayerUrl('https://player.example.com/pinoy', { id: 15, slug: 'milf-2026' }),
    'https://player.example.com/pinoy/15'
  );

  // Embed -> direct download link conversions (VOE, StreamHLS, Dood/Playmogo, Abstream)
  assert.equal(
    embedToDirectDownloadUrl('https://voe.sx/e/3od2eqbnmolo', 'Voe'),
    'https://voe.sx/3od2eqbnmolo/download'
  );
  assert.equal(
    embedToDirectDownloadUrl('https://streamhls.to/e/1ghcfvwm4xlk', 'StreamHLS'),
    'https://savefiles.com/d/1ghcfvwm4xlk_n'
  );
  assert.equal(
    embedToDirectDownloadUrl('https://playmogo.com/e/46l0enjz7f65', 'Dood'),
    'https://playmogo.com/d/46l0enjz7f65'
  );
  assert.equal(
    embedToDirectDownloadUrl('https://abstream.to/embed/5q3v8q1q23zr', 'Abstream'),
    'https://abstream.to/d/5q3v8q1q23zr'
  );

  // Only direct download links are allowed in the download section
  assert.equal(isDirectDownloadUrl('https://voe.sx/3od2eqbnmolo/download'), true);
  assert.equal(isDirectDownloadUrl('https://savefiles.com/d/1ghcfvwm4xlk_n'), true);
  assert.equal(isDirectDownloadUrl('https://playmogo.com/d/46l0enjz7f65'), true);
  assert.equal(isDirectDownloadUrl('https://abstream.to/d/5q3v8q1q23zr'), true);
  assert.equal(isDirectDownloadUrl('https://random-mirror.example.com/watch/123'), false);
  assert.equal(isDirectDownloadUrl('https://voe.sx/e/3od2eqbnmolo'), false);

  // Download restriction message sanitization
  assert.equal(sanitizePinoyDownloadMessage(''), DEFAULT_PINOY_DOWNLOAD_MESSAGE);
  assert.equal(sanitizePinoyDownloadMessage('   '), DEFAULT_PINOY_DOWNLOAD_MESSAGE);
  assert.equal(
    sanitizePinoyDownloadMessage('Téléchargement réservé\x00 aux membres Pro.'),
    'Téléchargement réservé aux membres Pro.'
  );

  // Empty URL returns unconfigured cleanly without network calls
  const facets = await fetchPinoyFacets('');
  assert.equal(facets.status, 'unconfigured');
  const list = await fetchPinoyList('', { page: 1, q: '', genre: '', pays: '', annee: '', sort: 'recent' });
  assert.equal(list.status, 'unconfigured');
  assert.deepEqual(list.items, []);
  const detail = await fetchPinoyDetail('', 'demo-film');
  assert.equal(detail.status, 'unconfigured');
  assert.equal(detail.film, null);
});


