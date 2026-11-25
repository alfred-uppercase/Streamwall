import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Calendar, Film, Play, Tv } from 'lucide-react';
import { api } from '../lib/client';
import type { AnalyticsPeriodKey, TopPlayedItem } from '../shared/analyticsTypes';

const PLAY_PERIOD_OPTIONS: { key: AnalyticsPeriodKey; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'yesterday', label: 'Hier' },
  { key: '7d', label: '7 derniers jours' },
  { key: '30d', label: '30 derniers jours' },
  { key: '90d', label: '90 derniers jours' },
  { key: 'year', label: 'Cette année' },
  { key: 'custom', label: 'Personnalisée' },
];

function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR');
}

function PlayPosterThumb({
  src,
  alt,
  kind,
}: {
  src: string | null;
  alt: string;
  kind: 'movie' | 'series';
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="grid size-11 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
        {kind === 'series' ? <Tv className="size-4" /> : <Film className="size-4" />}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-11 shrink-0 rounded-md border border-border bg-background object-cover"
    />
  );
}

function RankedPlayCard({
  title,
  emptyLabel,
  items,
  totalKindPlays,
  kind,
  loading,
}: {
  title: string;
  emptyLabel: string;
  items: TopPlayedItem[];
  totalKindPlays: number;
  kind: 'movie' | 'series';
  loading: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">
          {title}
        </h3>
        <span className="text-xs font-medium text-muted-foreground tabular-nums whitespace-nowrap">
          {formatNumber(totalKindPlays)} {totalKindPlays > 1 ? 'lectures' : 'lecture'}
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="flex items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-3">
                <div className="size-11 animate-pulse rounded-md bg-background" />
                <div className="h-4 w-36 animate-pulse rounded bg-background" />
              </div>
              <div className="h-3.5 w-16 animate-pulse rounded bg-background" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="max-h-[24rem] overflow-y-auto pr-1">
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  to={item.path}
                  className="group flex items-center justify-between gap-3 rounded-lg px-1.5 py-2.5 transition-colors hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <PlayPosterThumb src={item.poster} alt={item.title} kind={kind} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                        {item.title}
                      </p>
                      {(item.itemType === 'anime' ||
                        item.itemType === 'pinoy' ||
                        item.itemType === 'custom') && (
                        <p className="text-[11px] text-muted-foreground">
                          {item.itemType === 'anime'
                            ? 'Anime'
                            : item.itemType === 'pinoy'
                              ? 'Pinoy'
                              : 'Module API'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-foreground tabular-nums whitespace-nowrap">
                    <Play className="size-3 fill-current text-muted-foreground group-hover:text-primary" />
                    <span>
                      {formatNumber(item.plays)} {item.plays > 1 ? 'lectures' : 'lecture'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function PlayReportPanel({
  period: controlledPeriod,
  customStart: controlledStart,
  customEnd: controlledEnd,
  showPeriodFilter = true,
}: {
  period?: AnalyticsPeriodKey;
  customStart?: string;
  customEnd?: string;
  showPeriodFilter?: boolean;
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const sevenDaysAgoIso = useMemo(
    () => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10),
    []
  );

  const [localPeriod, setLocalPeriod] = useState<AnalyticsPeriodKey>('7d');
  const [localStart, setLocalStart] = useState<string>(sevenDaysAgoIso);
  const [localEnd, setLocalEnd] = useState<string>(todayIso);

  const activePeriod = controlledPeriod ?? localPeriod;
  const activeStart = controlledStart ?? localStart;
  const activeEnd = controlledEnd ?? localEnd;

  const playQuery = useQuery({
    queryKey: [
      'admin-play-report',
      activePeriod,
      activePeriod === 'custom' ? activeStart : '',
      activePeriod === 'custom' ? activeEnd : '',
    ],
    queryFn: () =>
      api.adminPlayReport({
        period: activePeriod,
        start: activePeriod === 'custom' ? activeStart : undefined,
        end: activePeriod === 'custom' ? activeEnd : undefined,
      }),
    refetchInterval: 30_000,
  });

  const report = playQuery.data;

  return (
    <div className="space-y-6">
      {showPeriodFilter && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">
                Play Report
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {report
                  ? `Événements du bouton « Regarder » du ${new Date(report.period.startDate).toLocaleDateString('fr-FR')} au ${new Date(report.period.endDate).toLocaleDateString('fr-FR')} · Stockage local SQLite`
                  : 'Suivi local des lancements de lecture (bouton Regarder)…'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {PLAY_PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setLocalPeriod(opt.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    localPeriod === opt.key
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-background text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {localPeriod === 'custom' && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                <Calendar className="size-3.5 text-primary" />
                Plage personnalisée :
              </span>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Du</span>
                <input
                  type="date"
                  value={localStart}
                  max={localEnd}
                  onChange={(e) => setLocalStart(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Au</span>
                <input
                  type="date"
                  value={localEnd}
                  min={localStart}
                  max={todayIso}
                  onChange={(e) => setLocalEnd(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground"
                />
              </label>
            </div>
          )}
        </section>
      )}

      {/* Plays Area Chart Card */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-foreground">
              Plays
            </h3>
            <p className="text-xs text-muted-foreground">
              Clics enregistrés sur le bouton « Regarder » (stockés localement)
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span>
              Films : <strong className="font-semibold text-foreground">{formatNumber(report?.moviePlays ?? 0)}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Séries : <strong className="font-semibold text-foreground">{formatNumber(report?.seriesPlays ?? 0)}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-foreground">
              {formatNumber(report?.totalPlays ?? 0)} total plays
            </span>
          </div>
        </div>

        <div className="h-72 w-full sm:h-80">
          {playQuery.isLoading && !report ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Chargement du graphique des lectures…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={report?.timeline ?? []}
                margin={{ top: 10, right: 14, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="playReportGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="currentColor" strokeOpacity={0.08} />
                <XAxis
                  dataKey="label"
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  tick={{ fill: '#9ca3af', fontSize: 11 }}
                  tickLine={false}
                  width={42}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0]?.payload as {
                      fullLabel?: string;
                      plays?: number;
                      moviePlays?: number;
                      seriesPlays?: number;
                    };
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg tabular-nums">
                        <p className="font-semibold capitalize text-foreground">
                          {pt.fullLabel}
                        </p>
                        <p className="mt-1 font-semibold text-orange-400">
                          {formatNumber(pt.plays ?? 0)} {(pt.plays ?? 0) > 1 ? 'lectures' : 'lecture'}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          Films : {formatNumber(pt.moviePlays ?? 0)} · Séries :{' '}
                          {formatNumber(pt.seriesPlays ?? 0)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="plays"
                  name="Plays"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#playReportGradient)"
                  dot={{ r: 4, fill: '#f97316', strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: '#f97316', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Most Played Series & Most Played Movies */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RankedPlayCard
          title="Séries les plus jouées"
          emptyLabel="Aucune série ou anime lancé sur cette période."
          items={report?.mostPlayedSeries ?? []}
          totalKindPlays={report?.seriesPlays ?? 0}
          kind="series"
          loading={playQuery.isLoading && !report}
        />

        <RankedPlayCard
          title="Films les plus joués"
          emptyLabel="Aucun film lancé sur cette période."
          items={report?.mostPlayedMovies ?? []}
          totalKindPlays={report?.moviePlays ?? 0}
          kind="movie"
          loading={playQuery.isLoading && !report}
        />
      </div>
    </div>
  );
}
