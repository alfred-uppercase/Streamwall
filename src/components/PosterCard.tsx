import React, { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Film, Heart, Play, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { TYPE_LABELS } from '../shared/types';
import type { Item } from '../shared/types';
import { api, useAuth, useFavoritesSet, type MemberPayload } from '../lib/client';

export const FavoriteButton = memo(
  function FavoriteButton({
    item,
    compact = false,
  }: {
    item: Item;
    compact?: boolean;
  }) {
    const { isMember } = useAuth();
    const favoritesSet = useFavoritesSet();
    const queryClient = useQueryClient();

    const saved = favoritesSet.has(`${item.item_type}:${item.id}`);

    const mutation = useMutation({
      mutationFn: () => api.toggleFavorite(item),
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey: ['member'] });
        const previous = queryClient.getQueryData<MemberPayload>(['member']);
        if (previous) {
          const exists = previous.favorites.some(
            (f) => f.id === item.id && f.item_type === item.item_type
          );
          queryClient.setQueryData<MemberPayload>(['member'], {
            ...previous,
            favorites: exists
              ? previous.favorites.filter(
                  (f) => !(f.id === item.id && f.item_type === item.item_type)
                )
              : [item, ...previous.favorites],
          });
        }
        return { previous };
      },
      onSuccess: (res) => {
        toast.success(res.saved ? 'Ajouté à votre liste' : 'Retiré de votre liste');
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) {
          queryClient.setQueryData(['member'], ctx.previous);
        }
        toast.error('Impossible de modifier vos favoris.');
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: ['member'] });
      },
    });

    if (!isMember) return null;

    if (compact) {
      return (
        <button
          type="button"
          disabled={mutation.isPending}
          aria-label={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-pressed={saved}
          title={saved ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            mutation.mutate();
          }}
          className="inline-flex size-8 sm:size-9 items-center justify-center rounded-md sm:rounded-lg bg-background/85 text-foreground backdrop-blur transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Heart className={`size-3.5 sm:size-4 ${saved ? 'fill-primary text-primary' : 'text-foreground'}`} />
        </button>
      );
    }

    return (
      <button
        type="button"
        disabled={mutation.isPending}
        aria-pressed={saved}
        onClick={() => mutation.mutate()}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent whitespace-nowrap shrink-0"
      >
        <Heart className={`size-4 ${saved ? 'fill-primary text-primary' : ''}`} />
        <span>{saved ? 'Dans ma liste' : 'Ajouter à ma liste'}</span>
      </button>
    );
  },
  (prev, next) =>
    prev.compact === next.compact &&
    prev.item.id === next.item.id &&
    prev.item.item_type === next.item.item_type
);

export const PosterCard = memo(
  function PosterCard({
    item,
    subtitleOverride,
    rankNumber,
  }: {
    item: Item;
    subtitleOverride?: string;
    rankNumber?: number;
  }) {
    const [imgFailed, setImgFailed] = useState(false);

    useEffect(() => {
      setImgFailed(false);
    }, [item.poster]);

    const metaParts = [
      TYPE_LABELS[item.item_type] ?? item.item_type,
      item.annee ? String(item.annee) : null,
      item.qualite || null,
      item.langue || null,
    ].filter(Boolean);

    const showImg = Boolean(item.poster && !imgFailed);

    return (
      <div className="group relative flex flex-col">
        {typeof rankNumber === 'number' && (
          <p className="mb-1 sm:mb-1.5 text-[10px] sm:text-xs font-medium text-primary tabular-nums line-clamp-1">
            #{rankNumber}
            {subtitleOverride ? ` · ${subtitleOverride}` : ''}
          </p>
        )}
        <Link
          to={`/${item.item_type}/${item.id}`}
          className="block focus-visible:outline-2 focus-visible:outline-ring rounded-lg"
        >
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border bg-card transition-colors duration-200 group-hover:border-primary/80">
            {showImg ? (
              <img
                src={item.poster!}
                alt={item.titre}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 sm:gap-3 bg-gradient-to-b from-card to-background p-2.5 sm:p-4 text-center">
                {item.item_type === 'film' ? (
                  <Film className="size-6 sm:size-8 text-primary/70" />
                ) : (
                  <Tv className="size-6 sm:size-8 text-primary/70" />
                )}
                <span className="line-clamp-3 font-display text-[11px] sm:text-sm font-semibold text-foreground/90">
                  {item.titre}
                </span>
              </div>
            )}

            {/* Hover play affordance */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span className="inline-flex size-8 sm:size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                <Play className="size-3.5 sm:size-5 fill-current ml-0.5" />
              </span>
            </div>
          </div>

          <h3 className="mt-1.5 sm:mt-2.5 line-clamp-1 text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
            {item.titre}
          </h3>

          {/* Clean unboxed typographic metadata with · separators */}
          <p className="mt-0.5 line-clamp-1 text-[10px] sm:text-xs text-muted-foreground tabular-nums leading-tight">
            {typeof rankNumber !== 'number' && subtitleOverride
              ? subtitleOverride
              : metaParts.join(' · ')}
          </p>
        </Link>

        <div className="absolute right-1.5 top-1.5 sm:right-2 sm:top-2 z-10">
          <FavoriteButton item={item} compact />
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.subtitleOverride === next.subtitleOverride &&
    prev.rankNumber === next.rankNumber &&
    prev.item.id === next.item.id &&
    prev.item.item_type === next.item.item_type &&
    prev.item.titre === next.item.titre &&
    prev.item.poster === next.item.poster &&
    prev.item.annee === next.item.annee &&
    prev.item.qualite === next.item.qualite &&
    prev.item.langue === next.item.langue
);

export function PosterSkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-5 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="space-y-1.5 sm:space-y-2.5">
          <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-card border border-border" />
          <div className="h-3 sm:h-4 w-3/4 animate-pulse rounded bg-card" />
          <div className="h-2.5 sm:h-3 w-1/2 animate-pulse rounded bg-card" />
        </div>
      ))}
    </div>
  );
}
