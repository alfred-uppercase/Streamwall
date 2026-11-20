import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FriendRequestRecord } from '../shared/types.ts';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const FRIEND_REQUESTS_FILE = path.join(DATA_DIR, 'tapenaka-friend-requests.json');

interface FriendRequestsDatabase {
  requests: FriendRequestRecord[];
}

function loadFriendRequestsDb(): FriendRequestsDatabase {
  const parsed = readModuleSnapshot<FriendRequestsDatabase>(
    'friend_requests',
    FRIEND_REQUESTS_FILE
  );
  if (parsed && Array.isArray(parsed.requests)) {
    return { requests: parsed.requests };
  }
  return { requests: [] };
}

function saveFriendRequestsDb(state: FriendRequestsDatabase): void {
  writeModuleSnapshot('friend_requests', state);
}

const friendRequestsDb: FriendRequestsDatabase = loadFriendRequestsDb();

export interface FriendUserStub {
  id: string;
  username: string;
  avatar: string | null;
  isPro?: boolean;
}

export type CreateFriendRequestOutcome =
  | { outcome: 'already_friends'; request: null }
  | { outcome: 'already_pending'; request: FriendRequestRecord }
  | { outcome: 'matched_accept'; request: FriendRequestRecord }
  | { outcome: 'created'; request: FriendRequestRecord };

export function listUserFriendRequests(userId: string): {
  incoming: FriendRequestRecord[];
  outgoing: FriendRequestRecord[];
} {
  const pending = friendRequestsDb.requests.filter((r) => r.status === 'pending');
  const incoming = pending
    .filter((r) => r.toUserId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const outgoing = pending
    .filter((r) => r.fromUserId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { incoming, outgoing };
}

export function getFriendRequestById(requestId: string): FriendRequestRecord | null {
  return friendRequestsDb.requests.find((r) => r.id === requestId) ?? null;
}

export function createOrMatchFriendRequest(input: {
  fromUser: FriendUserStub;
  toUser: FriendUserStub;
  alreadyFriends?: boolean;
}): CreateFriendRequestOutcome {
  if (input.alreadyFriends) {
    return { outcome: 'already_friends', request: null };
  }

  const now = new Date().toISOString();

  // If receiver already sent a pending request to sender, accept it mutually immediately
  const reversePending = friendRequestsDb.requests.find(
    (r) =>
      r.status === 'pending' &&
      r.fromUserId === input.toUser.id &&
      r.toUserId === input.fromUser.id
  );
  if (reversePending) {
    reversePending.status = 'accepted';
    reversePending.toUsername = input.fromUser.username;
    reversePending.toAvatar = input.fromUser.avatar;
    reversePending.toIsPro = Boolean(input.fromUser.isPro);
    reversePending.fromUsername = input.toUser.username;
    reversePending.fromAvatar = input.toUser.avatar;
    reversePending.fromIsPro = Boolean(input.toUser.isPro);
    reversePending.updatedAt = now;
    saveFriendRequestsDb(friendRequestsDb);
    return { outcome: 'matched_accept', request: reversePending };
  }

  // Avoid duplicate pending outgoing request
  const existingOutgoing = friendRequestsDb.requests.find(
    (r) =>
      r.status === 'pending' &&
      r.fromUserId === input.fromUser.id &&
      r.toUserId === input.toUser.id
  );
  if (existingOutgoing) {
    existingOutgoing.fromUsername = input.fromUser.username;
    existingOutgoing.fromAvatar = input.fromUser.avatar;
    existingOutgoing.fromIsPro = Boolean(input.fromUser.isPro);
    existingOutgoing.toUsername = input.toUser.username;
    existingOutgoing.toAvatar = input.toUser.avatar;
    existingOutgoing.toIsPro = Boolean(input.toUser.isPro);
    existingOutgoing.updatedAt = now;
    saveFriendRequestsDb(friendRequestsDb);
    return { outcome: 'already_pending', request: existingOutgoing };
  }

  // Clean up any stale declined/accepted record between the pair before creating fresh pending request
  friendRequestsDb.requests = friendRequestsDb.requests.filter(
    (r) =>
      !(
        (r.fromUserId === input.fromUser.id && r.toUserId === input.toUser.id) ||
        (r.fromUserId === input.toUser.id && r.toUserId === input.fromUser.id)
      )
  );

  const created: FriendRequestRecord = {
    id: `freq_${crypto.randomBytes(6).toString('hex')}`,
    fromUserId: input.fromUser.id,
    fromUsername: input.fromUser.username,
    fromAvatar: input.fromUser.avatar,
    fromIsPro: Boolean(input.fromUser.isPro),
    toUserId: input.toUser.id,
    toUsername: input.toUser.username,
    toAvatar: input.toUser.avatar,
    toIsPro: Boolean(input.toUser.isPro),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  friendRequestsDb.requests.unshift(created);
  if (friendRequestsDb.requests.length > 5000) {
    friendRequestsDb.requests = friendRequestsDb.requests.slice(0, 5000);
  }
  saveFriendRequestsDb(friendRequestsDb);
  return { outcome: 'created', request: created };
}

export function acceptFriendRequest(
  requestId: string,
  actingUserId: string
): { ok: true; request: FriendRequestRecord } | { ok: false; error: string; status: number } {
  const target = friendRequestsDb.requests.find((r) => r.id === requestId);
  if (!target) {
    return { ok: false, error: 'Demande d’ami introuvable.', status: 404 };
  }
  if (target.toUserId !== actingUserId) {
    return { ok: false, error: 'Action non autorisée sur cette demande.', status: 403 };
  }
  if (target.status !== 'pending') {
    return { ok: false, error: 'Cette demande a déjà été traitée.', status: 400 };
  }
  target.status = 'accepted';
  target.updatedAt = new Date().toISOString();
  saveFriendRequestsDb(friendRequestsDb);
  return { ok: true, request: target };
}

export function declineFriendRequest(
  requestId: string,
  actingUserId: string
): { ok: true; request: FriendRequestRecord } | { ok: false; error: string; status: number } {
  const target = friendRequestsDb.requests.find((r) => r.id === requestId);
  if (!target) {
    return { ok: false, error: 'Demande d’ami introuvable.', status: 404 };
  }
  if (target.toUserId !== actingUserId) {
    return { ok: false, error: 'Action non autorisée sur cette demande.', status: 403 };
  }
  if (target.status !== 'pending') {
    return { ok: false, error: 'Cette demande a déjà été traitée.', status: 400 };
  }
  target.status = 'declined';
  target.updatedAt = new Date().toISOString();
  saveFriendRequestsDb(friendRequestsDb);
  return { ok: true, request: target };
}

export function cancelFriendRequest(
  requestId: string,
  actingUserId: string
): { ok: true; request: FriendRequestRecord } | { ok: false; error: string; status: number } {
  const target = friendRequestsDb.requests.find((r) => r.id === requestId);
  if (!target) {
    return { ok: false, error: 'Demande d’ami introuvable.', status: 404 };
  }
  if (target.fromUserId !== actingUserId) {
    return { ok: false, error: 'Vous ne pouvez annuler que vos propres demandes.', status: 403 };
  }
  if (target.status !== 'pending') {
    return { ok: false, error: 'Cette demande n’est plus en attente.', status: 400 };
  }
  friendRequestsDb.requests = friendRequestsDb.requests.filter((r) => r.id !== requestId);
  saveFriendRequestsDb(friendRequestsDb);
  return { ok: true, request: target };
}

export function clearFriendRequestsBetween(userA: string, userB: string): void {
  const before = friendRequestsDb.requests.length;
  friendRequestsDb.requests = friendRequestsDb.requests.filter(
    (r) =>
      !(
        (r.fromUserId === userA && r.toUserId === userB) ||
        (r.fromUserId === userB && r.toUserId === userA)
      )
  );
  if (friendRequestsDb.requests.length !== before) {
    saveFriendRequestsDb(friendRequestsDb);
  }
}

export function cleanupUserFriendRequests(userId: string): void {
  const before = friendRequestsDb.requests.length;
  friendRequestsDb.requests = friendRequestsDb.requests.filter(
    (r) => r.fromUserId !== userId && r.toUserId !== userId
  );
  if (friendRequestsDb.requests.length !== before) {
    saveFriendRequestsDb(friendRequestsDb);
  }
}
