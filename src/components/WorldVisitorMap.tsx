import React, { useMemo, useState } from 'react';
import { geoCentroid, geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import worldAtlas from 'world-atlas/countries-110m.json';
import { Globe2, MapPin, Minus, Plus, RotateCcw } from 'lucide-react';
import type { CityStat, CountryStat, RegionStat } from '../shared/analyticsTypes';
import { CONTINENT_VIEWPORTS, COUNTRIES_BY_NUMERIC_ID } from '../shared/geoCountries';

interface WorldVisitorMapProps {
  countries: CountryStat[];
  regions: RegionStat[];
  cities: CityStat[];
}

interface GeoFeature {
  type: 'Feature';
  id?: string | number;
  properties: { name?: string };
  geometry: GeoJSON.Geometry;
}

const MAP_WIDTH = 860;
const MAP_HEIGHT = 430;

function padNumericId(id: string | number | undefined): string {
  if (id === undefined || id === null) return '';
  return String(id).padStart(3, '0');
}

function getCountryFill(sessions: number, maxSessions: number, isSelected: boolean): string {
  if (isSelected) return '#facc15';
  if (sessions <= 0 || maxSessions <= 0) return '#232735';
  const ratio = Math.pow(sessions / maxSessions, 0.55);
  if (ratio > 0.78) return '#f5b83d';
  if (ratio > 0.52) return '#d99526';
  if (ratio > 0.28) return '#a86f1c';
  if (ratio > 0.1) return '#734b18';
  return '#4b3419';
}

export function WorldVisitorMap({ countries, regions, cities }: WorldVisitorMapProps) {
  const [presetKey, setPresetKey] = useState<string>('world');
  const [center, setCenter] = useState<[number, number]>(CONTINENT_VIEWPORTS.world.center);
  const [scale, setScale] = useState<number>(CONTINENT_VIEWPORTS.world.scale);
  const [selectedCode, setSelectedCode] = useState<string | null>(
    countries[0]?.countryCode ?? null
  );
  const [hoveredInfo, setHoveredInfo] = useState<{
    name: string;
    visitors: number;
    sessions: number;
    pageViews: number;
    sharePct: number;
    x: number;
    y: number;
  } | null>(null);

  const geoFeatures = useMemo(() => {
    const topology = worldAtlas as unknown as Topology;
    const objKey = Object.keys(topology.objects)[0];
    const fc = feature(topology, topology.objects[objKey]) as unknown as {
      features: GeoFeature[];
    };
    return fc.features.filter((f) => padNumericId(f.id) !== '010'); // Exclude Antarctica
  }, []);

  const statsByNumericId = useMemo(() => {
    const map = new Map<string, CountryStat>();
    for (const c of countries) {
      if (c.numericId) map.set(padNumericId(c.numericId), c);
    }
    return map;
  }, [countries]);

  const statsByCode = useMemo(() => {
    const map = new Map<string, CountryStat>();
    for (const c of countries) {
      map.set(c.countryCode, c);
    }
    return map;
  }, [countries]);

  const maxSessions = useMemo(
    () => countries.reduce((m, c) => Math.max(m, c.sessions), 0),
    [countries]
  );

  const { graticulePath, paths } = useMemo(() => {
    const projection = geoNaturalEarth1()
      .center(center)
      .scale(scale)
      .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
    const pathGen = geoPath(projection);

    const grat = pathGen(geoGraticule10()) || '';
    const computed = geoFeatures.map((feat) => {
      const numId = padNumericId(feat.id);
      const meta = COUNTRIES_BY_NUMERIC_ID[numId];
      const stat = statsByNumericId.get(numId);
      const centroid = geoCentroid(feat as unknown as GeoJSON.Feature);
      return {
        numId,
        code: stat?.countryCode ?? meta?.code ?? numId,
        name: stat?.countryName ?? meta?.name ?? feat.properties?.name ?? 'Territoire',
        d: pathGen(feat as unknown as GeoJSON.Feature) || '',
        stat: stat ?? null,
        centroid:
          Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])
            ? ([centroid[0], centroid[1]] as [number, number])
            : null,
      };
    });

    return { graticulePath: grat, paths: computed };
  }, [center, scale, geoFeatures, statsByNumericId]);

  const selectPreset = (key: string) => {
    const vp = CONTINENT_VIEWPORTS[key] ?? CONTINENT_VIEWPORTS.world;
    setPresetKey(key);
    setCenter(vp.center);
    setScale(vp.scale);
  };

  const handleSelectCountry = (
    code: string,
    centroid: [number, number] | null,
    zoomOnCountry: boolean
  ) => {
    setSelectedCode(code);
    if (zoomOnCountry && centroid) {
      setPresetKey('custom');
      setCenter(centroid);
      setScale((prev) => Math.max(prev, 420));
    }
  };

  const effectiveSelectedCode =
    selectedCode && statsByCode.has(selectedCode)
      ? selectedCode
      : countries[0]?.countryCode ?? null;
  const activeCountry = effectiveSelectedCode ? statsByCode.get(effectiveSelectedCode) ?? null : null;

  const activeRegions = useMemo(() => {
    if (!activeCountry) return [];
    return regions.filter((r) => r.countryCode === activeCountry.countryCode);
  }, [regions, activeCountry]);

  const activeCities = useMemo(() => {
    if (!activeCountry) return [];
    return cities.filter((c) => c.countryCode === activeCountry.countryCode);
  }, [cities, activeCountry]);

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      {/* Interactive Vector World Map */}
      <div className="xl:col-span-8 rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-foreground">
              Carte interactive des visiteurs
            </h3>
            <p className="text-xs text-muted-foreground">
              Survolez un pays pour l’aperçu ou cliquez pour zoomer et explorer ses régions et villes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(CONTINENT_VIEWPORTS).map(([key, vp]) => (
              <button
                key={key}
                type="button"
                onClick={() => selectPreset(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  presetKey === key
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {vp.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-border bg-[#11131b]">
          {/* Zoom Toolbar */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 backdrop-blur-sm">
            <button
              type="button"
              aria-label="Zoomer"
              onClick={() => {
                setPresetKey('custom');
                setScale((s) => Math.min(1100, Math.round(s * 1.35)));
              }}
              className="grid size-7 place-items-center rounded text-foreground hover:bg-accent"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Dézoomer"
              onClick={() => {
                setPresetKey('custom');
                setScale((s) => Math.max(135, Math.round(s / 1.35)));
              }}
              className="grid size-7 place-items-center rounded text-foreground hover:bg-accent"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Réinitialiser la vue"
              onClick={() => selectPreset('world')}
              className="grid size-7 place-items-center rounded text-foreground hover:bg-accent"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>

          <svg
            viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
            className="h-auto w-full select-none"
            role="img"
            aria-label="Carte mondiale de provenance des visiteurs"
            onMouseLeave={() => setHoveredInfo(null)}
          >
            <path d={graticulePath} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={0.6} />
            <g>
              {paths.map((item) => {
                if (!item.d) return null;
                const isSelected = Boolean(
                  effectiveSelectedCode && item.code === effectiveSelectedCode
                );
                const sessions = item.stat?.sessions ?? 0;
                const fill = getCountryFill(sessions, maxSessions, isSelected);
                return (
                  <path
                    key={`${item.numId}-${item.name}`}
                    d={item.d}
                    fill={fill}
                    stroke={isSelected ? '#fef08a' : '#141722'}
                    strokeWidth={isSelected ? 1.1 : 0.55}
                    className="cursor-pointer transition-colors duration-150 hover:brightness-125"
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
                      if (!rect) return;
                      setHoveredInfo({
                        name: item.name,
                        visitors: item.stat?.visitors ?? 0,
                        sessions: item.stat?.sessions ?? 0,
                        pageViews: item.stat?.pageViews ?? 0,
                        sharePct: item.stat?.sharePct ?? 0,
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      });
                    }}
                    onClick={() =>
                      handleSelectCountry(item.code, item.centroid, Boolean(item.stat))
                    }
                  />
                );
              })}
            </g>
          </svg>

          {hoveredInfo && (
            <div
              className="pointer-events-none absolute z-20 min-w-44 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
              style={{
                left: Math.min(Math.max(12, hoveredInfo.x + 14), 560),
                top: Math.max(12, hoveredInfo.y - 12),
              }}
            >
              <p className="font-semibold text-foreground">{hoveredInfo.name}</p>
              {hoveredInfo.sessions > 0 ? (
                <div className="mt-1 space-y-0.5 text-muted-foreground tabular-nums">
                  <p>
                    Visiteurs : <span className="text-foreground">{hoveredInfo.visitors}</span>
                  </p>
                  <p>
                    Sessions : <span className="text-foreground">{hoveredInfo.sessions}</span> (
                    {hoveredInfo.sharePct}%)
                  </p>
                  <p>
                    Pages vues : <span className="text-foreground">{hoveredInfo.pageViews}</span>
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">Aucune visite sur cette période</p>
              )}
            </div>
          )}
        </div>

        {/* Intensity Scale Legend */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Faible</span>
            <div className="flex items-center gap-1">
              {['#232735', '#4b3419', '#734b18', '#a86f1c', '#d99526', '#f5b83d'].map((c) => (
                <span
                  key={c}
                  className="inline-block h-2.5 w-5 rounded-sm"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <span>Élevé</span>
          </div>
          <span className="tabular-nums">
            {countries.length} pays actif(s) sur la période
          </span>
        </div>
      </div>

      {/* Selected Country Details & Top Countries Ranking */}
      <div className="xl:col-span-4 space-y-5">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-primary" />
              <h3 className="font-display text-base font-semibold text-foreground">
                {activeCountry ? activeCountry.countryName : 'Détail du pays'}
              </h3>
            </div>
            {activeCountry && (
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {activeCountry.continent} · {activeCountry.sharePct}%
              </span>
            )}
          </div>

          {activeCountry ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 border-y border-border py-3 text-center">
                <div>
                  <p className="text-[11px] text-muted-foreground">Visiteurs</p>
                  <p className="mt-0.5 font-display text-xl font-bold text-foreground tabular-nums">
                    {activeCountry.visitors}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Sessions</p>
                  <p className="mt-0.5 font-display text-xl font-bold text-foreground tabular-nums">
                    {activeCountry.sessions}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Pages vues</p>
                  <p className="mt-0.5 font-display text-xl font-bold text-foreground tabular-nums">
                    {activeCountry.pageViews}
                  </p>
                </div>
              </div>

              {activeRegions.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    Régions ({activeRegions.length})
                  </p>
                  <ul className="space-y-1 text-xs">
                    {activeRegions.slice(0, 4).map((r) => (
                      <li
                        key={`${r.countryCode}-${r.region}`}
                        className="flex items-center justify-between gap-2 text-foreground"
                      >
                        <span className="truncate">{r.region}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {r.visitors} vis. · {r.sessions} ses.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {activeCities.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    Villes principales
                  </p>
                  <ul className="space-y-1 text-xs">
                    {activeCities.slice(0, 4).map((c) => (
                      <li
                        key={`${c.countryCode}-${c.region}-${c.city}`}
                        className="flex items-center justify-between gap-2 text-foreground"
                      >
                        <span className="truncate">{c.city}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {c.sessions} ses. ({c.sharePct}%)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Cliquez sur un pays actif sur la carte pour consulter ses métriques.
            </p>
          )}
        </div>

        {/* Top Countries Ranking */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 className="size-4 text-primary" />
            <h3 className="font-display text-base font-semibold text-foreground">
              Classement des pays
            </h3>
          </div>
          {countries.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune donnée géographique.</p>
          ) : (
            <ul className="space-y-2.5">
              {countries.slice(0, 7).map((c, idx) => {
                const isSelected = activeCountry?.countryCode === c.countryCode;
                return (
                  <li key={c.countryCode}>
                    <button
                      type="button"
                      onClick={() => {
                        const match = paths.find((p) => p.code === c.countryCode);
                        handleSelectCountry(c.countryCode, match?.centroid ?? null, true);
                      }}
                      className={`w-full rounded-lg p-2 text-left transition-colors ${
                        isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-foreground truncate">
                          #{idx + 1} · {c.countryName}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {c.sessions} ses. ({c.sharePct}%)
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${maxSessions > 0 ? Math.max(6, (c.sessions / maxSessions) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
