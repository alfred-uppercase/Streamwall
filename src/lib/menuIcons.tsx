import type { LucideIcon } from 'lucide-react';
import {
  Clapperboard,
  Compass,
  Crown,
  Film,
  Flame,
  Folder,
  Globe,
  Heart,
  Home,
  LayoutGrid,
  Lock,
  MessageSquare,
  Play,
  Shield,
  Sparkles,
  Star,
  Tv,
  UserRound,
} from 'lucide-react';
import type { MenuAuthRule, MenuIconKey, MenuLinkConfig } from '../shared/types';

export const MENU_ICON_COMPONENTS: Record<MenuIconKey, LucideIcon> = {
  home: Home,
  'layout-grid': LayoutGrid,
  film: Film,
  tv: Tv,
  clapperboard: Clapperboard,
  sparkles: Sparkles,
  heart: Heart,
  crown: Crown,
  shield: Shield,
  user: UserRound,
  globe: Globe,
  compass: Compass,
  flame: Flame,
  play: Play,
  folder: Folder,
  star: Star,
  'message-square': MessageSquare,
  lock: Lock,
};

export const MENU_ICON_OPTIONS: { key: MenuIconKey; label: string }[] = [
  { key: 'home', label: 'Accueil' },
  { key: 'layout-grid', label: 'Catalogue' },
  { key: 'film', label: 'Film' },
  { key: 'tv', label: 'Série / TV' },
  { key: 'clapperboard', label: 'Cinéma' },
  { key: 'sparkles', label: 'Suggestion' },
  { key: 'heart', label: 'Favoris' },
  { key: 'crown', label: 'Pro / Couronne' },
  { key: 'shield', label: 'Admin / Bouclier' },
  { key: 'user', label: 'Compte' },
  { key: 'globe', label: 'Monde' },
  { key: 'compass', label: 'Explorer' },
  { key: 'flame', label: 'Tendances' },
  { key: 'play', label: 'Lecture' },
  { key: 'folder', label: 'Catégorie' },
  { key: 'star', label: 'Favoris / Note' },
  { key: 'message-square', label: 'Demandes' },
  { key: 'lock', label: 'Confidentialité' },
];

export const MENU_AUTH_RULE_LABELS: Record<MenuAuthRule, string> = {
  all: 'Tout le monde',
  member: 'Membres connectés uniquement',
  guest: 'Visiteurs non connectés uniquement',
  pro: 'Membres Pro & Admin uniquement',
  admin: 'Administrateurs uniquement',
  pro_offers: 'Si offres Pro visibles',
};

export function getMenuIcon(key: MenuIconKey): LucideIcon {
  return MENU_ICON_COMPONENTS[key] ?? Film;
}

export function isMenuLinkVisibleForUser(
  item: MenuLinkConfig,
  opts: {
    isMember: boolean;
    isPro: boolean;
    isAdmin: boolean;
    showProMenu: boolean;
  }
): boolean {
  if (!item.enabled) return false;
  switch (item.authRule) {
    case 'member':
      return opts.isMember;
    case 'guest':
      return !opts.isMember;
    case 'pro':
      return opts.isPro || opts.isAdmin;
    case 'admin':
      return opts.isAdmin;
    case 'pro_offers':
      return opts.showProMenu;
    case 'all':
    default:
      return true;
  }
}
