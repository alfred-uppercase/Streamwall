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
  assert.match(plansRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(popupsRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(siteRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(genresRes.headers.get('cache-control') || '', /^public, max-age=\d+/);
  assert.match(guestHomeRes.headers.get('cache-control') || '', /^public, max-age=30/);
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
    // 1. Guest receives same-origin Pinoy player URL, no download URLs + downloadLocked + custom message
    const guestDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`);
    assert.equal(guestDetailRes.status, 200);
    const guestDetail = (await guestDetailRes.json()) as {
      players: { embed: Array<{ provider: string; url: string }>; download: unknown[] };
      downloadLocked?: boolean;
      downloadMessage?: string;
    };
    assert.equal(guestDetail.players.embed[0]?.provider, 'Lecteur Pinoy');
    assert.equal(guestDetail.players.embed[0]?.url, '/api/public/watch/pinoy/15/milf-2026');
    assert.equal(guestDetail.players.download.length, 0);
    assert.equal(guestDetail.downloadLocked, true);
    assert.equal(guestDetail.downloadMessage, customDownloadMsg);

    // Same-origin Pinoy watch proxy strips X-Frame-Options and rewrites /uploads/
    const watchProxyRes = await realFetch(`${baseUrl}/api/public/watch/pinoy/15/milf-2026`);
    assert.equal(watchProxyRes.status, 200);
    assert.equal(watchProxyRes.headers.get('x-frame-options'), null);
    const watchHtml = await watchProxyRes.text();
    assert.ok(watchHtml.includes('https://cdn.behoririka.mg/uploads/pinoy/posters/milf-2026.jpg'));

    const badWatchProxyRes = await realFetch(`${baseUrl}/api/public/watch/pinoy/not-numeric`);
    assert.equal(badWatchProxyRes.status, 400);

    // 2. Free member receives no download URLs + downloadLocked + custom message
    const freeDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`, {
      headers: { Authorization: `Bearer ${memberAuth.token}` },
    });
    assert.equal(freeDetailRes.status, 200);
    const freeDetail = (await freeDetailRes.json()) as {
      players: { download: unknown[] };
      downloadLocked?: boolean;
      downloadMessage?: string;
    };
    assert.equal(freeDetail.players.download.length, 0);
    assert.equal(freeDetail.downloadLocked, true);
    assert.equal(freeDetail.downloadMessage, customDownloadMsg);

    // 3. Admin receives direct download URLs + downloadLocked=false
    const adminDetailRes = await realFetch(`${baseUrl}/api/pinoy/detail/milf-2026`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    assert.equal(adminDetailRes.status, 200);
    const adminDetail = (await adminDetailRes.json()) as {
      players: { download: Array<{ url: string }> };
      downloadLocked?: boolean;
    };
    assert.equal(adminDetail.downloadLocked, false);
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




