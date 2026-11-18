import type { CastMember, DetailItem, Episode, Item, Slide } from '../shared/types.ts';

export const FALLBACK_GENRES: string[] = [
  'Action',
  'Animation',
  'Aventure',
  'Comédie',
  'Crime',
  'Documentaire',
  'Drame',
  'Familial',
  'Fantastique',
  'Histoire',
  'Horreur',
  'Mystère',
  'Romance',
  'Science-Fiction',
  'Thriller',
];

export const FALLBACK_SLIDER: Slide[] = [
  {
    id: '24044',
    titre: 'Stop! That! Train!',
    descr:
      "Les deux meilleures amies et hôtesses du train, Tess et DeeDee, échangent leurs quarts de travail sur le Stank Rail contre le fastueux Glamazonian Express lorsqu'une tempête catastrophique menace le train à grande vitesse.",
    qualite: 'HD',
    langue: 'TRUEFRENCH',
    item_type: 'film',
    saison: null,
    genre: 'Action, Comédie',
    annee: 2026,
    tmdbId: '1541560',
    poster: 'https://image.tmdb.org/t/p/w500/1wYlc19TKNI6YZWuxu9Cmkc5pbn.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w1066_and_h600_bestv2/v92U09IUqaNbZnnThWKtGPmB3Mb.jpg',
    trailer: 'yx2YuoAnwlQ',
  },
  {
    id: '24405',
    titre: 'The Disinvited',
    descr:
      "Contre toute attente, Carl décide de s'incruster à une réception où il n'est plus le bienvenu, déclenchant une nuit de trahisons, de révélations et de tensions au cœur du désert.",
    qualite: 'HD',
    langue: 'VOSTFR',
    item_type: 'film',
    saison: null,
    genre: 'Comédie, Thriller, Horreur',
    annee: 2025,
    tmdbId: '1055783',
    poster: 'https://image.tmdb.org/t/p/w500/smxKZ9nV0h4HyfYfEUryjjoYKJV.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w1066_and_h600_bestv2/8nWUbVOowG5Pwik0WYSKMvgKDvY.jpg',
    trailer: 'e9I4gvLs3nQ',
  },
  {
    id: '24393',
    titre: 'My Weird School',
    descr:
      "Le collégien AJ doit s'allier avec ses professeurs excentriques et ses camarades pour sauver leur établissement d'une invasion inattendue.",
    qualite: 'HD',
    langue: 'VF+VOSTFR',
    item_type: 'film',
    saison: null,
    genre: 'Comédie, Familial, Science-Fiction',
    annee: 2025,
    tmdbId: '1559984',
    poster: 'https://image.tmdb.org/t/p/w500/y0rRAxg4WBC91IKRAaGckQysrG0.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w1066_and_h600_bestv2/xXKMcz8m9E3x7fMhKpu9nZYZ1py.jpg',
    trailer: null,
  },
  {
    id: '9650',
    titre: 'GIFT',
    descr:
      "Un astrophysicien de génie, qui s'isole constamment des autres, rencontre une équipe de rugby en fauteuil roulant, les « Blaze Bulls », et se jure d'en faire une équipe championne.",
    qualite: 'HD',
    langue: 'VOSTFR',
    item_type: 'serie',
    saison: 1,
    genre: 'Drame',
    annee: 2026,
    tmdbId: '314647',
    poster: 'https://image.tmdb.org/t/p/w500/5bjdruO6jpKc4xz1PQjZudwxvYA.jpg',
    backdrop: null,
    trailer: null,
  },
];

export const FALLBACK_ITEMS: Item[] = [
  ...FALLBACK_SLIDER.map((s) => ({
    id: s.id,
    titre: s.titre,
    poster: s.poster,
    qualite: s.qualite,
    langue: s.langue,
    item_type: s.item_type,
    saison: s.saison,
    genre: s.genre,
    annee: s.annee,
    tmdbId: s.tmdbId,
  })),
  {
    id: '24042',
    titre: 'La Petite Graine',
    poster: 'https://image.tmdb.org/t/p/w500/bw7vF3GU9LcmvPMfiwdxYlNiGWU.jpg',
    qualite: 'HD',
    langue: 'FRENCH',
    item_type: 'film',
    saison: null,
    genre: 'Drame, Comédie',
    annee: 2025,
    tmdbId: '1290411',
  },
  {
    id: '24062',
    titre: "He's Watching You",
    poster: 'https://image.tmdb.org/t/p/w500/lGrxMTGzoO120uuHuYxwbv5Ypcw.jpg',
    qualite: 'HD',
    langue: 'FRENCH',
    item_type: 'film',
    saison: null,
    genre: 'Thriller, Horreur',
    annee: 2025,
    tmdbId: '1302190',
  },
  {
    id: '24048',
    titre: 'Stormen',
    poster: 'https://image.tmdb.org/t/p/w500/kjAsuaDcNsemYTQ8tUorpVE1FJb.jpg',
    qualite: 'HD',
    langue: 'VF+VOSTFR',
    item_type: 'film',
    saison: null,
    genre: 'Drame, Thriller',
    annee: 2025,
    tmdbId: '1248712',
  },
  {
    id: '9649',
    titre: 'Between Steps',
    poster: 'https://image.tmdb.org/t/p/w500/pGqcErS76y8bcvZZSFUefdZOg2x.jpg',
    qualite: 'HD',
    langue: 'VOSTFR',
    item_type: 'serie',
    saison: 1,
    genre: 'Drame, Comédie',
    annee: 2026,
    tmdbId: '314640',
  },
  {
    id: '5504',
    titre: 'Sugar',
    poster: 'https://image.tmdb.org/t/p/w500/dNrk52Rt13MxwahLneTZJezM6qD.jpg',
    qualite: 'HD',
    langue: 'VF+VOSTFR',
    item_type: 'serie',
    saison: 1,
    genre: 'Drame, Mystère, Crime',
    annee: 2024,
    tmdbId: '203744',
  },
  {
    id: '6861',
    titre: 'King & Conqueror',
    poster: 'https://image.tmdb.org/t/p/w500/3sFiQAnpWbimSWXLCUCQOUtCoy7.jpg',
    qualite: 'HD',
    langue: 'VF+VOSTFR',
    item_type: 'serie',
    saison: 1,
    genre: 'Histoire, Action, Drame',
    annee: 2025,
    tmdbId: '240558',
  },
  {
    id: '6749',
    titre: 'The Chosen Adventures',
    poster: 'https://image.tmdb.org/t/p/w500/ma3l76nAJYaORESgyEKugbehaiT.jpg',
    qualite: 'HD',
    langue: 'VF+VOSTFR',
    item_type: 'anime',
    saison: 1,
    genre: 'Animation, Aventure, Familial',
    annee: 2025,
    tmdbId: '292323',
  },
  {
    id: '4971',
    titre: 'Ghosts of Beirut',
    poster: 'https://image.tmdb.org/t/p/w500/oRt7CQfsOPMTYgKjR4pgcE6tvIy.jpg',
    qualite: 'HD',
    langue: 'VOSTFR',
    item_type: 'serie',
    saison: 1,
    genre: 'Drame, Thriller, Histoire',
    annee: 2023,
    tmdbId: '224009',
  },
];

export function buildFallbackDetail(type: string, id: string): {
  item: DetailItem | null;
  cast: CastMember[];
  related: Item[];
  episodes: Episode[];
} {
  const match = FALLBACK_ITEMS.find((x) => x.id === id) ?? FALLBACK_ITEMS[0];
  const slideMatch = FALLBACK_SLIDER.find((x) => x.id === match.id);
  const itemType = (['film', 'serie', 'anime'].includes(type) ? type : match.item_type) as DetailItem['type'];
  const item: DetailItem = {
    id: match.id,
    titre: match.titre,
    descr:
      slideMatch?.descr ??
      'Découvrez ce titre en haute définition sur StreamWall avec sélection de piste audio et reprise automatique de lecture.',
    qualite: match.qualite ?? 'HD',
    langue: match.langue ?? 'VF+VOSTFR',
    type: itemType,
    tmdbId: match.tmdbId ?? '1541560',
    poster: match.poster,
    trailer: slideMatch?.trailer ?? 'yx2YuoAnwlQ',
    backdrop: slideMatch?.backdrop ?? null,
    genre: match.genre ?? 'Drame, Action',
    annee: match.annee ?? 2025,
    saison: itemType === 'film' ? null : 1,
  };
  const episodes: Episode[] =
    itemType === 'film'
      ? []
      : [
          { saison: 1, episode: 1, titre: 'Épisode 1 — Ouverture' },
          { saison: 1, episode: 2, titre: 'Épisode 2 — Le tournant' },
          { saison: 1, episode: 3, titre: 'Épisode 3 — Ligne de faille' },
          { saison: 1, episode: 4, titre: 'Épisode 4 — Contre-courant' },
        ];
  const cast: CastMember[] = [
    { nom: 'Distribution principale', photo: null, role: 'Rôle principal' },
    { nom: 'Distribution secondaire', photo: null, role: 'Second rôle' },
  ];
  const related = FALLBACK_ITEMS.filter((x) => x.id !== match.id).slice(0, 6);
  return { item, cast, related, episodes };
}
