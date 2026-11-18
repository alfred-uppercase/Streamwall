import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CornerDownRight, MessageSquare, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { CommentRecord } from '../shared/types';
import { api, useAuth } from '../lib/client';
import { ProCrownBadge, UserAvatar } from './UserAvatar';

export function renderMentions(body: string) {
  return body.split(/(@[\w.-]+)/g).map((part, idx) =>
    part.startsWith('@') ? (
      <span key={idx} className="font-semibold text-primary">
        {part}
      </span>
    ) : (
      <span key={idx}>{part}</span>
    )
  );
}

function CommentComposer({
  placeholder,
  autoFocus = false,
  onSubmit,
}: {
  placeholder: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { id: string; username: string; avatar: string | null; isPro?: boolean }[]
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionMatch = /@([\w.-]*)$/.exec(text);
  const mentionQuery = mentionMatch ? mentionMatch[1] : undefined;

  useEffect(() => {
    if (mentionQuery === undefined) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchMembers(mentionQuery);
        setSuggestions(res.members);
      } catch {
        setSuggestions([]);
      }
    }, 160);
    return () => window.clearTimeout(timer);
  }, [mentionQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText('');
      setSuggestions([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative space-y-2.5">
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        maxLength={1000}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-input bg-card p-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />

      {suggestions.length > 0 && (
        <ul className="absolute left-0 z-20 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl">
          {suggestions.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  setText((prev) =>
                    prev.replace(/@[\w.-]*$/, `@${m.username.replace(/\s+/g, '')} `)
                  );
                  setSuggestions([]);
                  textareaRef.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent"
              >
                <UserAvatar
                  avatar={m.avatar}
                  seed={m.id}
                  username={m.username}
                  isPro={m.isPro}
                  size="xs"
                />
                <span className="font-medium">@{m.username}</span>
                {m.isPro && <ProCrownBadge />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground tabular-nums">{text.length} / 1000</span>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {busy ? 'Publication…' : 'Publier'}
        </button>
      </div>
    </form>
  );
}

export function CommentsSection({
  itemType,
  itemId,
  itemTitle,
}: {
  itemType: string;
  itemId: string;
  itemTitle: string;
}) {
  const { user, isMember, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const commentsQuery = useQuery({
    queryKey: ['comments', itemType, itemId],
    queryFn: () => api.comments(itemType, itemId),
  });

  const memberQuery = useQuery({
    queryKey: ['member'],
    queryFn: () => api.member(),
    enabled: isMember,
  });

  const friendIds = new Set((memberQuery.data?.friends ?? []).map((f) => f.id));

  const addFriendMutation = useMutation({
    mutationFn: (friendId: string) => api.addFriend(friendId),
    onSuccess: () => {
      toast.success('Membre ajouté à vos amis');
      void queryClient.invalidateQueries({ queryKey: ['member'] });
    },
    onError: () => toast.error("Impossible d'ajouter cet ami."),
  });

  async function handlePost(body: string, parentId: string | null) {
    try {
      await api.addComment({ itemType, itemId, itemTitle, body, parentId });
      setReplyTo(null);
      await queryClient.invalidateQueries({ queryKey: ['comments', itemType, itemId] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Commentaire publié');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Commentaire impossible');
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await api.deleteComment(commentId);
      await queryClient.invalidateQueries({ queryKey: ['comments', itemType, itemId] });
      toast.success('Commentaire supprimé');
    } catch {
      toast.error('Suppression impossible');
    }
  }

  const allComments = commentsQuery.data?.comments ?? [];
  const roots = allComments.filter((c) => !c.parentId).reverse();

  const renderCard = (c: CommentRecord, isReply = false) => {
    const canDelete = Boolean(user && (user.id === c.userId || isAdmin));
    const canAddFriend = Boolean(user && c.userId !== user.id && !friendIds.has(c.userId));
    const isFriend = Boolean(user && friendIds.has(c.userId));

    return (
      <div
        key={c.id}
        className="rounded-lg border border-border bg-card p-4 transition-colors"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-sm">
            <UserAvatar
              avatar={c.avatar}
              seed={c.userId}
              username={c.username}
              isPro={c.isPro}
              size="sm"
            />
            <span className="font-semibold text-foreground">{c.username || 'Membre'}</span>
            {c.isPro && <ProCrownBadge />}
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {new Date(c.createdAt).toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </span>
            {isFriend && (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  ·
                </span>
                <span className="text-xs text-primary">Ami</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs">
            {canAddFriend && (
              <button
                type="button"
                onClick={() => addFriendMutation.mutate(c.userId)}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline whitespace-nowrap shrink-0"
              >
                <UserPlus className="size-3.5" />
                <span>Ajouter en ami</span>
              </button>
            )}
            {!isReply && isMember && (
              <button
                type="button"
                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                className="text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0"
              >
                Répondre
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => void handleDelete(c.id)}
                aria-label="Supprimer le commentaire"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive whitespace-nowrap shrink-0"
              >
                <Trash2 className="size-3.5" />
                <span>Supprimer</span>
              </button>
            )}
          </div>
        </div>

        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
          {renderMentions(c.body)}
        </p>
      </div>
    );
  };

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-semibold text-foreground tabular-nums">
          Commentaires ({allComments.length})
        </h2>
      </div>

      {isMember ? (
        <CommentComposer
          placeholder="Partagez votre avis sur ce titre… tapez @ pour mentionner un membre"
          onSubmit={(body) => handlePost(body, null)}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <MessageSquare className="size-5 text-primary shrink-0" />
            <p className="text-sm text-muted-foreground">
              Connectez-vous pour publier un avis, mentionner vos amis avec @ et participer aux discussions.
            </p>
          </div>
          <Link
            to="/auth"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
          >
            Se connecter
          </Link>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {roots.map((root) => {
          const replies = allComments.filter((r) => r.parentId === root.id);
          return (
            <div key={root.id} className="space-y-2.5">
              {renderCard(root, false)}
              {(replies.length > 0 || replyTo === root.id) && (
                <div className="space-y-2.5 pl-6 sm:pl-10">
                  {replies.map((reply) => (
                    <div key={reply.id} className="flex items-start gap-2.5">
                      <CornerDownRight className="mt-4 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">{renderCard(reply, true)}</div>
                    </div>
                  ))}
                  {replyTo === root.id && (
                    <div className="pt-1">
                      <CommentComposer
                        autoFocus
                        placeholder={`Répondre à @${root.username}…`}
                        onSubmit={(body) => handlePost(body, root.id)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {commentsQuery.isSuccess && roots.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">
            Aucun avis pour le moment. Soyez le premier à lancer la discussion.
          </p>
        )}
      </div>
    </section>
  );
}
