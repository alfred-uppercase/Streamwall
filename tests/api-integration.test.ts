import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tapenaka-api-test-'));
process.env.TAPENAKA_DB_FILE = path.join(tempDir, 'api.sqlite');
process.env.TAPENAKA_DISABLE_AUTOSTART = '1';
process.env.TAPENAKA_SILENT_LOGS = '1';

const { createApiApp } = await import('../server.ts');
const { listErrorLogs } = await import('../src/server/errorLogger.ts');

let server: http.Server;
let baseUrl = '';

test.before(async () => {
  const app = await createApiApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('GET /api/health responds 200 OK', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as { ok: boolean; db: string };
  assert.equal(json.ok, true);
  assert.equal(json.db, 'sqlite');
});

test('Admin endpoints reject unauthenticated callers', async () => {
  const logsRes = await fetch(`${baseUrl}/api/admin/logs`);
  assert.ok(logsRes.status === 401 || logsRes.status === 403);

  const privacyAdminRes = await fetch(`${baseUrl}/api/admin/privacy`);
  assert.ok(privacyAdminRes.status === 401 || privacyAdminRes.status === 403);
});

test('GET /api/privacy returns structured sections and items', async () => {
  const res = await fetch(`${baseUrl}/api/privacy`);
  assert.equal(res.status, 200);
  const json = (await res.json()) as {
    privacy: { title: string; sections: Array<{ title: string; items: unknown[] }> };
  };
  assert.equal(json.privacy.sections.length, 4);
  assert.ok(json.privacy.sections.every((s) => s.items.length >= 3));
});

test('POST /api/client-errors validates input and persists redacted browser errors', async () => {
  const badRes = await fetch(`${baseUrl}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });
  assert.equal(badRes.status, 400);

  const okRes = await fetch(`${baseUrl}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: 'error',
      message: 'TypeError test navigateur',
      route: '/film/24417',
      stack: 'at DetailPage (DetailPage.tsx:120:5)',
      context: { password: 'should-be-redacted', action: 'play' },
    }),
  });
  assert.equal(okRes.status, 200);
  const okJson = (await okRes.json()) as { ok: boolean; id: string };
  assert.equal(okJson.ok, true);
  assert.ok(okJson.id.startsWith('err_'));

  const stored = listErrorLogs({ source: 'client', q: 'TypeError test navigateur' });
  assert.equal(stored.logs.length, 1);
  assert.equal(stored.logs[0]?.route, '/film/24417');
  assert.equal(stored.logs[0]?.context?.password, '[REDACTED]');
});

test('Push Web subscribe/unsubscribe API validates and persists', async () => {
  const keyRes = await fetch(`${baseUrl}/api/push/vapid-public-key`);
  assert.equal(keyRes.status, 200);
  const keyJson = (await keyRes.json()) as { publicKey: string };
  assert.ok(keyJson.publicKey.length > 30);

  const invalidRes = await fetch(`${baseUrl}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'http://insecure.example.com' }),
  });
  assert.equal(invalidRes.status, 400);

  const endpoint = 'https://fcm.googleapis.com/fcm/send/integration-test-sub';
  const subRes = await fetch(`${baseUrl}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
    }),
  });
  assert.equal(subRes.status, 200);

  const unsubRes = await fetch(`${baseUrl}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  assert.equal(unsubRes.status, 200);
});

test('Broken stream report & content request APIs block guests (401) and succeed for authenticated members', async () => {
  // Guests must receive 401
  const guestReport = await fetch(`${baseUrl}/api/reports/broken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemType: 'film',
      itemId: '24417',
      itemTitle: 'Les Vacances de Golo & Ritchie',
      reason: 'Lien mort',
    }),
  });
  assert.equal(guestReport.status, 401);

  const guestRequest = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType: 'serie', title: 'Severance' }),
  });
  assert.equal(guestRequest.status, 401);

  const guestVote = await fetch(`${baseUrl}/api/requests/nonexistent/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(guestVote.status, 401);

  // Sign in as demo member
  const loginRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  assert.equal(loginRes.status, 200);
  const { token } = (await loginRes.json()) as { token: string };
  assert.ok(token);

  const invalidReport = await fetch(`${baseUrl}/api/reports/broken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ itemType: 'film', itemId: '' }),
  });
  assert.equal(invalidReport.status, 400);

  const validReport = await fetch(`${baseUrl}/api/reports/broken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      itemType: 'film',
      itemId: '24417',
      itemTitle: 'Les Vacances de Golo & Ritchie',
      reason: 'Lien mort',
      comment: 'Test automatisé',
    }),
  });
  assert.equal(validReport.status, 200);

  const validRequest = await fetch(`${baseUrl}/api/requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mediaType: 'serie',
      title: 'Severance',
      year: 2022,
    }),
  });
  assert.equal(validRequest.status, 200);
  const reqJson = (await validRequest.json()) as { request: { id: string; votes: number } };
  assert.equal(reqJson.request.votes, 1);

  const memberVote = await fetch(`${baseUrl}/api/requests/${reqJson.request.id}/vote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(memberVote.status, 200);
});

test('Friend requests notify recipient, require acceptance, and create mutual friendship', async () => {
  const memberLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const memberAuth = (await memberLogin.json()) as {
    token: string;
    user: { id: string; username: string };
  };

  const adminLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminLogin.json()) as {
    token: string;
    user: { id: string; username: string };
  };

  assert.notEqual(memberAuth.user.id, adminAuth.user.id);

  // Clear any pre-seeded friendship between the two demo accounts first
  await fetch(`${baseUrl}/api/friends/${adminAuth.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });

  // Member sends friend request to Admin
  const sendRes = await fetch(`${baseUrl}/api/friends`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ friendId: adminAuth.user.id }),
  });
  assert.equal(sendRes.status, 200);
  const sendJson = (await sendRes.json()) as {
    ok: boolean;
    status: string;
    request: { id: string };
  };
  assert.equal(sendJson.status, 'pending');
  const requestId = sendJson.request.id;

  // Admin receives friend_request notification + incoming request in /api/member
  const adminNotifRes = await fetch(`${baseUrl}/api/notifications`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const adminNotifs = (await adminNotifRes.json()) as {
    notifications: Array<{ kind: string; title: string }>;
  };
  assert.ok(adminNotifs.notifications.some((n) => n.kind === 'friend_request'));

  const adminMemberRes = await fetch(`${baseUrl}/api/member`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const adminMemberData = (await adminMemberRes.json()) as {
    incomingFriendRequests: Array<{ id: string; fromUserId: string }>;
    friends: Array<{ id: string }>;
  };
  assert.ok(adminMemberData.incomingFriendRequests.some((r) => r.id === requestId));
  assert.equal(
    adminMemberData.friends.some((f) => f.id === memberAuth.user.id),
    false
  );

  // Admin accepts request
  const acceptRes = await fetch(`${baseUrl}/api/friends/requests/${requestId}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(acceptRes.status, 200);

  // Both users now see each other as mutual friends, and Member receives friend_accepted notification
  const [memberAfterRes, adminAfterRes, memberNotifRes] = await Promise.all([
    fetch(`${baseUrl}/api/member`, { headers: { Authorization: `Bearer ${memberAuth.token}` } }),
    fetch(`${baseUrl}/api/member`, { headers: { Authorization: `Bearer ${adminAuth.token}` } }),
    fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    }),
  ]);
  const memberAfter = (await memberAfterRes.json()) as { friends: Array<{ id: string }> };
  const adminAfter = (await adminAfterRes.json()) as { friends: Array<{ id: string }> };
  const memberNotifs = (await memberNotifRes.json()) as {
    notifications: Array<{ kind: string }>;
  };

  assert.ok(memberAfter.friends.some((f) => f.id === adminAuth.user.id));
  assert.ok(adminAfter.friends.some((f) => f.id === memberAuth.user.id));
  assert.ok(memberNotifs.notifications.some((n) => n.kind === 'friend_accepted'));

  // Mutual friend removal removes both directions
  const removeRes = await fetch(`${baseUrl}/api/friends/${adminAuth.user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(removeRes.status, 200);
  const adminAfterRemove = (await (
    await fetch(`${baseUrl}/api/member`, { headers: { Authorization: `Bearer ${adminAuth.token}` } })
  ).json()) as { friends: Array<{ id: string }> };
  assert.equal(
    adminAfterRemove.friends.some((f) => f.id === memberAuth.user.id),
    false
  );
});
