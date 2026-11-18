import React from 'react';
import { Crown } from 'lucide-react';

export interface AvatarPreset {
  id: string;
  label: string;
  bgFrom: string;
  bgTo: string;
  accent: string;
  skin: string;
  hair: string;
  motif: 'glasses' | 'headphones' | 'beret' | 'star' | 'popcorn' | 'clapper' | 'cat' | 'visor' | 'cap' | 'moon' | 'flame' | 'ticket';
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'avatar:01',
    label: 'Cinéphile',
    bgFrom: '#1e293b',
    bgTo: '#0f172a',
    accent: '#f59e0b',
    skin: '#f3d2b3',
    hair: '#1e1b4b',
    motif: 'glasses',
  },
  {
    id: 'avatar:02',
    label: 'Réalisateur',
    bgFrom: '#312e81',
    bgTo: '#1e1b4b',
    accent: '#fbbf24',
    skin: '#e0ac82',
    hair: '#0f172a',
    motif: 'beret',
  },
  {
    id: 'avatar:03',
    label: 'Bande-son',
    bgFrom: '#064e3b',
    bgTo: '#022c22',
    accent: '#34d399',
    skin: '#f5cfa0',
    hair: '#3f2e21',
    motif: 'headphones',
  },
  {
    id: 'avatar:04',
    label: 'Nocturne',
    bgFrom: '#4c1d95',
    bgTo: '#2e1065',
    accent: '#c084fc',
    skin: '#d99b72',
    hair: '#18181b',
    motif: 'moon',
  },
  {
    id: 'avatar:05',
    label: 'Avant-première',
    bgFrom: '#7f1d1d',
    bgTo: '#450a0a',
    accent: '#fb7185',
    skin: '#fde0c8',
    hair: '#451a03',
    motif: 'star',
  },
  {
    id: 'avatar:06',
    label: 'Popcorn',
    bgFrom: '#78350f',
    bgTo: '#451a03',
    accent: '#fcd34d',
    skin: '#eab38f',
    hair: '#292524',
    motif: 'popcorn',
  },
  {
    id: 'avatar:07',
    label: 'Studio',
    bgFrom: '#0c4a6e',
    bgTo: '#082f49',
    accent: '#38bdf8',
    skin: '#f3d2b3',
    hair: '#1f2937',
    motif: 'clapper',
  },
  {
    id: 'avatar:08',
    label: 'Neko Anime',
    bgFrom: '#701a75',
    bgTo: '#4a044e',
    accent: '#f472b6',
    skin: '#f8d9c0',
    hair: '#31102f',
    motif: 'cat',
  },
  {
    id: 'avatar:09',
    label: 'Sci-Fi',
    bgFrom: '#134e4a',
    bgTo: '#042f2e',
    accent: '#2dd4bf',
    skin: '#c68b65',
    hair: '#0f172a',
    motif: 'visor',
  },
  {
    id: 'avatar:10',
    label: 'Action',
    bgFrom: '#7c2d12',
    bgTo: '#431407',
    accent: '#fb923c',
    skin: '#e7b590',
    hair: '#27272a',
    motif: 'cap',
  },
  {
    id: 'avatar:11',
    label: 'Culte',
    bgFrom: '#831843',
    bgTo: '#500724',
    accent: '#fda4af',
    skin: '#b87a56',
    hair: '#111827',
    motif: 'flame',
  },
  {
    id: 'avatar:12',
    label: 'Grand Écran',
    bgFrom: '#1e3a8a',
    bgTo: '#172554',
    accent: '#facc15',
    skin: '#f5cfa0',
    hair: '#334155',
    motif: 'ticket',
  },
];

export function resolveAvatarPreset(avatarId?: string | null, seed?: string): AvatarPreset {
  if (avatarId) {
    const found = AVATAR_PRESETS.find((p) => p.id === avatarId);
    if (found) return found;
  }
  const source = seed || avatarId || 'streamwall';
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PRESETS[hash % AVATAR_PRESETS.length];
}

export function getRandomAvatarId(excludeId?: string | null): string {
  const pool = AVATAR_PRESETS.filter((p) => p.id !== excludeId);
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? AVATAR_PRESETS[0];
  return pick.id;
}

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
  xl: 'size-20',
};

const CROWN_CLASSES: Record<AvatarSize, { wrap: string; icon: string }> = {
  xs: { wrap: '-top-1.5 -right-1.5 size-4', icon: 'size-2.5' },
  sm: { wrap: '-top-1.5 -right-1.5 size-4', icon: 'size-2.5' },
  md: { wrap: '-top-1.5 -right-1.5 size-5', icon: 'size-3' },
  lg: { wrap: '-top-2 -right-2 size-6', icon: 'size-3.5' },
  xl: { wrap: '-top-2 -right-1 size-7', icon: 'size-4' },
};

export function ProCrownBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Membre Pro"
      className={`inline-flex items-center gap-1 rounded border border-amber-400/50 bg-amber-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 whitespace-nowrap shrink-0 ${className}`}
    >
      <Crown className="size-3 fill-amber-400 text-amber-300" />
      <span>Pro</span>
    </span>
  );
}

export function AvatarArtwork({
  preset,
  className = 'size-full',
}: {
  preset: AvatarPreset;
  className?: string;
}) {
  const gradId = `av_g_${preset.id.replace(':', '_')}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={preset.bgFrom} />
          <stop offset="100%" stopColor={preset.bgTo} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="32" fill={`url(#${gradId})`} />
      {/* Subtle rim */}
      <circle cx="32" cy="32" r="29" fill="none" stroke={preset.accent} strokeOpacity="0.28" strokeWidth="1.5" />
      {/* Shoulders */}
      <path d="M14 58 C14 46, 50 46, 50 58 Z" fill={preset.accent} fillOpacity="0.88" />
      {/* Head */}
      <circle cx="32" cy="29" r="12" fill={preset.skin} />
      {/* Hair / crown silhouette */}
      <path
        d="M20 28 C20 18, 44 18, 44 28 C41 23, 23 23, 20 28 Z"
        fill={preset.hair}
      />
      {/* Eyes */}
      <circle cx="27.5" cy="30" r="1.4" fill="#0f172a" />
      <circle cx="36.5" cy="30" r="1.4" fill="#0f172a" />
      {/* Smile */}
      <path d="M28.5 34.5 Q32 37 35.5 34.5" fill="none" stroke="#7c2d12" strokeWidth="1.5" strokeLinecap="round" />

      {/* Distinctive motif per preset */}
      {preset.motif === 'glasses' && (
        <g stroke={preset.accent} strokeWidth="1.8" fill="none">
          <rect x="23.5" y="27.5" width="7" height="5" rx="1.5" />
          <rect x="33.5" y="27.5" width="7" height="5" rx="1.5" />
          <line x1="30.5" y1="30" x2="33.5" y2="30" />
        </g>
      )}
      {preset.motif === 'headphones' && (
        <g fill={preset.accent}>
          <path d="M18 30 A14 14 0 0 1 46 30" fill="none" stroke={preset.accent} strokeWidth="2.5" />
          <rect x="15.5" y="26" width="4" height="9" rx="2" />
          <rect x="44.5" y="26" width="4" height="9" rx="2" />
        </g>
      )}
      {preset.motif === 'beret' && (
        <path d="M19 22 Q32 13 46 21 Q38 24 20 23 Z" fill={preset.accent} />
      )}
      {preset.motif === 'cap' && (
        <g fill={preset.accent}>
          <path d="M20 23 A12 10 0 0 1 44 23 Z" />
          <rect x="20" y="21.5" width="29" height="3" rx="1.5" />
        </g>
      )}
      {preset.motif === 'visor' && (
        <rect x="22.5" y="27.5" width="19" height="5" rx="2.5" fill={preset.accent} fillOpacity="0.85" />
      )}
      {preset.motif === 'cat' && (
        <g fill={preset.accent}>
          <polygon points="21,22 23,13 28,19" />
          <polygon points="43,22 41,13 36,19" />
        </g>
      )}
      {preset.motif === 'star' && (
        <polygon points="48,13 49.5,16.5 53,17 50.2,19.5 51,23 48,21 45,23 45.8,19.5 43,17 46.5,16.5" fill={preset.accent} />
      )}
      {preset.motif === 'moon' && (
        <path d="M48 13 A5 5 0 1 0 53 21 A4 4 0 1 1 48 13 Z" fill={preset.accent} />
      )}
      {preset.motif === 'popcorn' && (
        <g fill={preset.accent}>
          <circle cx="46" cy="17" r="2.2" />
          <circle cx="49" cy="15.5" r="2.2" />
          <circle cx="51" cy="18" r="2" />
        </g>
      )}
      {preset.motif === 'clapper' && (
        <g fill={preset.accent}>
          <rect x="42" y="13" width="11" height="8" rx="1.5" />
          <line x1="42" y1="16" x2="53" y2="16" stroke={preset.bgTo} strokeWidth="1.3" />
        </g>
      )}
      {preset.motif === 'flame' && (
        <path d="M48 12 C51 15 52 19 48 22 C44 19 45 15 48 12 Z" fill={preset.accent} />
      )}
      {preset.motif === 'ticket' && (
        <rect x="42" y="14" width="11" height="6.5" rx="1.5" fill={preset.accent} />
      )}
    </svg>
  );
}

export function UserAvatar({
  avatar,
  seed,
  username,
  isPro = false,
  size = 'md',
  className = '',
}: {
  avatar?: string | null;
  seed?: string;
  username?: string;
  isPro?: boolean;
  size?: AvatarSize;
  className?: string;
}) {
  const preset = resolveAvatarPreset(avatar, seed || username);
  const crownSpec = CROWN_CLASSES[size];

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${SIZE_CLASSES[size]} ${
        isPro
          ? 'ring-2 ring-amber-400 shadow-[0_0_12px_-2px_rgba(251,191,36,0.55)]'
          : 'ring-1 ring-border'
      } ${className}`}
      aria-label={username ? `Avatar de ${username}${isPro ? ' (Membre Pro)' : ''}` : undefined}
    >
      <AvatarArtwork preset={preset} className="size-full rounded-full" />
      {isPro && (
        <span
          title="Membre Pro"
          className={`absolute grid place-items-center rounded-full border border-amber-200/80 bg-amber-400 text-slate-950 shadow-sm ${crownSpec.wrap}`}
        >
          <Crown className={`${crownSpec.icon} fill-slate-950`} />
        </span>
      )}
    </span>
  );
}
