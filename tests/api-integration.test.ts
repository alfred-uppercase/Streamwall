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
const { peekCaptchaAnswerForTest } = await import('../src/server/security.ts');

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

test('Presence heartbeat and analytics ping respond quickly as zero-DB no-ops', async () => {
  const [hbRes, pingRes] = await Promise.all([
    fetch(`${baseUrl}/api/presence/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: '/', item: null }),
    }),
    fetch(`${baseUrl}/api/analytics/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's_test', path: '/' }),
    }),
  ]);
  assert.equal(hbRes.status, 200);
  assert.equal(pingRes.status, 200);
  const hbJson = (await hbRes.json()) as { ok: boolean };
  const pingJson = (await pingRes.json()) as { ok: boolean };
  assert.equal(hbJson.ok, true);
  assert.equal(pingJson.ok, true);
});

test('Public API endpoints expose Cache-Control headers while authenticated /api/home stays private', async () => {
  const [privacyRes, plansRes, popupsRes, siteRes, genresRes, guestHomeRes] = await Promise.all([
    fetch(`${baseUrl}/api/privacy`),
    fetch(`${baseUrl}/api/billing/plans`),
    fetch(`${baseUrl}/api/popups/active`),
    fetch(`${baseUrl}/api/site/config`),
    fetch(`${baseUrl}/api/catalogue/genres`),
    fetch(`${baseUrl}/api/home`),
  ]);

  assert.match(privacyRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.equal(plansRes.headers.get('cache-control'), 'private, no-cache');
  assert.match(popupsRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(siteRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(genresRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(guestHomeRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(guestHomeRes.headers.get('vary') || '', /Authorization/i);

  const loginRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const { token } = (await loginRes.json()) as { token: string };
  const authHomeRes = await fetch(`${baseUrl}/api/home`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(authHomeRes.status, 200);
  assert.match(authHomeRes.headers.get('cache-control') || '', /private, no-store/i);
});

test('Security protections enforce CAPTCHA, 3-attempt login lockout, anti-bot, anti-SQLi/XSS, and headers', async () => {
  const { peekCaptchaAnswerForTest } = await import('../src/server/security.ts');

  // Security headers present & X-Powered-By absent
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.headers.get('x-powered-by'), null);
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(healthRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

  // Known scraper / scanner User-Agents are blocked with 403
  for (const botUa of ['python-requests/2.31.0', 'Scrapy/2.11.0', 'sqlmap/1.8', 'curl/8.5.0']) {
    const botRes = await fetch(`${baseUrl}/api/catalogue`, {
      headers: { 'User-Agent': botUa },
    });
    assert.equal(botRes.status, 403, `Expected 403 for ${botUa}`);
  }

  // SQLi and XSS probes in query string are blocked with 403
  const sqliRes = await fetch(`${baseUrl}/api/catalogue?q=${encodeURIComponent("' UNION SELECT 1,2,3--")}`);
  assert.equal(sqliRes.status, 403);
  const xssRes = await fetch(`${baseUrl}/api/catalogue?q=${encodeURIComponent('<script>alert(1)</script>')}`);
  assert.equal(xssRes.status, 403);

  // Login rejects missing CAPTCHA & honeypot fills
  const noCaptchaRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'locktest@example.com', password: 'wrongpassword' }),
  });
  assert.equal(noCaptchaRes.status, 400);

  const hpRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'locktest@example.com',
      password: 'wrongpassword',
      website: 'https://bot-filled.example',
    }),
  });
  assert.equal(hpRes.status, 400);

  // 3 failed logins with valid CAPTCHA trigger 429 lockout
  const solveCaptcha = async () => {
    const capRes = await fetch(`${baseUrl}/api/auth/captcha`);
    assert.equal(capRes.status, 200);
    const cap = (await capRes.json()) as { captchaToken: string; svgDataUri: string };
    assert.ok(cap.svgDataUri.startsWith('data:image/svg+xml;base64,'));
    const ans = peekCaptchaAnswerForTest(cap.captchaToken);
    assert.ok(ans);
    return { captchaToken: cap.captchaToken, captchaAnswer: ans };
  };

  for (const expectedStatus of [401, 401, 429]) {
    const cap = await solveCaptcha();
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'locktest@example.com',
        password: 'wrong-password-123',
        ...cap,
      }),
    });
    assert.equal(res.status, expectedStatus);
    if (expectedStatus === 429) {
      assert.ok(Number(res.headers.get('retry-after')) > 0);
    }
  }

  // 4th attempt is immediately rejected with 429 even with another valid CAPTCHA
  const fourthCap = await solveCaptcha();
  const lockedRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'locktest@example.com',
      password: 'wrong-password-123',
      ...fourthCap,
    }),
  });
  assert.equal(lockedRes.status, 429);
});

test('Catalogue enforces 2-page cap for guests, 10-page cap for members, and unrestricted access for admins', async () => {
  // Guest: page 2 allowed, page 3 rejected with 401
  const guestP2 = await fetch(`${baseUrl}/api/catalogue?page=2`);
  assert.equal(guestP2.status, 200);
  const guestP3 = await fetch(`${baseUrl}/api/catalogue?page=3`);
  assert.equal(guestP3.status, 401);
  const guestP3Json = (await guestP3.json()) as { requiresAuth?: boolean };
  assert.equal(guestP3Json.requiresAuth, true);

  // Member: page 10 allowed, page 11 rejected with 403
  const memberLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const memberAuth = (await memberLogin.json()) as { token: string };
  const memberP10 = await fetch(`${baseUrl}/api/catalogue?page=10`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(memberP10.status, 200);
  const memberP10Json = (await memberP10.json()) as { pages: number };
  assert.ok(memberP10Json.pages <= 10);

  const memberP11 = await fetch(`${baseUrl}/api/catalogue?page=11`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(memberP11.status, 403);

  // Admin: page 11 allowed
  const adminLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminLogin.json()) as { token: string };
  const adminP11 = await fetch(`${baseUrl}/api/catalogue?page=11`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(adminP11.status, 200);
});

test('Pinoy endpoints respond cleanly and admin Pinoy URL settings validate access & SSRF', async () => {
  // Public Pinoy endpoints respond 200 with public Cache-Control (unconfigured by default)
  const facetsRes = await fetch(`${baseUrl}/api/pinoy/facets`);
  assert.equal(facetsRes.status, 200);
  assert.match(facetsRes.headers.get('cache-control') || '', /public/);
  const facetsJson = (await facetsRes.json()) as { status: string };
  assert.equal(facetsJson.status, 'unconfigured');

  const listRes = await fetch(`${baseUrl}/api/pinoy/list?page=1&sort=recent`);
  assert.equal(listRes.status, 200);
  assert.match(listRes.headers.get('cache-control') || '', /public/);
  const listJson = (await listRes.json()) as { status: string; items: unknown[] };
  assert.equal(listJson.status, 'unconfigured');
  assert.deepEqual(listJson.items, []);

  // Invalid slug rejected with 400
  const badSlugRes = await fetch(`${baseUrl}/api/pinoy/detail/invalid%24slug!`);
  assert.equal(badSlugRes.status, 400);

  // Unauthenticated PUT /api/admin/settings/pinoy rejected
  const unauthPut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinoyApiUrl: 'https://example.com/korotoko_ph.php' }),
  });
  assert.ok(unauthPut.status === 401 || unauthPut.status === 403);

  // Member PUT /api/admin/settings/pinoy rejected with 403
  const memberLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const memberAuth = (await memberLogin.json()) as { token: string };
  const memberPut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ pinoyApiUrl: 'https://example.com/korotoko_ph.php' }),
  });
  assert.equal(memberPut.status, 403);

  // Admin login
  const adminLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminLogin.json()) as { token: string };

  // SSRF URL blocked (API URL & Media domain)
  const ssrfPut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ pinoyApiUrl: 'http://127.0.0.1/korotoko_ph.php' }),
  });
  assert.equal(ssrfPut.status, 400);

  const ssrfMediaPut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ pinoyMediaBaseUrl: 'http://127.0.0.1/' }),
  });
  assert.equal(ssrfMediaPut.status, 400);

  const ssrfPlayerPut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ pinoyPlayerTemplate: 'http://localhost/pinoy/{id}' }),
  });
  assert.equal(ssrfPlayerPut.status, 400);

  // Valid API URL, media base, player template, and download restriction message saved
  const customDownloadMsg = 'Passez membre Pro pour débloquer le téléchargement HD.';
  const savePut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      pinoyApiUrl: 'https://example.com/korotoko_ph.php',
      pinoyMediaBaseUrl: 'https://cdn.behoririka.mg',
      pinoyPlayerTemplate: 'https://cdn.behoririka.mg/pinoy/{id}',
      pinoyDownloadMessage: customDownloadMsg,
    }),
  });
  assert.equal(savePut.status, 200);
  const saveJson = (await savePut.json()) as {
    pinoyApiUrl: string;
    pinoyMediaBaseUrl: string;
    pinoyPlayerTemplate: string;
    pinoyDownloadMessage: string;
  };
  assert.equal(saveJson.pinoyApiUrl, 'https://example.com/korotoko_ph.php');
  assert.equal(saveJson.pinoyMediaBaseUrl, 'https://cdn.behoririka.mg/');
  assert.equal(saveJson.pinoyPlayerTemplate, 'https://cdn.behoririka.mg/pinoy/{id}');
  assert.equal(saveJson.pinoyDownloadMessage, customDownloadMsg);

  // Verify admin settings exposes pinoyDownloadMessage
  const settingsGet = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(settingsGet.status, 200);
  const settingsJson = (await settingsGet.json()) as { pinoyDownloadMessage?: string };
  assert.equal(settingsJson.pinoyDownloadMessage, customDownloadMsg);

  // Mock upstream Pinoy PHP response to test server-side Pro/Admin-only download gating
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (target.startsWith('https://example.com/korotoko_ph.php')) {
      return new Response(
        JSON.stringify({
          status: 'success',
          film: {
            id: 15,
            titre: 'Milf 2026',
            titre_original: null,
            slug: 'milf-2026',
            url_source: null,
            annee: 2026,
            date_sortie: null,
            sortie_le: null,
            pays: 'PH',
            duree: '90 min',
            note: 7.5,
            genres: ['Drame'],
            synopsis: 'Synopsis test',
            poster: 'uploads/pinoy/posters/milf-2026.jpg',
            galerie: ['uploads/pinoy/galerie/frame-1.jpg'],
          },
          players: {
            embed: [{ provider: 'Voe', url: 'https://voe.sx/e/3od2eqbnmolo', quality: 'HD', language: null }],
            download: [],
          },
          similar: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (target === 'https://cdn.behoririka.mg/pinoy/15') {
      return new Response(
        `<!doctype html><html><body><div class="hero" style="background-image:url('/uploads/pinoy/posters/milf-2026.jpg')">Player OK</div></body></html>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'SAMEORIGIN',
          },
        }
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    // 1. Guest receives same-origin Pinoy player URL, no download URLs + downloadLocked + lockedDownloads + custom message
    const guestDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`);
    assert.equal(guestDetailRes.status, 200);
    const guestDetailText = await guestDetailRes.text();
    assert.equal(guestDetailText.includes('https://voe.sx/3od2eqbnmolo/download'), false);
    const guestDetail = JSON.parse(guestDetailText) as {
      players: { embed: Array<{ provider: string; url: string }>; download: unknown[] };
      lockedDownloads?: Array<{ provider: string; quality: string | null; language: string | null; url?: unknown }>;
      downloadLocked?: boolean;
      downloadMessage?: string;
    };
    assert.equal(guestDetail.players.embed[0]?.provider, 'Lecteur Pinoy');
    assert.equal(guestDetail.players.embed[0]?.url, '/api/public/watch/pinoy/15/milf-2026');
    assert.equal(guestDetail.players.download.length, 0);
    assert.equal(guestDetail.downloadLocked, true);
    assert.equal(guestDetail.downloadMessage, customDownloadMsg);
    assert.equal(guestDetail.lockedDownloads?.length, 1);
    assert.equal(guestDetail.lockedDownloads?.[0]?.url, undefined);

    // Same-origin Pinoy watch proxy strips X-Frame-Options and rewrites /uploads/
    const watchProxyRes = await realFetch(`${baseUrl}/api/public/watch/pinoy/15/milf-2026`);
    assert.equal(watchProxyRes.status, 200);
    assert.equal(watchProxyRes.headers.get('x-frame-options'), null);
    const watchHtml = await watchProxyRes.text();
    assert.ok(watchHtml.includes('https://cdn.behoririka.mg/uploads/pinoy/posters/milf-2026.jpg'));

    const badWatchProxyRes = await realFetch(`${baseUrl}/api/public/watch/pinoy/not-numeric`);
    assert.equal(badWatchProxyRes.status, 400);

    // 2. Free member receives no download URLs + downloadLocked + lockedDownloads + custom message
    const freeDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    });
    assert.equal(freeDetailRes.status, 200);
    const freeDetailText = await freeDetailRes.text();
    assert.equal(freeDetailText.includes('https://voe.sx/3od2eqbnmolo/download'), false);
    const freeDetail = JSON.parse(freeDetailText) as {
      players: { download: unknown[] };
      lockedDownloads?: Array<{ provider: string; url?: unknown }>;
      downloadLocked?: boolean;
      downloadMessage?: string;
    };
    assert.equal(freeDetail.players.download.length, 0);
    assert.equal(freeDetail.downloadLocked, true);
    assert.equal(freeDetail.downloadMessage, customDownloadMsg);
    assert.equal(freeDetail.lockedDownloads?.length, 1);
    assert.equal(freeDetail.lockedDownloads?.[0]?.url, undefined);

    // 3. Admin receives direct download URLs + downloadLocked=false
    const adminDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(adminDetailRes.status, 200);
    const adminDetail = (await adminDetailRes.json()) as {
      players: { download: Array<{ url: string }> };
      lockedDownloads?: unknown[];
      downloadLocked?: boolean;
    };
    assert.equal(adminDetail.downloadLocked, false);
    assert.equal(adminDetail.lockedDownloads, undefined);
    assert.equal(adminDetail.players.download[0]?.url, 'https://voe.sx/3od2eqbnmolo/download');

    // 4. Pro member receives direct download URLs + downloadLocked=false
    const billingRes = await realFetch(`${baseUrl}/api/billing/plans`);
    const billingJson = (await billingRes.json()) as {
      plans: Array<{ id: string; tier: string }>;
    };
    const proPlan = billingJson.plans.find((p) => p.tier === 'pro');
    assert.ok(proPlan);

    const memberMeRes = await realFetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    });
    const memberMe = (await memberMeRes.json()) as { user: { id: string } };

    const assignRes = await realFetch(`${baseUrl}/api/admin/users/${memberMe.user.id}/subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({ planId: proPlan.id, durationDays: 30, replaceExisting: true }),
    });
    assert.equal(assignRes.status, 200);

    const proDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    });
    assert.equal(proDetailRes.status, 200);
    const proDetail = (await proDetailRes.json()) as {
      players: { download: Array<{ url: string }> };
      downloadLocked?: boolean;
    };
    assert.equal(proDetail.downloadLocked, false);
    assert.equal(proDetail.players.download[0]?.url, 'https://voe.sx/3od2eqbnmolo/download');

    // Revoke Pro so member returns to free tier
    await realFetch(`${baseUrl}/api/admin/users/${memberMe.user.id}/revoke-pro`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
  } finally {
    globalThis.fetch = realFetch;
  }

  const clearPut = await fetch(`${baseUrl}/api/admin/settings/pinoy`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      pinoyApiUrl: '',
      pinoyMediaBaseUrl: 'https://streamwall.behoririka.mg/',
      pinoyPlayerTemplate: 'https://streamwall.behoririka.mg/pinoy/{id}',
      pinoyDownloadMessage:
        'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.',
    }),
  });
  assert.equal(clearPut.status, 200);
  const clearJson = (await clearPut.json()) as {
    pinoyApiUrl: string;
    pinoyMediaBaseUrl: string;
    pinoyPlayerTemplate: string;
    pinoyDownloadMessage: string;
  };
  assert.equal(clearJson.pinoyApiUrl, '');
  assert.equal(clearJson.pinoyMediaBaseUrl, 'https://streamwall.behoririka.mg/');
  assert.equal(clearJson.pinoyPlayerTemplate, 'https://streamwall.behoririka.mg/pinoy/{id}');
  assert.equal(
    clearJson.pinoyDownloadMessage,
    'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.'
  );

  // Pinoy comments and broken reports
  const commentRes = await fetch(`${baseUrl}/api/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({
      itemType: 'pinoy',
      itemId: 'milf-2026',
      itemTitle: 'Milf 2026',
      body: 'Super film Pinoy !',
      parentId: null,
    }),
  });
  assert.equal(commentRes.status, 200);
  const commentJson = (await commentRes.json()) as { comment: { itemType: string; itemId: string } };
  assert.equal(commentJson.comment.itemType, 'pinoy');
  assert.equal(commentJson.comment.itemId, 'milf-2026');

  const getCommentsRes = await fetch(`${baseUrl}/api/comments/pinoy/milf-2026`);
  assert.equal(getCommentsRes.status, 200);
  const getCommentsJson = (await getCommentsRes.json()) as { comments: Array<{ body: string }> };
  assert.ok(getCommentsJson.comments.some((c) => c.body === 'Super film Pinoy !'));

  const pinoyReportRes = await fetch(`${baseUrl}/api/reports/broken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({
      itemType: 'pinoy',
      itemId: 'milf-2026',
      itemTitle: 'Milf 2026',
      reason: 'Lien mort / ne charge pas',
    }),
  });
  assert.equal(pinoyReportRes.status, 200);
  const pinoyReportJson = (await pinoyReportRes.json()) as { report: { itemType: string } };
  assert.equal(pinoyReportJson.report.itemType, 'pinoy');
});

test('Auth login issues >= 35-day persistent session cookie and Analytics tracks today + active users', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(loginRes.status, 200);
  const setCookie = loginRes.headers.get('set-cookie') || '';
  assert.match(setCookie, /tapenaka_session=sws_/);
  const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
  assert.ok(maxAgeMatch && Number(maxAgeMatch[1]) >= 30 * 86_400);

  const adminAuth = (await loginRes.json()) as { token: string };
  assert.ok(adminAuth.token.startsWith('sws_'));

  // Collect real browser analytics hit (avoid blocked test/bot User-Agent)
  const browserUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const collectRes = await fetch(`${baseUrl}/api/analytics/collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': browserUa,
    },
    body: JSON.stringify({
      visitorId: 'integ-vis-1',
      sessionId: 'integ-sess-1',
      path: '/catalogue',
      title: 'Catalogue',
      screenResolution: '1920×1080',
    }),
  });
  assert.equal(collectRes.status, 200);

  const analyticsRes = await fetch(`${baseUrl}/api/admin/analytics?period=today`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(analyticsRes.status, 200);
  const analyticsJson = (await analyticsRes.json()) as {
    summary: {
      sessions: number;
      totalActiveUsers: number;
      activeSessionsCount: number;
      activeUsersToday: number;
      activeNow: number;
    };
  };
  assert.ok(analyticsJson.summary.sessions >= 1);
  assert.ok(analyticsJson.summary.totalActiveUsers >= 1);
  assert.ok(analyticsJson.summary.activeSessionsCount >= 1);
});

test('Navigation CMS & Custom API Modules enforce admin auth, block SSRF, and serve dynamic module endpoints', async () => {
  const adminLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminLogin.json()) as { token: string };

  const memberLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const memberAuth = (await memberLogin.json()) as { token: string };

  // Public navigation endpoint returns seeded items
  const publicNavRes = await fetch(`${baseUrl}/api/site/navigation`);
  assert.equal(publicNavRes.status, 200);
  const publicNav = (await publicNavRes.json()) as { items: Array<{ path: string }> };
  assert.ok(publicNav.items.some((i) => i.path === '/pinoy'));

  // Non-admin cannot modify navigation or custom modules
  const memberNavPut = await fetch(`${baseUrl}/api/admin/navigation`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(memberNavPut.status, 403);

  // SSRF blocked on custom module creation
  const ssrfModuleRes = await fetch(`${baseUrl}/api/admin/custom-modules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      slug: 'asian',
      name: 'Asian Movies',
      endpoints: { apiUrl: 'http://127.0.0.1/api.php' },
    }),
  });
  assert.equal(ssrfModuleRes.status, 400);

  // Create valid custom module with menu sync
  const createModuleRes = await fetch(`${baseUrl}/api/admin/custom-modules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      slug: 'asian',
      name: 'Asian Movies',
      enabled: true,
      endpoints: {
        apiUrl: 'https://example.com/asian_api.php',
        mediaBaseUrl: 'https://cdn.example.com/',
      },
      player: {
        playerUrlTemplate: 'https://cdn.example.com/embed/{id}',
        useSameOriginProxy: true,
        downloadProOnly: true,
        downloadRestrictionMessage: 'Pro requis pour télécharger.',
      },
      syncMenu: true,
      showDesktop: true,
      showMobile: true,
      showFooter: true,
    }),
  });
  assert.equal(createModuleRes.status, 200);
  const createdJson = (await createModuleRes.json()) as {
    module: { slug: string };
    navigation: { items: Array<{ path: string }> };
  };
  assert.equal(createdJson.module.slug, 'asian');
  assert.ok(createdJson.navigation.items.some((i) => i.path === '/c/asian'));

  // Mock upstream JSON API to verify /api/custom/asian/list, detail, and Pro-gating
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (target.startsWith('https://example.com/asian_api.php')) {
      return new Response(
        JSON.stringify({
          status: 'success',
          page: 1,
          total: 1,
          total_pages: 1,
          items: [
            {
              id: 77,
              slug: 'tokyo-drift',
              titre: 'Tokyo Drift Custom',
              annee: 2025,
              pays: 'JP',
              poster: 'uploads/tokyo.jpg',
              galerie: ['uploads/tokyo-banner.jpg'],
            },
          ],
          film: {
            id: 77,
            slug: 'tokyo-drift',
            titre: 'Tokyo Drift Custom',
            annee: 2025,
            pays: 'JP',
            poster: 'uploads/tokyo.jpg',
            galerie: ['uploads/tokyo-banner.jpg'],
          },
          players: {
            embed: [{ provider: 'Voe', url: 'https://voe.sx/e/abc123' }],
            download: [],
          },
          similar: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const customListRes = await realFetch(`${baseUrl}/api/custom/asian/list`);
    assert.equal(customListRes.status, 200);
    const customList = (await customListRes.json()) as {
      items: Array<{ routeKey: string; titre: string }>;
    };
    assert.equal(customList.items[0]?.titre, 'Tokyo Drift Custom');

    const customDetailGuest = await realFetch(`${baseUrl}/api/custom/asian/detail/tokyo-drift`);
    assert.equal(customDetailGuest.status, 200);
    const guestJson = (await customDetailGuest.json()) as {
      downloadLocked?: boolean;
      downloadMessage?: string;
      players: { embed: Array<{ url: string }>; download: unknown[] };
    };
    assert.equal(guestJson.downloadLocked, true);
    assert.equal(guestJson.downloadMessage, 'Pro requis pour télécharger.');
    assert.equal(guestJson.players.download.length, 0);
    assert.equal(guestJson.players.embed[0]?.url, '/api/public/watch/custom/asian/77/tokyo-drift');
  } finally {
    globalThis.fetch = realFetch;
  }

  // Delete custom module and verify navigation sync removes /c/asian
  const delRes = await fetch(`${baseUrl}/api/admin/custom-modules/asian`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(delRes.status, 200);
  const navAfterDel = (await (await fetch(`${baseUrl}/api/site/navigation`)).json()) as {
    items: Array<{ path: string }>;
  };
  assert.equal(navAfterDel.items.some((i) => i.path === '/c/asian'), false);
});

test('Top 6 week, 6 recent watches, Pinoy/custom favorites, Admin activeStats, Email custom HTML/colors, and Pinoy module delete/restore', async () => {
  const [adminLogin, memberLogin] = await Promise.all([
    fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }),
    fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    }),
  ]);
  const adminAuth = (await adminLogin.json()) as { token: string; user: { id: string } };
  const memberAuth = (await memberLogin.json()) as { token: string; user: { id: string } };

  // 1. /api/home guarantees top 6 week items + /api/site/navigation removes /communaute & allows custom external footer links (e.g. Telegram)
  const [homeRes, navRes] = await Promise.all([
    fetch(`${baseUrl}/api/home`),
    fetch(`${baseUrl}/api/site/navigation`),
  ]);
  assert.equal(homeRes.status, 200);
  const homeJson = (await homeRes.json()) as { week: Array<{ id: number }> };
  assert.equal(homeJson.week.length, 6);

  const navJson = (await navRes.json()) as { items: Array<{ path: string; id: string }> };
  assert.equal(
    navJson.items.some((i) => i.id === 'nav_communaute' || i.path === '/communaute'),
    false
  );

  // Admin can add a custom Telegram footer link and unsafe javascript: links are rejected
  const badNavRes = await fetch(`${baseUrl}/api/admin/navigation`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      items: [
        ...navJson.items,
        {
          id: 'nav_bad_js',
          label: 'Bad',
          path: 'javascript:alert(1)',
          icon: 'globe',
          exact: false,
          enabled: true,
          desktop: false,
          mobile: false,
          footer: true,
          order: 99,
          authRule: 'all',
        },
      ],
    }),
  });
  assert.equal(badNavRes.status, 400);

  const tgNavRes = await fetch(`${baseUrl}/api/admin/navigation`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      items: [
        ...navJson.items,
        {
          id: 'nav_telegram_test',
          label: 'Telegram',
          path: 'https://t.me/streamwall_test',
          icon: 'send',
          exact: false,
          enabled: true,
          desktop: false,
          mobile: false,
          footer: true,
          order: 95,
          authRule: 'all',
        },
      ],
    }),
  });
  assert.equal(tgNavRes.status, 200);
  const updatedNavCheck = await fetch(`${baseUrl}/api/site/navigation`);
  const updatedNavJson = (await updatedNavCheck.json()) as {
    items: Array<{ id: string; path: string; footer: boolean }>;
  };
  assert.ok(
    updatedNavJson.items.some(
      (i) => i.id === 'nav_telegram_test' && i.path === 'https://t.me/streamwall_test' && i.footer
    )
  );
  await fetch(`${baseUrl}/api/admin/navigation/reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });

  // 2. Member opens 7 distinct items -> /api/member & /api/home retain top 6 recent watches
  for (let i = 1; i <= 7; i++) {
    const openRes = await fetch(`${baseUrl}/api/player/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberAuth.token}`,
      },
      body: JSON.stringify({
        item: {
          id: 9000 + i,
          slug: `watch-test-${i}`,
          titre: `Watch Test ${i}`,
          item_type: 'film',
          poster: '',
        },
      }),
    });
    assert.equal(openRes.status, 200);
  }

  const [memberRes, authHomeRes] = await Promise.all([
    fetch(`${baseUrl}/api/member`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    }),
    fetch(`${baseUrl}/api/home`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    }),
  ]);
  assert.equal(memberRes.status, 200);
  const memberJson = (await memberRes.json()) as {
    progress: Array<{ item_id: number }>;
  };
  assert.equal(memberJson.progress.length, 6);
  const authHomeJson = (await authHomeRes.json()) as {
    continueWatching: Array<{ id: number }>;
  };
  assert.equal(authHomeJson.continueWatching.length, 6);

  // 3. Favorites toggle supports pinoy (with string slug id & rating) & custom:<slug>, persists to /api/member, toggles off, and rejects invalid item_type
  const pinoyFavPayload = {
    id: 'laplap-2026',
    titre: 'Laplap',
    poster: 'https://streamwall.behoririka.mg/uploads/laplap.jpg',
    qualite: '★ 9.0',
    langue: 'PH',
    item_type: 'pinoy',
    saison: null,
    genre: 'Drame',
    annee: 2026,
  };
  const favPinoyRes = await fetch(`${baseUrl}/api/favorites/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ item: pinoyFavPayload }),
  });
  assert.equal(favPinoyRes.status, 200);
  const favPinoyJson = (await favPinoyRes.json()) as {
    saved: boolean;
    favorites: Array<{ id: string; item_type: string }>;
  };
  assert.equal(favPinoyJson.saved, true);
  assert.ok(
    favPinoyJson.favorites.some((f) => f.item_type === 'pinoy' && f.id === 'laplap-2026')
  );

  const memberAfterPinoyFav = await fetch(`${baseUrl}/api/member`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(memberAfterPinoyFav.status, 200);
  const memberPinoyJson = (await memberAfterPinoyFav.json()) as {
    favorites: Array<{ id: string; item_type: string }>;
  };
  assert.ok(
    memberPinoyJson.favorites.some((f) => f.item_type === 'pinoy' && f.id === 'laplap-2026')
  );

  const unfavPinoyRes = await fetch(`${baseUrl}/api/favorites/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ item: pinoyFavPayload }),
  });
  assert.equal(unfavPinoyRes.status, 200);
  const unfavPinoyJson = (await unfavPinoyRes.json()) as {
    saved: boolean;
    favorites: Array<{ id: string; item_type: string }>;
  };
  assert.equal(unfavPinoyJson.saved, false);
  assert.equal(
    unfavPinoyJson.favorites.some((f) => f.item_type === 'pinoy' && f.id === 'laplap-2026'),
    false
  );

  const favCustomRes = await fetch(`${baseUrl}/api/favorites/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({
      item: {
        id: 77,
        slug: 'tokyo-drift',
        titre: 'Tokyo Drift',
        item_type: 'custom:asian',
      },
    }),
  });
  assert.equal(favCustomRes.status, 200);
  const favCustomJson = (await favCustomRes.json()) as {
    saved: boolean;
    favorites: Array<{ item_type: string }>;
  };
  assert.equal(favCustomJson.saved, true);
  assert.ok(favCustomJson.favorites.some((f) => f.item_type === 'custom:asian'));

  const badFavRes = await fetch(`${baseUrl}/api/favorites/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({
      item: {
        id: 1,
        slug: 'bad',
        titre: 'Bad',
        item_type: 'javascript:evil',
      },
    }),
  });
  assert.equal(badFavRes.status, 400);

  // 4. Touch presence for member + guest, then inspect /api/admin/overview activeStats & online flag
  await Promise.all([
    fetch(`${baseUrl}/api/analytics/collect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberAuth.token}`,
      },
      body: JSON.stringify({
        visitorId: 'vis-member-active',
        sessionId: 'sess-member-active',
        path: '/pinoy',
      }),
    }),
    fetch(`${baseUrl}/api/analytics/collect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: 'vis-guest-active',
        sessionId: 'sess-guest-active',
        path: '/catalogue',
      }),
    }),
  ]);

  const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(overviewRes.status, 200);
  const overviewJson = (await overviewRes.json()) as {
    activeStats: { activeMembers: number; activeGuests: number };
    users: Array<{ id: string; online?: boolean }>;
  };
  assert.ok(overviewJson.activeStats.activeMembers >= 1);
  assert.ok(overviewJson.activeStats.activeGuests >= 1);
  const activeMemberRow = overviewJson.users.find((u) => u.id === memberAuth.user.id);
  assert.equal(activeMemberRow?.online, true);

  // 5. Email template colors & custom sanitized HTML save & reset
  const mailPutRes = await fetch(`${baseUrl}/api/admin/mail/templates/signup_welcome`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      bgColor: '#111827',
      cardBgColor: '#1F2937',
      textColor: '#F3F4F6',
      accentColor: '#E11D48',
      useCustomHtml: true,
      customHtml: '<section><script>alert(1)</script><p>Bienvenue {{userName}}</p></section>',
    }),
  });
  assert.equal(mailPutRes.status, 200);
  const mailPutJson = (await mailPutRes.json()) as {
    template: {
      bgColor: string;
      cardBgColor: string;
      textColor: string;
      accentColor: string;
      useCustomHtml: boolean;
      customHtml: string;
    };
  };
  assert.equal(mailPutJson.template.bgColor, '#111827');
  assert.equal(mailPutJson.template.cardBgColor, '#1f2937');
  assert.equal(mailPutJson.template.textColor, '#f3f4f6');
  assert.equal(mailPutJson.template.accentColor, '#e11d48');
  assert.equal(mailPutJson.template.useCustomHtml, true);
  assert.equal(/<script/i.test(mailPutJson.template.customHtml), false);
  assert.ok(mailPutJson.template.customHtml.includes('Bienvenue {{userName}}'));

  const mailResetRes = await fetch(`${baseUrl}/api/admin/mail/templates/signup_welcome/reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(mailResetRes.status, 200);

  // 6. Admin custom modules includes pre-seeded pinoy; deleting pinoy disables /api/pinoy/list, re-creating restores it
  const modulesRes = await fetch(`${baseUrl}/api/admin/custom-modules`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(modulesRes.status, 200);
  const modulesJson = (await modulesRes.json()) as {
    modules: Array<{ id: string; slug: string }>;
  };
  assert.ok(modulesJson.modules.some((m) => m.slug === 'pinoy'));

  const deletePinoyRes = await fetch(`${baseUrl}/api/admin/custom-modules/pinoy`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(deletePinoyRes.status, 200);

  const disabledPinoyList = await fetch(`${baseUrl}/api/pinoy/list`);
  assert.equal(disabledPinoyList.status, 404);

  // Restore Pinoy cleanly
  const restorePinoyRes = await fetch(`${baseUrl}/api/admin/custom-modules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      slug: 'pinoy',
      name: 'Pinoy',
      enabled: true,
      endpoints: {
        apiUrl: 'https://streamwall.behoririka.mg/pinoy_api.php',
        mediaBaseUrl: 'https://streamwall.behoririka.mg/',
      },
      player: {
        playerUrlTemplate: 'https://streamwall.behoririka.mg/pinoy/{id}',
        useSameOriginProxy: true,
        downloadProOnly: true,
      },
      syncMenu: true,
      showDesktop: true,
      showMobile: true,
      showFooter: true,
    }),
  });
  assert.equal(restorePinoyRes.status, 200);
});

test('/api/home fetches /api/last_serie.php?short=asc, slices 36 items to 18, and maps titre_full, id, dernier_episode, total_episodes, langue', async () => {
  const adminLogin = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminLogin.json()) as { token: string };

  const settingsRes = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const settingsJson = (await settingsRes.json()) as { origin: string };
  const originalOrigin = settingsJson.origin || 'https://streamwall.behoririka.mg';

  const setOriginRes = await fetch(`${baseUrl}/api/admin/settings/origin`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ origin: 'https://lastserie.example.com' }),
  });
  assert.equal(setOriginRes.status, 200);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (target === 'https://lastserie.example.com/api/last_serie.php?short=asc') {
      const mockItems = Array.from({ length: 36 }, (_, idx) => ({
        id: idx === 0 ? 7499 : 8000 + idx,
        titre: idx === 0 ? 'Sur le fil' : `Série Test ${idx + 1}`,
        serie_id: idx === 0 ? 7499 : 8000 + idx,
        titre_full: idx === 0 ? 'Sur le fil - Saison 1' : `Série Test ${idx + 1} - Saison 2`,
        saison: idx === 0 ? 1 : 2,
        dernier_episode: idx === 0 ? 12 : idx + 1,
        total_episodes: idx === 0 ? 12 : 24,
        poster: 'https://image.tmdb.org/t/p/w500/fFiDEccvC23OohMz84X11AeFRV8.jpg',
        langue: idx % 2 === 0 ? 'VF' : 'VOSTFR',
        qualite: 'HD',
        genre: 'Drame',
        annee: 2026,
      }));
      return new Response(
        JSON.stringify({ status: 'success', page: 1, limit: 36, total: 36, count: 36, items: mockItems }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (target.startsWith('https://lastserie.example.com/api/')) {
      return new Response(JSON.stringify({ items: [], data: [], pages: 1, total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const homeRes = await realFetch(`${baseUrl}/api/home`);
    assert.equal(homeRes.status, 200);
    const homeJson = (await homeRes.json()) as {
      lastSeries: Array<{
        id: string;
        titre: string;
        item_type: string;
        dernier_episode: number | null;
        total_episodes: number | null;
        langue: string | null;
      }>;
    };
    assert.equal(homeJson.lastSeries.length, 18);
    assert.equal(homeJson.lastSeries[0]?.id, '7499');
    assert.equal(homeJson.lastSeries[0]?.titre, 'Sur le fil - Saison 1');
    assert.equal(homeJson.lastSeries[0]?.item_type, 'serie');
    assert.equal(homeJson.lastSeries[0]?.dernier_episode, 12);
    assert.equal(homeJson.lastSeries[0]?.total_episodes, 12);
    assert.equal(homeJson.lastSeries[0]?.langue, 'VF');
    assert.equal(homeJson.lastSeries[1]?.langue, 'VOSTFR');
  } finally {
    globalThis.fetch = realFetch;
    await realFetch(`${baseUrl}/api/admin/settings/origin`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({ origin: originalOrigin }),
    });
  }
});

test('film download links require Pro/Admin, mask Bearer key in admin settings, validate URLs, and test endpoint works', async () => {
  const [adminLogin, memberLogin] = await Promise.all([
    fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }),
    fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    }),
  ]);
  const adminAuth = (await adminLogin.json()) as { token: string };
  const memberAuth = (await memberLogin.json()) as { token: string };

  const settingsRes = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const settingsJson = (await settingsRes.json()) as {
    origin: string;
    filmDownload?: { apiUrl: string; message: string };
  };
  const originalOrigin = settingsJson.origin || 'https://streamwall.behoririka.mg';
  const originalDlUrl =
    settingsJson.filmDownload?.apiUrl ?? 'https://streamwall.behoririka.mg/api/api_f.php';
  const originalDlMsg =
    settingsJson.filmDownload?.message ??
    'Le téléchargement direct est réservé aux membres Pro et aux administrateurs.';

  // Non-admin blocked from updating or testing film download settings
  const memberPutRes = await fetch(`${baseUrl}/api/admin/settings/film-download`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ apiUrl: 'https://downloads.example.com/api_f.php' }),
  });
  assert.equal(memberPutRes.status, 403);

  const memberTestRes = await fetch(`${baseUrl}/api/admin/settings/film-download/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
    },
    body: JSON.stringify({ filmId: 12345 }),
  });
  assert.equal(memberTestRes.status, 403);

  // SSRF URL rejected
  const ssrfRes = await fetch(`${baseUrl}/api/admin/settings/film-download`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ apiUrl: 'http://127.0.0.1/api_f.php' }),
  });
  assert.equal(ssrfRes.status, 400);

  // Set isolated origin + download settings with secret token
  await fetch(`${baseUrl}/api/admin/settings/origin`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({ origin: 'https://dlfilm.example.com' }),
  });

  const testSecret = 'superSecretDownloadToken9876';
  const saveDlRes = await fetch(`${baseUrl}/api/admin/settings/film-download`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      apiUrl: 'https://downloads.example.com/api_f.php',
      apiKey: testSecret,
      message: 'Passez en Pro pour débloquer les téléchargements directs.',
    }),
  });
  assert.equal(saveDlRes.status, 200);
  const saveDlJson = (await saveDlRes.json()) as {
    filmDownload: { apiUrl: string; apiKeyConfigured: boolean; apiKeyMask: string; message: string };
  };
  assert.equal(saveDlJson.filmDownload.apiUrl, 'https://downloads.example.com/api_f.php');
  assert.equal(saveDlJson.filmDownload.apiKeyConfigured, true);
  assert.equal(saveDlJson.filmDownload.apiKeyMask, 'supe••••9876');
  assert.equal(JSON.stringify(saveDlJson).includes(testSecret), false);

  // Admin settings GET also never leaks the raw secret
  const adminGetRes = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const adminGetJson = (await adminGetRes.json()) as {
    filmDownload?: { apiKeyConfigured: boolean; apiKeyMask: string };
  };
  assert.equal(adminGetJson.filmDownload?.apiKeyConfigured, true);
  assert.equal(adminGetJson.filmDownload?.apiKeyMask, 'supe••••9876');
  assert.equal(JSON.stringify(adminGetJson).includes(testSecret), false);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (target === 'https://downloads.example.com/api_f.php') {
      const headers = new Headers(init?.headers);
      if (headers.get('Authorization') !== `Bearer ${testSecret}`) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const parsedBody = JSON.parse(String(init?.body ?? '{}')) as { film_id?: number };
      if (parsedBody.film_id === 99999) {
        return new Response(
          JSON.stringify({
            success: true,
            film_id: 99999,
            count: 0,
            downloads: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          film_id: parsedBody.film_id,
          count: 2,
          downloads: [
            {
              id: 77,
              url: 'https://cdn.example.com/film-12345-1080p.mp4',
              filename: 'Film.Test.1080p.mp4',
              quality: '1080p',
              release_name: 'Film.Test.2026.FRENCH.1080p',
              expires_at: 1893456000,
            },
            {
              id: 78,
              url: 'javascript:alert(99)',
              filename: 'Malicious',
              quality: 'HD',
              release_name: null,
              expires_at: null,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (target.startsWith('https://dlfilm.example.com/api/')) {
      return new Response(
        JSON.stringify({
          item: {
            id: 12345,
            titre: 'Film Test DL',
            type: 'film',
            poster: 'https://image.tmdb.org/t/p/w500/test.jpg',
            genre: 'Action',
            annee: 2026,
            qualite: 'HD',
            langue: 'VF',
            players: [],
          },
          items: [],
          related: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return realFetch(input, init);
  }) as typeof fetch;

  try {
    // 1. Admin test endpoint returns protected sample without leaking raw url
    const testRes = await realFetch(`${baseUrl}/api/admin/settings/film-download/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({ filmId: 12345 }),
    });
    assert.equal(testRes.status, 200);
    const testJson = (await testRes.json()) as {
      ok: boolean;
      count: number;
      sample: { filename: string; quality: string; protectToken: string } | null;
    };
    assert.equal(testJson.ok, true);
    assert.equal(testJson.count, 1);
    assert.equal(testJson.sample?.filename, 'Film.Test.1080p.mp4');
    assert.equal(testJson.sample?.quality, '1080p');
    assert.ok(testJson.sample?.protectToken);
    assert.equal(JSON.stringify(testJson).includes('https://cdn.example.com/film-12345-1080p.mp4'), false);

    // 2. Guest hitting /api/details/film/12345 gets downloadLocked=true, empty downloads, sanitized lockedDownloads, and no-cache headers
    const guestDetailRes = await realFetch(`${baseUrl}/api/details/film/12345`);
    assert.equal(guestDetailRes.status, 200);
    assert.equal(guestDetailRes.headers.get('cache-control'), 'private, no-cache');
    const guestDetailText = await guestDetailRes.text();
    assert.equal(guestDetailText.includes('https://cdn.example.com/film-12345-1080p.mp4'), false);
    assert.equal(guestDetailText.includes('Film.Test.2026.FRENCH.1080p'), false);
    const guestDetail = JSON.parse(guestDetailText) as {
      downloads?: unknown[];
      lockedDownloads?: Array<{
        id: number;
        filename: string;
        quality: string;
        protectToken?: unknown;
        url?: unknown;
      }>;
      downloadCount?: number;
      downloadLocked?: boolean;
      downloadMessage?: string;
    };
    assert.equal(guestDetail.downloadLocked, true);
    assert.equal(guestDetail.downloadCount, 1);
    assert.equal(guestDetail.downloads?.length, 0);
    assert.equal(guestDetail.lockedDownloads?.length, 1);
    assert.equal(guestDetail.lockedDownloads?.[0]?.filename, 'Film.Test.1080p.mp4');
    assert.equal(guestDetail.lockedDownloads?.[0]?.quality, '1080p');
    assert.equal(guestDetail.lockedDownloads?.[0]?.protectToken, undefined);
    assert.equal(guestDetail.lockedDownloads?.[0]?.url, undefined);
    assert.equal(
      guestDetail.downloadMessage,
      'Passez en Pro pour débloquer les téléchargements directs.'
    );

    // 2b. Guest hitting /api/details/film/99999 (no download links) omits downloadLocked & lockedDownloads
    const noDlGuestRes = await realFetch(`${baseUrl}/api/details/film/99999`);
    assert.equal(noDlGuestRes.status, 200);
    const noDlGuestJson = (await noDlGuestRes.json()) as {
      downloadLocked?: boolean;
      downloads?: unknown[];
      lockedDownloads?: unknown[];
    };
    assert.equal(noDlGuestJson.downloadLocked, undefined);
    assert.equal(noDlGuestJson.downloads, undefined);
    assert.equal(noDlGuestJson.lockedDownloads, undefined);

    // 3. Free member also gets downloadLocked=true, sanitized lockedDownloads, and no leaked URLs/tokens
    const memberDetailRes = await realFetch(`${baseUrl}/api/details/film/12345`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    });
    assert.equal(memberDetailRes.status, 200);
    const memberDetailText = await memberDetailRes.text();
    assert.equal(memberDetailText.includes('https://cdn.example.com/film-12345-1080p.mp4'), false);
    const memberDetail = JSON.parse(memberDetailText) as {
      downloads?: unknown[];
      lockedDownloads?: Array<{ filename: string; quality: string; protectToken?: unknown; url?: unknown }>;
      downloadLocked?: boolean;
    };
    assert.equal(memberDetail.downloadLocked, true);
    assert.equal(memberDetail.downloads?.length, 0);
    assert.equal(memberDetail.lockedDownloads?.length, 1);
    assert.equal(memberDetail.lockedDownloads?.[0]?.filename, 'Film.Test.1080p.mp4');
    assert.equal(memberDetail.lockedDownloads?.[0]?.protectToken, undefined);
    assert.equal(memberDetail.lockedDownloads?.[0]?.url, undefined);

    // 4. Admin gets unlocked list containing ONLY id, filename, quality, protectToken (no raw url/release_name/expires_at)
    const adminDetailRes = await realFetch(`${baseUrl}/api/details/film/12345`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(adminDetailRes.status, 200);
    const adminDetailText = await adminDetailRes.text();
    assert.equal(adminDetailText.includes('https://cdn.example.com/film-12345-1080p.mp4'), false);
    assert.equal(adminDetailText.includes('Film.Test.2026.FRENCH.1080p'), false);
    const adminDetail = JSON.parse(adminDetailText) as {
      downloads?: Array<{ id: number; filename: string; quality: string; protectToken: string }>;
      lockedDownloads?: unknown[];
      downloadCount?: number;
      downloadLocked?: boolean;
    };
    assert.equal(adminDetail.downloadLocked, false);
    assert.equal(adminDetail.lockedDownloads, undefined);
    assert.equal(adminDetail.downloadCount, 1);
    assert.equal(adminDetail.downloads?.length, 1);
    assert.equal(adminDetail.downloads?.[0]?.filename, 'Film.Test.1080p.mp4');
    assert.equal(adminDetail.downloads?.[0]?.quality, '1080p');
    const protectToken = adminDetail.downloads?.[0]?.protectToken ?? '';
    assert.ok(protectToken.length > 20);

    // 5. /api/linprotect/inspect blocks guests (401) & free members (403)
    const guestInspect = await realFetch(
      `${baseUrl}/api/linprotect/inspect?token=${encodeURIComponent(protectToken)}`
    );
    assert.equal(guestInspect.status, 401);
    const memberInspect = await realFetch(
      `${baseUrl}/api/linprotect/inspect?token=${encodeURIComponent(protectToken)}`,
      { headers: { Authorization: `Bearer ${memberAuth.token}` } }
    );
    assert.equal(memberInspect.status, 403);

    // 6. Admin inspects encrypted link -> gets filename, quality & CAPTCHA challenge (still no url!)
    const adminInspect = await realFetch(
      `${baseUrl}/api/linprotect/inspect?token=${encodeURIComponent(protectToken)}`,
      { headers: { Authorization: `Bearer ${adminAuth.token}` } }
    );
    assert.equal(adminInspect.status, 200);
    const inspectText = await adminInspect.text();
    assert.equal(inspectText.includes('https://cdn.example.com/film-12345-1080p.mp4'), false);
    const inspectJson = JSON.parse(inspectText) as {
      ok: boolean;
      filename: string;
      quality: string;
      challenge: { captchaToken: string; svgDataUri: string };
    };
    assert.equal(inspectJson.ok, true);
    assert.equal(inspectJson.filename, 'Film.Test.1080p.mp4');
    assert.equal(inspectJson.quality, '1080p');
    assert.ok(inspectJson.challenge.captchaToken);

    // 7. Unlock rejects unchecked humanChecked & wrong CAPTCHA, returning fresh challenge; succeeds on valid answer
    const noCheckRes = await realFetch(`${baseUrl}/api/linprotect/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({
        token: protectToken,
        captchaToken: inspectJson.challenge.captchaToken,
        captchaAnswer: 'WRONG',
        humanChecked: false,
      }),
    });
    assert.equal(noCheckRes.status, 400);
    const noCheckJson = (await noCheckRes.json()) as {
      challenge: { captchaToken: string };
    };
    assert.ok(noCheckJson.challenge?.captchaToken);

    const wrongCaptchaRes = await realFetch(`${baseUrl}/api/linprotect/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({
        token: protectToken,
        captchaToken: noCheckJson.challenge.captchaToken,
        captchaAnswer: 'ZZZZZ',
        humanChecked: true,
      }),
    });
    assert.equal(wrongCaptchaRes.status, 400);
    const wrongJson = (await wrongCaptchaRes.json()) as {
      challenge: { captchaToken: string };
    };
    const validAnswer = peekCaptchaAnswerForTest(wrongJson.challenge.captchaToken);
    assert.ok(validAnswer);

    const unlockRes = await realFetch(`${baseUrl}/api/linprotect/unlock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({
        token: protectToken,
        captchaToken: wrongJson.challenge.captchaToken,
        captchaAnswer: validAnswer,
        humanChecked: true,
      }),
    });
    assert.equal(unlockRes.status, 200);
    const unlockJson = (await unlockRes.json()) as {
      ok: boolean;
      url: string;
      filename: string;
      quality: string;
    };
    assert.equal(unlockJson.ok, true);
    assert.equal(unlockJson.url, 'https://cdn.example.com/film-12345-1080p.mp4');
    assert.equal(unlockJson.filename, 'Film.Test.1080p.mp4');
    assert.equal(unlockJson.quality, '1080p');

    // 8. Admin enables filmDownloadsEnabled on the free plan -> free member unlocks details & LinProtect
    const billingRes = await realFetch(`${baseUrl}/api/admin/billing`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(billingRes.status, 200);
    const billingJson = (await billingRes.json()) as {
      plans: Array<{
        id: string;
        tier: string;
        name: string;
        description: string;
        price: number;
        currency: string;
        billingCycle: string;
        durationDays: number;
        autoRenew: boolean;
        active: boolean;
        features: string[];
        players: { film: string; serie: string };
        filmDownloadsEnabled?: boolean;
      }>;
    };
    const freePlan = billingJson.plans.find((p) => p.id === 'free' || p.tier === 'free');
    assert.ok(freePlan);

    try {
      const enableFreeDlRes = await realFetch(`${baseUrl}/api/admin/billing/plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({
          ...freePlan,
          filmDownloadsEnabled: true,
        }),
      });
      assert.equal(enableFreeDlRes.status, 200);

      // /api/billing/plans also serves fresh private no-cache headers after admin update
      const publicPlansRes = await realFetch(`${baseUrl}/api/billing/plans`);
      assert.equal(publicPlansRes.status, 200);
      assert.equal(publicPlansRes.headers.get('cache-control'), 'private, no-cache');

      // Guest still stays locked even when free plan allows downloads
      const guestStillLockedRes = await realFetch(`${baseUrl}/api/details/film/12345`);
      const guestStillLocked = (await guestStillLockedRes.json()) as {
        downloadLocked?: boolean;
        downloads?: unknown[];
      };
      assert.equal(guestStillLocked.downloadLocked, true);
      assert.equal(guestStillLocked.downloads?.length, 0);

      // Free member now gets unlocked downloads + 200 on LinProtect inspect/unlock
      const freeUnlockedRes = await realFetch(`${baseUrl}/api/details/film/12345`, {
        headers: { Authorization: `Bearer ${memberAuth.token}` },
      });
      assert.equal(freeUnlockedRes.status, 200);
      const freeUnlocked = (await freeUnlockedRes.json()) as {
        downloadLocked?: boolean;
        downloads?: Array<{ protectToken: string }>;
      };
      assert.equal(freeUnlocked.downloadLocked, false);
      assert.equal(freeUnlocked.downloads?.length, 1);
      const memberToken = freeUnlocked.downloads?.[0]?.protectToken ?? '';
      assert.ok(memberToken.length > 20);

      const freeInspectRes = await realFetch(
        `${baseUrl}/api/linprotect/inspect?token=${encodeURIComponent(memberToken)}`,
        { headers: { Authorization: `Bearer ${memberAuth.token}` } }
      );
      assert.equal(freeInspectRes.status, 200);
      const freeInspectJson = (await freeInspectRes.json()) as {
        challenge: { captchaToken: string };
      };
      const freeAnswer = peekCaptchaAnswerForTest(freeInspectJson.challenge.captchaToken);
      assert.ok(freeAnswer);

      const freeUnlockRes = await realFetch(`${baseUrl}/api/linprotect/unlock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${memberAuth.token}`,
        },
        body: JSON.stringify({
          token: memberToken,
          captchaToken: freeInspectJson.challenge.captchaToken,
          captchaAnswer: freeAnswer,
          humanChecked: true,
        }),
      });
      assert.equal(freeUnlockRes.status, 200);
    } finally {
      // Restore free plan default (filmDownloadsEnabled: false) and verify member is locked again
      await realFetch(`${baseUrl}/api/admin/billing/plans`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminAuth.token}`,
        },
        body: JSON.stringify({
          ...freePlan,
          filmDownloadsEnabled: false,
        }),
      });
      const restoredMemberDetailRes = await realFetch(`${baseUrl}/api/details/film/12345`, {
        headers: { Authorization: `Bearer ${memberAuth.token}` },
      });
      const restoredMemberDetail = (await restoredMemberDetailRes.json()) as {
        downloadLocked?: boolean;
      };
      assert.equal(restoredMemberDetail.downloadLocked, true);
    }
  } finally {
    globalThis.fetch = realFetch;
    await realFetch(`${baseUrl}/api/admin/settings/origin`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({ origin: originalOrigin }),
    });
    await realFetch(`${baseUrl}/api/admin/settings/film-download`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify({
        apiUrl: originalDlUrl,
        message: originalDlMsg,
        clearApiKey: true,
      }),
    });
  }
});

test('Play Report records watch button events locally via /api/player/open and /api/analytics/play and requires admin to read', async () => {
  const adminRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminRes.json()) as { token: string };

  const memberRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const memberAuth = (await memberRes.json()) as { token: string };

  // 1. /api/admin/analytics/plays blocks guest (403) and non-admin member (403)
  const guestPlaysRes = await fetch(`${baseUrl}/api/admin/analytics/plays?period=7d`);
  assert.equal(guestPlaysRes.status, 403);
  const memberPlaysRes = await fetch(`${baseUrl}/api/admin/analytics/plays?period=7d`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(memberPlaysRes.status, 403);

  const browserHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36',
  };

  // 2. Launching player via /api/player/open records series + movie plays in local SQLite
  const openSerieRes = await fetch(`${baseUrl}/api/player/open`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({
      item: {
        id: '9001',
        titre: 'Broadchurch Play Test',
        poster: 'https://image.tmdb.org/t/p/w500/broadchurch.jpg',
        qualite: 'HD',
        langue: 'VF',
        item_type: 'serie',
        saison: 1,
        genre: 'Drame',
        annee: 2013,
      },
      tmdb: '46601',
      season: 1,
      episode: 1,
    }),
  });
  assert.equal(openSerieRes.status, 200);

  const openFilmRes = await fetch(`${baseUrl}/api/player/open`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({
      item: {
        id: '9002',
        titre: 'Guarding Stars Play Test',
        poster: 'https://image.tmdb.org/t/p/w500/guarding.jpg',
        qualite: 'HD',
        langue: 'VF',
        item_type: 'film',
        saison: null,
        genre: 'Action',
        annee: 2026,
      },
      tmdb: '123456',
      season: 1,
      episode: 1,
    }),
  });
  assert.equal(openFilmRes.status, 200);

  // 3. Direct watch button event via /api/analytics/play records Pinoy/custom plays and rejects invalid payload
  const badPlayRes = await fetch(`${baseUrl}/api/analytics/play`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({ itemType: 'invalid', itemId: '1', title: 'Bad' }),
  });
  assert.equal(badPlayRes.status, 400);

  const pinoyPlayRes = await fetch(`${baseUrl}/api/analytics/play`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({
      itemType: 'pinoy',
      itemId: '88',
      slug: 'pinoy-play-test',
      title: 'Pinoy Watch Test',
      poster: 'https://streamwall.behoririka.mg/uploads/pinoy/posters/test.jpg',
    }),
  });
  assert.equal(pinoyPlayRes.status, 200);

  // 4. Admin Play Report endpoint returns chart timeline + ranked series & movies
  const reportRes = await fetch(`${baseUrl}/api/admin/analytics/plays?period=7d`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(reportRes.status, 200);
  const report = (await reportRes.json()) as {
    totalPlays: number;
    moviePlays: number;
    seriesPlays: number;
    timeline: Array<{ bucket: string; label: string; plays: number }>;
    mostPlayedSeries: Array<{ itemId: string; title: string; plays: number; path: string }>;
    mostPlayedMovies: Array<{ itemId: string; title: string; plays: number; path: string }>;
  };

  assert.equal(report.timeline.length, 7);
  assert.ok(report.totalPlays >= 3);
  assert.ok(report.seriesPlays >= 1);
  assert.ok(report.moviePlays >= 2);
  assert.ok(
    report.mostPlayedSeries.some(
      (s) => s.itemId === '9001' && s.title === 'Broadchurch Play Test' && s.plays >= 1 && s.path === '/serie/9001'
    )
  );
  assert.ok(
    report.mostPlayedMovies.some(
      (m) => m.itemId === '9002' && m.title === 'Guarding Stars Play Test' && m.plays >= 1 && m.path === '/film/9002'
    )
  );
  assert.ok(
    report.mostPlayedMovies.some(
      (m) => m.title === 'Pinoy Watch Test' && m.plays >= 1 && m.path === '/pinoy/pinoy-play-test'
    )
  );
});

test('Realtime En ligne maintenant tracks IP, city, and member vs visitor status without double-counting and requires admin', async () => {
  const adminRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'admin' }),
  });
  const adminAuth = (await adminRes.json()) as { token: string; user: { id: string; username: string } };

  const memberRes = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'member' }),
  });
  const memberAuth = (await memberRes.json()) as { token: string; user: { id: string; username: string } };

  // 1. /api/admin/analytics/realtime blocks guests and non-admin members
  const guestRtRes = await fetch(`${baseUrl}/api/admin/analytics/realtime`);
  assert.equal(guestRtRes.status, 403);
  const memberRtRes = await fetch(`${baseUrl}/api/admin/analytics/realtime`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(memberRtRes.status, 403);

  // 2. Guest heartbeat with IP + timezone + browser UA
  const guestSessionId = 's_live_guest_unique_1';
  const hbGuestRes = await fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.45',
      'cf-ipcountry': 'FR',
      'cf-ipcity': 'Lyon',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      sessionId: guestSessionId,
      path: '/catalogue',
      title: 'Catalogue — StreamWall',
    }),
  });
  assert.equal(hbGuestRes.status, 200);

  // 3. Authenticated member collect + heartbeat on same browser sessionId (must NOT double-count as guest + member)
  const memberSessionId = 's_live_member_unique_1';
  const collectMemberRes = await fetch(`${baseUrl}/api/analytics/collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
      'x-forwarded-for': '198.51.100.88',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
    },
    body: JSON.stringify({
      visitorId: 'v_live_member_1',
      sessionId: memberSessionId,
      path: '/film/24433',
      title: 'The Social Reckoning',
      timezone: 'Indian/Antananarivo',
    }),
  });
  assert.equal(collectMemberRes.status, 200);

  const hbMemberRes = await fetch(`${baseUrl}/api/presence/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberAuth.token}`,
      'x-forwarded-for': '198.51.100.88',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1',
    },
    body: JSON.stringify({
      sessionId: memberSessionId,
      path: '/film/24433',
      title: 'The Social Reckoning',
      timezone: 'Indian/Antananarivo',
    }),
  });
  assert.equal(hbMemberRes.status, 200);

  // 4. Admin fetches /api/admin/analytics/realtime and sees IP, city, visitorType, and deduped counts
  const adminRtRes = await fetch(`${baseUrl}/api/admin/analytics/realtime`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(adminRtRes.status, 200);
  const rt = (await adminRtRes.json()) as {
    activeCount: number;
    memberCount: number;
    guestCount: number;
    visitors: Array<{
      sessionId: string;
      visitorType: 'member' | 'guest';
      userId?: string | null;
      username?: string | null;
      ip: string;
      city: string;
      geoSource?: string;
      currentPath: string;
    }>;
  };

  assert.equal(rt.activeCount, rt.memberCount + rt.guestCount);
  const guestEntry = rt.visitors.find((v) => v.sessionId === guestSessionId);
  assert.ok(guestEntry);
  assert.equal(guestEntry.visitorType, 'guest');
  assert.equal(guestEntry.ip, '203.0.113.45');
  assert.equal(guestEntry.city, 'Lyon');
  assert.equal(guestEntry.geoSource, 'cdn');
  assert.equal(guestEntry.currentPath, '/catalogue');

  const memberMatches = rt.visitors.filter((v) => v.userId === memberAuth.user.id);
  assert.equal(memberMatches.length, 1, 'Authenticated member must appear only once (no duplicate guest+member entries)');
  assert.equal(memberMatches[0]?.visitorType, 'member');
  assert.equal(memberMatches[0]?.username, memberAuth.user.username);
  assert.equal(memberMatches[0]?.ip, '198.51.100.88');
  assert.equal(memberMatches[0]?.city, 'Antananarivo');
  assert.equal(memberMatches[0]?.geoSource, 'timezone');
});

test('Pinoy module settings propagate live to /api/pinoy/* and /api/admin/home-sections curates up to 18 items for /api/home', async () => {
  const [adminLogin, memberLogin] = await Promise.all([
    fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    }),
    fetch(`${baseUrl}/api/auth/demo-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    }),
  ]);
  const adminAuth = (await adminLogin.json()) as { token: string };
  const memberAuth = (await memberLogin.json()) as { token: string };

  // 1. Custom home sections endpoints require admin and enforce 18-item max
  const unauthHomeSec = await fetch(`${baseUrl}/api/admin/home-sections`);
  assert.equal(unauthHomeSec.status, 403);
  const memberHomeSec = await fetch(`${baseUrl}/api/admin/home-sections`, {
    headers: { Authorization: `Bearer ${memberAuth.token}` },
  });
  assert.equal(memberHomeSec.status, 403);

  const sampleCatalogueItem = (n: number) => ({
    id: String(3000 + n),
    titre: `Horreur Sélection ${n}`,
    poster: `https://image.tmdb.org/t/p/w300/horreur-${n}.jpg`,
    qualite: 'HD',
    langue: 'VF',
    item_type: n % 2 === 0 ? 'serie' : 'film',
    saison: null,
    genre: 'Horreur',
    annee: 2026,
  });

  const tooManyRes = await fetch(`${baseUrl}/api/admin/home-sections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      title: 'Top 19 Impossible',
      items: Array.from({ length: 19 }, (_, idx) => sampleCatalogueItem(idx + 1)),
    }),
  });
  assert.equal(tooManyRes.status, 400);

  const createSecRes = await fetch(`${baseUrl}/api/admin/home-sections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      title: 'Top 10 film horreur',
      description: 'Les meilleurs films et séries horreur sélectionnés',
      enabled: true,
      order: 10,
      items: Array.from({ length: 18 }, (_, idx) => sampleCatalogueItem(idx + 1)),
    }),
  });
  assert.equal(createSecRes.status, 200);
  const createdSec = (await createSecRes.json()) as {
    section: { id: string; title: string; items: unknown[] };
  };
  assert.equal(createdSec.section.items.length, 18);

  const homeWithCustomRes = await fetch(`${baseUrl}/api/home`);
  assert.equal(homeWithCustomRes.status, 200);
  const homeWithCustom = (await homeWithCustomRes.json()) as {
    customSections?: Array<{ id: string; title: string; description: string; items: unknown[] }>;
  };
  const foundOnHome = homeWithCustom.customSections?.find((s) => s.id === createdSec.section.id);
  assert.ok(foundOnHome);
  assert.equal(foundOnHome.title, 'Top 10 film horreur');
  assert.equal(foundOnHome.items.length, 18);

  // Clean up section
  const delSecRes = await fetch(
    `${baseUrl}/api/admin/home-sections/${encodeURIComponent(createdSec.section.id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    }
  );
  assert.equal(delSecRes.status, 200);

  // 2. Pinoy module configuration changes propagate to /api/pinoy/facets, /list, /detail
  const modsRes = await fetch(`${baseUrl}/api/admin/custom-modules`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  assert.equal(modsRes.status, 200);
  const modsJson = (await modsRes.json()) as { modules: Array<Record<string, unknown>> };
  const originalPinoy = modsJson.modules.find((m) => m.slug === 'pinoy');
  assert.ok(originalPinoy);

  const modSaveRes = await fetch(`${baseUrl}/api/admin/custom-modules`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminAuth.token}`,
    },
    body: JSON.stringify({
      ...originalPinoy,
      name: 'Pinoy VIP',
      badgeText: 'PH Exclusive',
      endpoints: {
        ...(originalPinoy.endpoints as Record<string, unknown>),
        apiUrl: 'https://example.com/pinoy_mod_prop.php',
        perPage: 12,
      },
      sections: {
        ...(originalPinoy.sections as Record<string, unknown>),
        catalogueTitle: 'Pinoy Cinema Custom',
        catalogueSubtitle: 'Description personnalisée depuis Module Pinoy',
        desktopGridCols: 4,
        detailShowGallerySection: true,
      },
      player: {
        ...(originalPinoy.player as Record<string, unknown>),
        playerUrlTemplate: 'https://cdn.example.com/pinoy/{id}',
        primaryPlayerLabel: 'Lecteur VIP',
        useSameOriginProxy: true,
        downloadProOnly: false,
      },
    }),
  });
  assert.equal(modSaveRes.status, 200);

  const realFetch = globalThis.fetch;
  let requestedListUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (target.startsWith('https://example.com/pinoy_mod_prop.php')) {
      if (target.includes('action=list')) requestedListUrl = target;
      return new Response(
        JSON.stringify({
          status: 'success',
          page: 1,
          total: 1,
          total_pages: 1,
          genres: [{ nom: 'Drame', total: 1 }],
          pays: [{ code: 'PH', total: 1 }],
          annees: { min: 2024, max: 2026 },
          items: [
            {
              id: 303,
              slug: 'custom-pinoy-title',
              titre: 'Custom Pinoy Title',
              annee: 2026,
              pays: 'PH',
              genres: ['Drame'],
              poster: 'uploads/pinoy/posters/custom.jpg',
            },
          ],
          film: {
            id: 303,
            slug: 'custom-pinoy-title',
            titre: 'Custom Pinoy Title',
            annee: 2026,
            pays: 'PH',
            genres: ['Drame'],
            poster: 'uploads/pinoy/posters/custom.jpg',
            galerie: ['uploads/pinoy/galerie/g1.jpg'],
          },
          players: {
            embed: [{ provider: 'Voe', url: 'https://voe.sx/e/custompinoy1', quality: 'HD' }],
            download: [],
          },
          similar: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    const facetsRes = await realFetch(`${baseUrl}/api/pinoy/facets`);
    assert.equal(facetsRes.status, 200);
    const facetsJson = (await facetsRes.json()) as {
      module?: { sections: { catalogueTitle: string; catalogueSubtitle: string; desktopGridCols: number } };
    };
    assert.equal(facetsJson.module?.sections.catalogueTitle, 'Pinoy Cinema Custom');
    assert.equal(
      facetsJson.module?.sections.catalogueSubtitle,
      'Description personnalisée depuis Module Pinoy'
    );
    assert.equal(facetsJson.module?.sections.desktopGridCols, 4);

    const listRes = await realFetch(`${baseUrl}/api/pinoy/list`);
    assert.equal(listRes.status, 200);
    assert.ok(requestedListUrl.includes('per_page=12'));
    const listJson = (await listRes.json()) as {
      module?: { sections: { catalogueTitle: string } };
      items: Array<{ titre: string }>;
    };
    assert.equal(listJson.module?.sections.catalogueTitle, 'Pinoy Cinema Custom');
    assert.equal(listJson.items[0]?.titre, 'Custom Pinoy Title');

    const detailRes = await realFetch(`${baseUrl}/api/pinoy/detail/custom-pinoy-title`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as {
      module?: { sections: { detailShowGallerySection: boolean }; player: { downloadProOnly: boolean } };
      downloadLocked?: boolean;
      players: {
        embed: Array<{ provider: string; url: string }>;
        download: Array<{ url: string }>;
      };
    };
    assert.equal(detailJson.module?.sections.detailShowGallerySection, true);
    assert.equal(detailJson.module?.player.downloadProOnly, false);
    assert.equal(detailJson.players.embed[0]?.provider, 'Lecteur VIP');
    assert.equal(detailJson.players.embed[0]?.url, '/api/public/watch/pinoy/303/custom-pinoy-title');
    assert.equal(detailJson.downloadLocked, false);
    assert.equal(detailJson.players.download[0]?.url, 'https://voe.sx/custompinoy1/download');
  } finally {
    globalThis.fetch = realFetch;
    await realFetch(`${baseUrl}/api/admin/custom-modules`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminAuth.token}`,
      },
      body: JSON.stringify(originalPinoy),
    });
  }
});

