import type {
  PrivacyIconKey,
  PrivacyItem,
  PrivacyPageConfig,
  PrivacySection,
} from '../shared/types.ts';
import { readModuleSnapshot, writeModuleSnapshot } from './persistentDb.ts';

const MODULE_KEY = 'privacy_page_config';

const VALID_ICONS = new Set<PrivacyIconKey>([
  'lock',
  'key',
  'shield',
  'users',
  'message',
  'eye',
  'devices',
  'database',
  'card',
  'alert',
  'eye-off',
  'shield-check',
  'globe',
  'file-text',
]);

export function createDefaultPrivacyConfig(): PrivacyPageConfig {
  return {
    title: 'Confidentialité & Sécurité',
    subtitle:
      'Comment nous protégeons votre identité, contrôlons la confidentialité de vos données et préservons la sérénité de la communauté.',
    updatedAt: new Date().toISOString(),
    sections: [
      {
        id: 'identity-protection',
        title: 'Protection de votre identité',
        items: [
          {
            id: 'email-encryption',
            icon: 'lock',
            title: 'Chiffrement de votre email',
            description:
              "Votre adresse email est stockée sous forme chiffrée et n'est jamais conservée en clair dans nos bases de données. Elle n'est déchiffrée que lorsque nécessaire (envoi d'emails, récupération de compte). Un identifiant dérivé non réversible est utilisé pour les vérifications de connexion, ce qui réduit considérablement les risques en cas de problème.",
            technicalDetails:
              "Chiffrement des adresses pour les opérations de messagerie et empreinte cryptographique dérivée non réversible utilisée lors des contrôles d'authentification et d'unicité.",
          },
          {
            id: 'password-protection',
            icon: 'key',
            title: 'Protection de vos mots de passe',
            description:
              'Vos mots de passe sont protégés avec un algorithme moderne très résistant. Même nous, on ne peut pas les récupérer. Si vous oubliez votre mot de passe, vous devrez en créer un nouveau.',
            technicalDetails:
              'Hachage unidirectionnel avec sel cryptographique unique par utilisateur (scrypt / Argon2), rendant toute lecture en clair impossible même en cas d’accès à la base.',
          },
          {
            id: 'owasp-standards',
            icon: 'shield',
            title: 'Standards de sécurité OWASP',
            description:
              'On suit les standards de sécurité reconnus de l’industrie. Notre système est protégé contre les attaques les plus courantes et on améliore continuellement notre sécurité.',
            technicalDetails:
              'Validation stricte des entrées, requêtes SQL paramétrées, protection contre les failles XSS/CSRF, limitation de débit sur l’authentification et jetons de session signés.',
          },
        ],
      },
      {
        id: 'privacy-control',
        title: 'Contrôle de votre vie privée',
        items: [
          {
            id: 'multiple-profiles',
            icon: 'users',
            title: 'Profils multiples',
            description:
              'Créez plusieurs profils sur un même compte (perso, famille, enfants...). Chaque profil a son propre historique et ses préférences. Gardez vos activités séparées et privées.',
          },
          {
            id: 'anonymous-comments',
            icon: 'message',
            title: 'Mode anonyme pour les commentaires',
            description:
              'Postez vos avis sans révéler votre nom de profil. Idéal pour partager votre opinion en toute discrétion. Contrôle total sur ce que vous partagez publiquement.',
          },
          {
            id: 'private-history',
            icon: 'eye',
            title: 'Historique privé',
            description:
              'Votre liste de visionnage et votre progression sont privées par défaut, liées à votre profil. Possibilité d’effacer tout votre historique à tout moment.',
          },
        ],
      },
      {
        id: 'data-ownership',
        title: 'Vos données vous appartiennent',
        items: [
          {
            id: 'connected-devices',
            icon: 'devices',
            title: 'Gérez vos appareils connectés',
            description:
              'Voyez tous les appareils connectés à votre compte et déconnectez-vous à distance d’un simple clic. Vous avez oublié de vous déconnecter quelque part ? Pas de souci, vous gardez le contrôle total depuis vos paramètres.',
          },
          {
            id: 'data-transparency',
            icon: 'database',
            title: 'Transparence sur vos données',
            description:
              'On ne vend jamais vos données personnelles. On utilise une régie publicitaire qui peut collecter certaines informations pour personnaliser les annonces, mais vos données personnelles (email, historique) restent privées et ne sont jamais vendues.',
            technicalDetails:
              'Aucune donnée nominative (email, historique de visionnage, favoris ou préférences) n’est cédée ni commercialisée à des courtiers en données.',
          },
          {
            id: 'secure-payments',
            icon: 'card',
            title: 'Paiements sécurisés',
            description:
              'Les paiements par carte bancaire passent par des partenaires certifiés, et nous ne stockons jamais vos informations bancaires. Vous pouvez aussi payer en cryptomonnaie : aucune donnée personnelle n’est requise, le paiement se fait directement depuis votre wallet et la validation se fait automatiquement sur la blockchain.',
            technicalDetails:
              'Traitement bancaire délégué à des prestataires certifiés PCI-DSS et vérification automatisée sur la blockchain pour les paiements en cryptomonnaies.',
          },
        ],
      },
      {
        id: 'community-protection',
        title: 'Protection de la communauté',
        items: [
          {
            id: 'anti-abuse',
            icon: 'alert',
            title: 'Protection anti-abus',
            description:
              'On a mis en place des limites intelligentes pour empêcher le spam et les comportements abusifs, sans jamais gêner votre utilisation normale. L’objectif : garder une communauté saine et agréable pour tout le monde.',
          },
          {
            id: 'no-spoilers',
            icon: 'eye-off',
            title: 'Pas de spoilers non désirés',
            description:
              'Marquez vos commentaires s’ils contiennent des spoilers, et on affichera automatiquement un avertissement aux autres. Comme ça, tout le monde peut profiter de ses films et séries sans se faire gâcher l’histoire.',
          },
          {
            id: 'content-sanitization',
            icon: 'shield-check',
            title: 'Nettoyage des contenus publiés',
            description:
              'Tout ce que vous publiez (commentaires, avis) passe par un système de nettoyage automatique pour protéger la communauté contre les contenus malveillants.',
            technicalDetails:
              'Assainissement automatique du texte et neutralisation des balises ou scripts potentiellement dangereux avant tout stockage et affichage.',
          },
        ],
      },
    ],
  };
}

function sanitizeId(raw: unknown, fallback: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

function sanitizeIcon(raw: unknown): PrivacyIconKey {
  const candidate = String(raw ?? '').trim() as PrivacyIconKey;
  return VALID_ICONS.has(candidate) ? candidate : 'shield';
}

function sanitizePrivacyItem(raw: unknown, idx: number): PrivacyItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = String(obj.title ?? '').trim().slice(0, 120);
  const description = String(obj.description ?? '').trim().slice(0, 2000);
  if (!title && !description) return null;
  const technicalDetails = String(obj.technicalDetails ?? '').trim().slice(0, 2000);
  return {
    id: sanitizeId(obj.id, `item-${idx + 1}`),
    icon: sanitizeIcon(obj.icon),
    title: title || 'Point de sécurité',
    description,
    ...(technicalDetails ? { technicalDetails } : {}),
  };
}

function sanitizePrivacySection(raw: unknown, idx: number): PrivacySection | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = String(obj.title ?? '').trim().slice(0, 140);
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items = rawItems
    .map((item, itemIdx) => sanitizePrivacyItem(item, itemIdx))
    .filter((item): item is PrivacyItem => item !== null)
    .slice(0, 24);
  if (!title && items.length === 0) return null;
  return {
    id: sanitizeId(obj.id, `section-${idx + 1}`),
    title: title || `Section ${idx + 1}`,
    items,
  };
}

export function sanitizePrivacyConfig(raw: unknown): PrivacyPageConfig {
  const defaults = createDefaultPrivacyConfig();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, unknown>;
  const title = String(obj.title ?? defaults.title).trim().slice(0, 140) || defaults.title;
  const subtitle = String(obj.subtitle ?? '').trim().slice(0, 500);
  const rawSections = Array.isArray(obj.sections) ? obj.sections : defaults.sections;
  const sections = rawSections
    .map((sec, idx) => sanitizePrivacySection(sec, idx))
    .filter((sec): sec is PrivacySection => sec !== null)
    .slice(0, 20);
  return {
    title,
    subtitle,
    updatedAt: typeof obj.updatedAt === 'string' && obj.updatedAt ? obj.updatedAt : new Date().toISOString(),
    sections: sections.length > 0 ? sections : defaults.sections,
  };
}

export function getPrivacyPageConfig(): PrivacyPageConfig {
  const stored = readModuleSnapshot<PrivacyPageConfig>(MODULE_KEY);
  if (!stored) {
    const defaults = createDefaultPrivacyConfig();
    writeModuleSnapshot(MODULE_KEY, defaults);
    return defaults;
  }
  return sanitizePrivacyConfig(stored);
}

export function updatePrivacyPageConfig(input: unknown): PrivacyPageConfig {
  const next = sanitizePrivacyConfig({
    ...(input && typeof input === 'object' ? (input as Record<string, unknown>) : {}),
    updatedAt: new Date().toISOString(),
  });
  writeModuleSnapshot(MODULE_KEY, next);
  return next;
}

export function resetPrivacyPageConfig(): PrivacyPageConfig {
  const defaults = createDefaultPrivacyConfig();
  writeModuleSnapshot(MODULE_KEY, defaults);
  return defaults;
}
