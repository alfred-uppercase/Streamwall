import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_PLAYERS,
  PLAYER_KEYS,
  TEMPLATE_RE,
  type AdminUserSummary,
  type CommentRecord,
  type FriendRecord,
  type Item,
  type ItemType,
  type PlayerKey,
  type PlayerTemplates,
  type RankingEntry,
  type SiteConfig,
  type UserProfile,
  type WatchEventRecord,
} from '../shared/types.ts';

function getSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
  return { url, key, serviceKey };
}

export function isSupabaseEnabled(): boolean {
  const { url, key } = getSupabaseEnv();
  return Boolean(url && key);
}

function isOpaqueSupabaseKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_');
}

function createSupabaseFetch(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }
    if (isOpaqueSupabaseKey(apiKey) && headers.get('Authorization') === `Bearer ${apiKey}`) {
      headers.delete('Authorization');
    }
    headers.set('apikey', apiKey);
    const signal =
      init?.signal ??
      (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8_000)
        : undefined);
    return fetch(input, { ...init, headers, signal });
  };
}

export function createAnonClient(): SupabaseClient {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(accessToken: string): SupabaseClient {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAdminClient(): SupabaseClient | null {
  const { url, serviceKey } = getSupabaseEnv();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    global: { fetch: createSupabaseFetch(serviceKey) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const SB_USER_CACHE_TTL_MS = 30_000;
const SB_USER_NEGATIVE_TTL_MS = 15_000;
const sbUserCache = new Map<string, { expiresAt: number; user: UserProfile | null }>();

function hashTokenKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isLikelyValidJwt(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function invalidateSbUserCache(target?: { token?: string; userId?: string }): void {
  if (!target) {
    sbUserCache.clear();
    return;
  }
  if (target.token) {
    sbUserCache.delete(hashTokenKey(target.token));
  }
  if (target.userId) {
    for (const [k, entry] of sbUserCache.entries()) {
      if (entry.user?.id === target.userId) {
        sbUserCache.delete(k);
      }
    }
  }
}

export async function sbResolveUser(
  token: string | null,
  options?: { skipCache?: boolean }
): Promise<{ user: UserProfile; client: SupabaseClient } | null> {
  if (!token) return null;
  if (!isLikelyValidJwt(token)) return null;

  const cacheKey = hashTokenKey(token);
  if (!options?.skipCache) {
    const hit = sbUserCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      if (!hit.user) return null;
      return { user: hit.user, client: createUserClient(token) };
    }
    if (hit) sbUserCache.delete(cacheKey);
  }

  try {
    const client = createUserClient(token);
    const { data: authData, error } = await client.auth.getUser(token);
    if (error || !authData.user) {
      if (sbUserCache.size > 500) sbUserCache.clear();
      sbUserCache.set(cacheKey, {
        expiresAt: Date.now() + SB_USER_NEGATIVE_TTL_MS,
        user: null,
      });
      return null;
    }

    const uid = authData.user.id;
    const adminSb = createAdminClient();
    const dbReader = adminSb ?? client;

    const [profileRes, rpcRoleRes, tableRoleRes] = await Promise.all([
      dbReader.from('profiles').select('*').eq('id', uid).maybeSingle(),
      client.rpc('has_role', { _user_id: uid, _role: 'admin' }),
      dbReader
        .from('user_roles')
        .select('role')
        .eq('user_id', uid)
        .eq('role', 'admin')
        .maybeSingle(),
    ]);

    const profileRow = (profileRes.data ?? null) as Record<string, unknown> | null;
    const appMeta = (authData.user.app_metadata ?? {}) as Record<string, unknown>;
    const userMeta = (authData.user.user_metadata ?? {}) as Record<string, unknown>;

    const isAdmin = Boolean(
      rpcRoleRes.data === true ||
        tableRoleRes.data?.role === 'admin' ||
        profileRow?.role === 'admin' ||
        profileRow?.is_admin === true ||
        appMeta.role === 'admin' ||
        userMeta.role === 'admin' ||
        (Array.isArray(appMeta.roles) && appMeta.roles.includes('admin'))
    );

    let avatarUrl: string | null = null;
    const avatarPath =
      typeof profileRow?.avatar_path === 'string'
        ? profileRow.avatar_path
        : typeof profileRow?.avatar_url === 'string'
          ? profileRow.avatar_url
          : null;
    if (avatarPath) {
      if (/^https?:\/\//i.test(avatarPath)) {
        avatarUrl = avatarPath;
      } else {
        const signed = await client.storage.from('avatars').createSignedUrl(avatarPath, 3600);
        avatarUrl = signed.data?.signedUrl ?? null;
      }
    }

    const username =
      (typeof profileRow?.username === 'string' && profileRow.username) ||
      (typeof userMeta.username === 'string' && userMeta.username) ||
      (typeof userMeta.full_name === 'string' && userMeta.full_name) ||
      (authData.user.email ? authData.user.email.split('@')[0] : '') ||
      'Membre';

    const createdAt =
      (typeof profileRow?.created_at === 'string' && profileRow.created_at) ||
      authData.user.created_at ||
      new Date().toISOString();

    const user: UserProfile = {
      id: uid,
      email: authData.user.email ?? '',
      username,
      avatar: avatarUrl,
      role: isAdmin ? 'admin' : 'member',
      createdAt,
    };

    if (sbUserCache.size > 500) sbUserCache.clear();
    sbUserCache.set(cacheKey, {
      expiresAt: Date.now() + SB_USER_CACHE_TTL_MS,
      user,
    });

    return { client, user };
  } catch {
    return null;
  }
}

const SB_SETTINGS_TTL_MS = 60_000;
const sbSettingsCache = new Map<string, { expiresAt: number; value: unknown }>();

export function invalidateSbSettingsCache(): void {
  sbSettingsCache.clear();
}

function getSbCached<T>(key: string): T | null {
  const hit = sbSettingsCache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    sbSettingsCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function setSbCached<T>(key: string, value: T): T {
  sbSettingsCache.set(key, { expiresAt: Date.now() + SB_SETTINGS_TTL_MS, value });
  return value;
}

export async function sbGetApiOrigin(fallbackOrigin: string): Promise<string> {
  const cached = getSbCached<string>('api_origin');
  if (cached) return cached;
  try {
    const sb = createAnonClient();
    const { data } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'api_origin')
      .maybeSingle();
    if (data?.value && /^https?:\/\/[^/]+/.test(data.value)) {
      return setSbCached('api_origin', data.value.replace(/\/+$/, ''));
    }
  } catch {
    // Fall back gracefully
  }
  return setSbCached('api_origin', fallbackOrigin);
}

export async function sbGetEmbedProvider(fallbackProvider: string): Promise<string> {
  const cached = getSbCached<string>('embed_provider');
  if (cached) return cached;
  try {
    const sb = createAnonClient();
    const { data } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'embed_provider')
      .maybeSingle();
    if (data?.value && /^https?:\/\/[^/]+/.test(data.value)) {
      return setSbCached('embed_provider', data.value.replace(/\/+$/, ''));
    }
  } catch {
    // Fall back gracefully
  }
  return setSbCached('embed_provider', fallbackProvider);
}

export async function sbGetTmdbApiKey(fallbackKey: string): Promise<string> {
  const cached = getSbCached<string>('tmdb_api_key');
  if (cached) return cached;
  try {
    const sb = createAnonClient();
    const { data } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'tmdb_api_key')
      .maybeSingle();
    if (data?.value && String(data.value).trim()) {
      return setSbCached('tmdb_api_key', String(data.value).trim());
    }
  } catch {
    // Fall back gracefully
  }
  return setSbCached('tmdb_api_key', fallbackKey);
}

export async function sbGetSiteConfig(fallback: SiteConfig): Promise<SiteConfig> {
  const cached = getSbCached<SiteConfig>('site_config');
  if (cached) return cached;
  try {
    const sb = createAdminClient() ?? createAnonClient();
    const { data } = await sb
      .from('app_settings')
      .select('key,value')
      .in('key', ['site_name', 'favicon_url']);
    const out: SiteConfig = { ...fallback };
    for (const row of (data ?? []) as { key: string; value: string }[]) {
      if (row.key === 'site_name' && typeof row.value === 'string' && row.value.trim()) {
        out.siteName = row.value.trim();
      }
      if (row.key === 'favicon_url' && typeof row.value === 'string' && row.value.trim()) {
        out.faviconUrl = row.value.trim();
      }
    }
    return setSbCached('site_config', out);
  } catch {
    return setSbCached('site_config', fallback);
  }
}

export async function sbGetPlayerTemplates(): Promise<PlayerTemplates> {
  const cached = getSbCached<PlayerTemplates>('player_templates');
  if (cached) return cached;
  const out = { ...DEFAULT_PLAYERS };
  try {
    const sb = createAnonClient();
    const { data } = await sb
      .from('app_settings')
      .select('key,value')
      .in('key', PLAYER_KEYS as unknown as string[]);
    for (const row of (data ?? []) as { key: PlayerKey; value: string }[]) {
      if (TEMPLATE_RE.test(row.value)) {
        out[row.key] = row.value;
      }
    }
  } catch {
    // Use defaults
  }
  return setSbCached('player_templates', out);
}

export async function sbGetRankings(
  client: SupabaseClient | null,
  days: number
): Promise<RankingEntry[]> {
  const sb = client ?? createAdminClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb.rpc('film_rankings', { days });
    if (error || !Array.isArray(data)) return [];
    return data.map((r: { item: Item; views: number }) => ({
      item: r.item,
      viewers: Number(r.views) || 0,
      plays: Number(r.views) || 0,
    }));
  } catch {
    return [];
  }
}

export async function sbGetMemberData(
  client: SupabaseClient,
  profile: UserProfile
): Promise<{
  profile: UserProfile;
  favorites: Item[];
  history: WatchEventRecord[];
  friends: FriendRecord[];
}> {
  const [favRes, histRes, friendsRes] = await Promise.all([
    client
      .from('favorites')
      .select('item,created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false }),
    client
      .from('watch_events')
      .select('id,user_id,item,viewed_at')
      .eq('user_id', profile.id)
      .order('viewed_at', { ascending: false })
      .limit(50),
    client.rpc('my_friends'),
  ]);

  const favorites: Item[] = ((favRes.data ?? []) as { item: Item }[]).map((r) => r.item);
  const history: WatchEventRecord[] = (
    (histRes.data ?? []) as { id: string; user_id: string; item: Item; viewed_at: string }[]
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    item: r.item,
    season: 1,
    episode: 1,
    viewedAt: r.viewed_at,
  }));

  const friends: FriendRecord[] = ((friendsRes.data ?? []) as { id: string; username: string }[]).map(
    (f) => ({
      id: f.id,
      username: f.username,
      avatar: null,
      online: false,
      currentItem: null,
      recentWatch: null,
    })
  );

  return { profile, favorites, history, friends };
}

export async function sbGetComments(
  client: SupabaseClient | null,
  itemType: string,
  itemId: string
): Promise<CommentRecord[]> {
  if (!client) return [];
  const { data, error } = await client.rpc('item_comments', {
    _type: itemType,
    _id: itemId,
  });
  if (error || !Array.isArray(data)) return [];
  return data.map(
    (c: {
      id: string;
      parent_id: string | null;
      user_id: string;
      username: string;
      body: string;
      created_at: string;
    }) => ({
      id: c.id,
      itemType: itemType as ItemType,
      itemId,
      userId: c.user_id,
      username: c.username,
      avatar: null,
      parentId: c.parent_id,
      body: c.body,
      createdAt: c.created_at,
    })
  );
}

function aggregateTopFromWatchEvents(
  events: Array<{ user_id: string; item: Item | null; viewed_at: string }>,
  days: number
): RankingEntry[] {
  const since = Date.now() - days * 86_400_000;
  const map = new Map<string, { item: Item; viewers: Set<string>; plays: number }>();
  for (const ev of events) {
    if (!ev.item || !ev.item.id) continue;
    const ts = new Date(ev.viewed_at).getTime();
    if (ts < since) continue;
    const key = `${ev.item.item_type}:${ev.item.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.viewers.add(ev.user_id);
      existing.plays += 1;
    } else {
      map.set(key, {
        item: ev.item,
        viewers: new Set([ev.user_id]),
        plays: 1,
      });
    }
  }
  return [...map.values()]
    .sort((a, b) => b.viewers.size - a.viewers.size || b.plays - a.plays)
    .slice(0, 12)
    .map((r) => ({ item: r.item, viewers: r.viewers.size, plays: r.plays }));
}

export async function sbGetAdminOverview(client: SupabaseClient): Promise<{
  users: AdminUserSummary[];
  top7: RankingEntry[];
  top30: RankingEntry[];
  source: 'supabase_auth' | 'supabase_rpc' | 'supabase_profiles';
  warning: string | null;
}> {
  const adminSb = createAdminClient();
  const dbReader = adminSb ?? client;

  let users: AdminUserSummary[] = [];
  let source: 'supabase_auth' | 'supabase_rpc' | 'supabase_profiles' = 'supabase_rpc';
  let warning: string | null = null;

  // Fetch auxiliary tables safely (roles, profiles, watch events — live presence removed)
  const [profilesRes, rolesRes, watchRes] = await Promise.all([
    dbReader.from('profiles').select('*'),
    dbReader.from('user_roles').select('user_id,role'),
    dbReader
      .from('watch_events')
      .select('user_id,item,viewed_at')
      .order('viewed_at', { ascending: false })
      .limit(1000),
  ]);

  const profileRows = ((profilesRes.data ?? []) as Array<Record<string, unknown>>);
  const profileById = new Map<string, Record<string, unknown>>(
    profileRows.map((p) => [String(p.id), p])
  );

  const adminSet = new Set<string>(
    ((rolesRes.data ?? []) as Array<{ user_id: string; role: string }>)
      .filter((r) => r.role === 'admin')
      .map((r) => String(r.user_id))
  );

  const watchRows = (watchRes.data ?? []) as Array<{
    user_id: string;
    item: Item | null;
    viewed_at: string;
  }>;
  const playsById = new Map<string, number>();
  for (const w of watchRows) {
    playsById.set(String(w.user_id), (playsById.get(String(w.user_id)) ?? 0) + 1);
  }

  // Strategy 1: Service-role Supabase Auth admin.listUsers() — lists ALL real auth.users
  if (adminSb) {
    try {
      const authListRes = await adminSb.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!authListRes.error && Array.isArray(authListRes.data?.users)) {
        source = 'supabase_auth';
        users = authListRes.data.users.map((au) => {
          const prof = profileById.get(au.id);
          const userMeta = (au.user_metadata ?? {}) as Record<string, unknown>;
          const appMeta = (au.app_metadata ?? {}) as Record<string, unknown>;
          const username =
            (typeof prof?.username === 'string' && prof.username) ||
            (typeof userMeta.username === 'string' && userMeta.username) ||
            (typeof userMeta.full_name === 'string' && userMeta.full_name) ||
            (au.email ? au.email.split('@')[0] : 'Membre');
          const isAdmin =
            adminSet.has(au.id) ||
            prof?.role === 'admin' ||
            prof?.is_admin === true ||
            appMeta.role === 'admin' ||
            userMeta.role === 'admin';
          return {
            id: au.id,
            email: au.email ?? '',
            username,
            avatar: typeof prof?.avatar_url === 'string' ? prof.avatar_url : null,
            isAdmin: Boolean(isAdmin),
            createdAt: au.created_at || new Date().toISOString(),
            lastSeen: null,
            online: false,
            currentItem: null,
            currentPage: null,
            plays: playsById.get(au.id) ?? 0,
          };
        });
      }
    } catch {
      // Fall through to RPC / profiles strategies
    }
  }

  // Strategy 2: Existing admin_users() RPC
  if (users.length === 0) {
    const rpcRes = await dbReader.rpc('admin_users');
    if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
      source = 'supabase_rpc';
      users = (
        rpcRes.data as Array<{
          id: string;
          username: string;
          email: string;
          created_at: string;
          last_seen: string | null;
          current_item: Item | null;
          is_admin: boolean;
          plays: number;
        }>
      ).map((u) => ({
        id: u.id,
        email: u.email || '—',
        username: u.username || 'Membre',
        avatar: null,
        isAdmin: Boolean(u.is_admin || adminSet.has(u.id)),
        createdAt: u.created_at,
        lastSeen: null,
        online: false,
        currentItem: null,
        currentPage: null,
        plays: Number(u.plays) || playsById.get(u.id) || 0,
      }));
    } else if (profileRows.length > 0) {
      // Strategy 3: Direct profiles table read
      source = 'supabase_profiles';
      users = profileRows.map((p) => {
        const id = String(p.id);
        return {
          id,
          email: typeof p.email === 'string' && p.email ? p.email : 'Compte Supabase',
          username: typeof p.username === 'string' && p.username ? p.username : 'Membre',
          avatar: typeof p.avatar_url === 'string' ? p.avatar_url : null,
          isAdmin: Boolean(adminSet.has(id) || p.role === 'admin' || p.is_admin === true),
          createdAt:
            typeof p.created_at === 'string' ? p.created_at : new Date().toISOString(),
          lastSeen: null,
          online: false,
          currentItem: null,
          currentPage: null,
          plays: playsById.get(id) ?? 0,
        };
      });

      if (!adminSb) {
        warning =
          'Ajoutez la clé secrète SUPABASE_SERVICE_ROLE_KEY dans les Secrets pour lister tous les comptes Auth Supabase (emails et comptes protégés par RLS).';
      }
    } else if (!adminSb) {
      warning =
        'La fonction RPC admin_users et la table profiles ne sont pas accessibles en lecture sans SUPABASE_SERVICE_ROLE_KEY dans les Secrets.';
    }
  }

  // Sort newest accounts first
  users.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Top 7 / Top 30 rankings (never fail overview if RPC isn't present)
  const mapTop = (rows: Array<{ item: Item; viewers: number; plays: number }>): RankingEntry[] =>
    (rows ?? []).map((r) => ({
      item: r.item,
      viewers: Number(r.viewers) || 0,
      plays: Number(r.plays) || 0,
    }));

  const [top7Res, top30Res] = await Promise.all([
    dbReader.rpc('admin_top_titles', { days: 7 }),
    dbReader.rpc('admin_top_titles', { days: 30 }),
  ]);

  const top7 =
    !top7Res.error && Array.isArray(top7Res.data)
      ? mapTop(top7Res.data)
      : aggregateTopFromWatchEvents(watchRows, 7);

  const top30 =
    !top30Res.error && Array.isArray(top30Res.data)
      ? mapTop(top30Res.data)
      : aggregateTopFromWatchEvents(watchRows, 30);

  return {
    users,
    top7,
    top30,
    source,
    warning,
  };
}
