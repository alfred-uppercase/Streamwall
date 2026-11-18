export interface GeoCountryMeta {
  code: string;
  numericId: string;
  name: string;
  continent: string;
}

export const COUNTRIES_BY_CODE: Record<string, GeoCountryMeta> = {
  MG: { code: 'MG', numericId: '450', name: 'Madagascar', continent: 'Afrique' },
  FR: { code: 'FR', numericId: '250', name: 'France', continent: 'Europe' },
  RE: { code: 'RE', numericId: '638', name: 'La Réunion', continent: 'Afrique' },
  MU: { code: 'MU', numericId: '480', name: 'Maurice', continent: 'Afrique' },
  CA: { code: 'CA', numericId: '124', name: 'Canada', continent: 'Amériques' },
  BE: { code: 'BE', numericId: '056', name: 'Belgique', continent: 'Europe' },
  CH: { code: 'CH', numericId: '756', name: 'Suisse', continent: 'Europe' },
  US: { code: 'US', numericId: '840', name: 'États-Unis', continent: 'Amériques' },
  GB: { code: 'GB', numericId: '826', name: 'Royaume-Uni', continent: 'Europe' },
  DE: { code: 'DE', numericId: '276', name: 'Allemagne', continent: 'Europe' },
  SN: { code: 'SN', numericId: '686', name: 'Sénégal', continent: 'Afrique' },
  CI: { code: 'CI', numericId: '384', name: "Côte d'Ivoire", continent: 'Afrique' },
  MA: { code: 'MA', numericId: '504', name: 'Maroc', continent: 'Afrique' },
  TN: { code: 'TN', numericId: '788', name: 'Tunisie', continent: 'Afrique' },
  DZ: { code: 'DZ', numericId: '012', name: 'Algérie', continent: 'Afrique' },
  CM: { code: 'CM', numericId: '120', name: 'Cameroun', continent: 'Afrique' },
  ES: { code: 'ES', numericId: '724', name: 'Espagne', continent: 'Europe' },
  IT: { code: 'IT', numericId: '380', name: 'Italie', continent: 'Europe' },
  JP: { code: 'JP', numericId: '392', name: 'Japon', continent: 'Asie' },
  BR: { code: 'BR', numericId: '076', name: 'Brésil', continent: 'Amériques' },
  AU: { code: 'AU', numericId: '036', name: 'Australie', continent: 'Océanie' },
  NL: { code: 'NL', numericId: '528', name: 'Pays-Bas', continent: 'Europe' },
  PT: { code: 'PT', numericId: '620', name: 'Portugal', continent: 'Europe' },
  ZA: { code: 'ZA', numericId: '710', name: 'Afrique du Sud', continent: 'Afrique' },
  IN: { code: 'IN', numericId: '356', name: 'Inde', continent: 'Asie' },
  KR: { code: 'KR', numericId: '410', name: 'Corée du Sud', continent: 'Asie' },
  MX: { code: 'MX', numericId: '484', name: 'Mexique', continent: 'Amériques' },
  AR: { code: 'AR', numericId: '032', name: 'Argentine', continent: 'Amériques' },
  LU: { code: 'LU', numericId: '442', name: 'Luxembourg', continent: 'Europe' },
  CN: { code: 'CN', numericId: '156', name: 'Chine', continent: 'Asie' },
};

export const COUNTRIES_BY_NUMERIC_ID: Record<string, GeoCountryMeta> = Object.fromEntries(
  Object.values(COUNTRIES_BY_CODE).map((c) => [c.numericId, c])
);

export const TIMEZONE_TO_GEO: Record<
  string,
  { countryCode: string; region: string; city: string }
> = {
  'Indian/Antananarivo': { countryCode: 'MG', region: 'Analamanga', city: 'Antananarivo' },
  'Europe/Paris': { countryCode: 'FR', region: 'Île-de-France', city: 'Paris' },
  'Indian/Reunion': { countryCode: 'RE', region: 'La Réunion', city: 'Saint-Denis' },
  'Indian/Mauritius': { countryCode: 'MU', region: 'Port-Louis', city: 'Port-Louis' },
  'America/Toronto': { countryCode: 'CA', region: 'Ontario', city: 'Toronto' },
  'America/Montreal': { countryCode: 'CA', region: 'Québec', city: 'Montréal' },
  'Europe/Brussels': { countryCode: 'BE', region: 'Bruxelles-Capitale', city: 'Bruxelles' },
  'Europe/Zurich': { countryCode: 'CH', region: 'Vaud', city: 'Lausanne' },
  'Europe/London': { countryCode: 'GB', region: 'Angleterre', city: 'Londres' },
  'Europe/Berlin': { countryCode: 'DE', region: 'Berlin', city: 'Berlin' },
  'America/New_York': { countryCode: 'US', region: 'New York', city: 'New York' },
  'America/Los_Angeles': { countryCode: 'US', region: 'Californie', city: 'Los Angeles' },
  'Africa/Dakar': { countryCode: 'SN', region: 'Dakar', city: 'Dakar' },
  'Africa/Abidjan': { countryCode: 'CI', region: 'Abidjan', city: 'Abidjan' },
  'Africa/Casablanca': { countryCode: 'MA', region: 'Casablanca-Settat', city: 'Casablanca' },
  'Africa/Tunis': { countryCode: 'TN', region: 'Tunis', city: 'Tunis' },
  'Africa/Algiers': { countryCode: 'DZ', region: 'Alger', city: 'Alger' },
  'Africa/Douala': { countryCode: 'CM', region: 'Littoral', city: 'Douala' },
  'Asia/Tokyo': { countryCode: 'JP', region: 'Tokyo', city: 'Tokyo' },
  'Australia/Sydney': { countryCode: 'AU', region: 'Nouvelle-Galles du Sud', city: 'Sydney' },
};

export const CONTINENT_VIEWPORTS: Record<
  string,
  { label: string; center: [number, number]; scale: number }
> = {
  world: { label: 'Monde', center: [12, 18], scale: 155 },
  africa: { label: 'Afrique', center: [20, 2], scale: 360 },
  europe: { label: 'Europe', center: [12, 50], scale: 520 },
  americas: { label: 'Amériques', center: [-78, 14], scale: 235 },
  asia: { label: 'Asie', center: [95, 32], scale: 320 },
  oceania: { label: 'Océanie', center: [138, -24], scale: 420 },
};
