import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Calendar,
  Clock,
  FileText,
  Film,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/client';
import type { AnalyticsPeriodKey, DeviceKind } from '../shared/analyticsTypes';
import { WorldVisitorMap } from './WorldVisitorMap';

const PERIOD_OPTIONS: { key: AnalyticsPeriodKey; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'yesterday', label: 'Hier' },
  { key: '7d', label: '7 derniers jours' },
  { key: '30d', label: '30 derniers jours' },
  { key: '90d', label: '90 derniers jours' },
  { key: 'year', label: 'Cette année' },
  { key: 'custom', label: 'Période personnalisée' },
];

const CHART_PALETTE = ['#f5b83d', '#38bdf8', '#34d399', '#a78bfa', '#fb7185', '#f97316'];

function formatDuration(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR');
}

function deviceLabel(kind: DeviceKind): string {
  if (kind === 'mobile') return 'Mobile';
  if (kind === 'tablet') return 'Tablette';
  return 'Ordinateur';
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  if (kind === 'mobile') return <Smartphone className="size-3.5 text-primary" />;
  if (kind === 'tablet') return <Tablet className="size-3.5 text-primary" />;
  return <Monitor className="size-3.5 text-primary" />;
}

export function AdminAnalyticsTab() {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const thirtyDaysAgoIso = useMemo(
    () => new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
    []
  );

  const [periodKey, setPeriodKey] = useState<AnalyticsPeriodKey>('30d');
  const [customStart, setCustomStart] = useState<string>(thirtyDaysAgoIso);
  const [customEnd, setCustomEnd] = useState<string>(todayIso);
  const [geoTableTab, setGeoTableTab] = useState<'countries' | 'regions' | 'cities'>('countries');

  const analyticsQuery = useQuery({
    queryKey: [
      'admin-analytics',
      periodKey,
      periodKey === 'custom' ? customStart : '',
      periodKey === 'custom' ? customEnd : '',
    ],
    queryFn: () =>
      api.adminAnalytics({
        period: periodKey,
        start: periodKey === 'custom' ? customStart : undefined,
        end: periodKey === 'custom' ? customEnd : undefined,
      }),
  });

  const data = analyticsQuery.data;

  const summary = data?.summary;
  const newPct =
    summary && summary.uniqueVisitors > 0
      ? Math.round((summary.newVisitors / summary.uniqueVisitors) * 100)
      : 0;
  const retPct = summary && summary.uniqueVisitors > 0 ? Math.max(0, 100 - newPct) : 0;

  return (
    <div className="space-y-8">
      {/* Period Filter Bar */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Statistiques & Web Analytics
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {data
                ? `Période analysée : du ${new Date(data.period.startDate).toLocaleDateString('fr-FR')} au ${new Date(data.period.endDate).toLocaleDateString('fr-FR')} · Suivi sans IP complète ni PII`
                : 'Chargement des indicateurs…'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriodKey(opt.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  periodKey === opt.key
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {periodKey === 'custom' && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
              <Calendar className="size-3.5 text-primary" />
              Plage personnalisée :
            </span>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Du</span>
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Au</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={todayIso}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground"
              />
            </label>
          </div>
        )}
      </section>

      {analyticsQuery.isLoading && !data ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          Calcul des statistiques d’audience en cours…
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Impossible de charger les statistiques pour le moment.
        </div>
      ) : (
        <>
          {/* 8 Core KPI Cards */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">Nombre total de visiteurs</p>
              <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
                {formatNumber(data.summary.totalVisitors)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Visites quotidiennes cumulées</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">Visiteurs uniques</p>
              <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
                {formatNumber(data.summary.uniqueVisitors)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Identifiants anonymes distincts</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">Nombre de sessions</p>
              <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
                {formatNumber(data.summary.sessions)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {(data.summary.sessions / Math.max(1, data.summary.uniqueVisitors)).toFixed(2)} ses. / visiteur
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">Pages vues</p>
              <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
                {formatNumber(data.summary.pageViews)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {(data.summary.pageViews / Math.max(1, data.summary.sessions)).toFixed(2)} pages / session
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">Durée moyenne des sessions</p>
              <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
                {formatDuration(data.summary.avgSessionDurationSec)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Temps d’engagement actif</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">Taux de rebond</p>
              <p className="mt-2 font-display text-3xl font-bold text-foreground tabular-nums">
                {data.summary.bounceRate}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Sessions à 1 page (&lt; 15s)</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium text-muted-foreground">
                Nouveaux vs Récurrents
              </p>
              <div className="mt-2 flex items-baseline justify-between gap-2 tabular-nums">
                <span className="font-display text-2xl font-bold text-primary">
                  {formatNumber(data.summary.newVisitors)}
                </span>
                <span className="text-xs text-muted-foreground">/</span>
                <span className="font-display text-2xl font-bold text-foreground">
                  {formatNumber(data.summary.returningVisitors)}
                </span>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-background">
                <div className="bg-primary" style={{ width: `${newPct}%` }} />
                <div className="bg-sky-400" style={{ width: `${retPct}%` }} />
              </div>
              <p className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>Nouveaux ({newPct}%)</span>
                <span>Récurrents ({retPct}%)</span>
              </p>
            </div>
          </section>

          {/* Traffic Evolution & Hourly Frequency Histogram */}
          <section className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Évolution des visites et pages vues
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  Sessions · Visiteurs uniques · Pages vues
                </span>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.timeline}>
                    <defs>
                      <linearGradient id="gradPageViews" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f5b83d" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f5b83d" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                    <YAxis stroke="#9ca3af" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1b1e29',
                        borderColor: '#2e3345',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="pageViews"
                      name="Pages vues"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#gradPageViews)"
                    />
                    <Area
                      type="monotone"
                      dataKey="sessions"
                      name="Sessions"
                      stroke="#f5b83d"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#gradSessions)"
                    />
                    <Area
                      type="monotone"
                      dataKey="uniqueVisitors"
                      name="Visiteurs uniques"
                      stroke="#34d399"
                      strokeWidth={1.8}
                      fillOpacity={0}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <Clock className="size-4 text-primary" />
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Fréquentation horaire
                </h3>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hourlyHistogram}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="hour" stroke="#9ca3af" fontSize={10} interval={2} />
                    <YAxis stroke="#9ca3af" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1b1e29',
                        borderColor: '#2e3345',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="visits"
                      name="Sessions"
                      fill="#f5b83d"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Interactive World Map + Top Countries */}
          <WorldVisitorMap
            countries={data.geo.countries}
            regions={data.geo.regions}
            cities={data.geo.cities}
          />

          {/* Geographic Tables + Geographic Traffic Evolution */}
          <section className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Globe className="size-4 text-primary" />
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    Statistiques géographiques détaillées
                  </h3>
                </div>
                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                  {(
                    [
                      ['countries', 'Pays'],
                      ['regions', 'Régions'],
                      ['cities', 'Villes'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setGeoTableTab(k)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        geoTableTab === k
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">
                        {geoTableTab === 'countries'
                          ? 'Pays'
                          : geoTableTab === 'regions'
                            ? 'Région'
                            : 'Ville'}
                      </th>
                      {geoTableTab !== 'countries' && (
                        <th className="py-2 px-3 font-medium">Pays</th>
                      )}
                      <th className="py-2 px-3 text-right font-medium">Visiteurs</th>
                      <th className="py-2 px-3 text-right font-medium">Sessions</th>
                      <th className="py-2 px-3 text-right font-medium">Pages vues</th>
                      <th className="py-2 pl-3 text-right font-medium">% Trafic</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {geoTableTab === 'countries' &&
                      data.geo.countries.map((c) => (
                        <tr key={c.countryCode}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">
                            {c.countryName}
                            <span className="ml-1.5 text-muted-foreground">({c.continent})</span>
                          </td>
                          <td className="py-2.5 px-3 text-right text-foreground">{c.visitors}</td>
                          <td className="py-2.5 px-3 text-right text-foreground">{c.sessions}</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground">
                            {c.pageViews}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-medium text-primary">
                            {c.sharePct}%
                          </td>
                        </tr>
                      ))}
                    {geoTableTab === 'regions' &&
                      data.geo.regions.map((r) => (
                        <tr key={`${r.countryCode}-${r.region}`}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">{r.region}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{r.countryName}</td>
                          <td className="py-2.5 px-3 text-right text-foreground">{r.visitors}</td>
                          <td className="py-2.5 px-3 text-right text-foreground">{r.sessions}</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground">
                            {r.pageViews}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-medium text-primary">
                            {r.sharePct}%
                          </td>
                        </tr>
                      ))}
                    {geoTableTab === 'cities' &&
                      data.geo.cities.map((c) => (
                        <tr key={`${c.countryCode}-${c.region}-${c.city}`}>
                          <td className="py-2.5 pr-4 font-medium text-foreground">{c.city}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{c.countryName}</td>
                          <td className="py-2.5 px-3 text-right text-foreground">{c.visitors}</td>
                          <td className="py-2.5 px-3 text-right text-foreground">{c.sessions}</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground">
                            {c.pageViews}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-medium text-primary">
                            {c.sharePct}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-xl border border-border bg-card p-5">
              <div className="mb-4">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Évolution du trafic par pays
                </h3>
                <p className="text-xs text-muted-foreground">
                  Top 5 des pays sur la période sélectionnée
                </p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.geo.geoTimeline.points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                    <YAxis stroke="#9ca3af" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1b1e29',
                        borderColor: '#2e3345',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    {data.geo.geoTimeline.seriesKeys.map((countryName, idx) => (
                      <Area
                        key={countryName}
                        type="monotone"
                        dataKey={countryName}
                        stackId="geo"
                        stroke={CHART_PALETTE[idx % CHART_PALETTE.length]}
                        fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
                        fillOpacity={0.35}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Devices, Browsers, OS & Screen Resolutions */}
          <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-12">
            {/* Devices Donut */}
            <div className="lg:col-span-3 rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 font-display text-base font-semibold text-foreground">
                Types d’appareils
              </h3>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.tech.devices}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={44}
                      outerRadius={68}
                      paddingAngle={3}
                    >
                      {data.tech.devices.map((entry, idx) => (
                        <Cell key={entry.name} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1b1e29',
                        borderColor: '#2e3345',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5 text-xs tabular-nums">
                {data.tech.devices.map((d, idx) => (
                  <li key={d.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-foreground">
                      <span
                        className="size-2.5 rounded-sm"
                        style={{ backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length] }}
                      />
                      <span>{d.name}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {d.count} ({d.pct}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Browsers Donut */}
            <div className="lg:col-span-3 rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 font-display text-base font-semibold text-foreground">
                Navigateurs
              </h3>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.tech.browsers}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={44}
                      outerRadius={68}
                      paddingAngle={3}
                    >
                      {data.tech.browsers.map((entry, idx) => (
                        <Cell key={entry.name} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1b1e29',
                        borderColor: '#2e3345',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5 text-xs tabular-nums">
                {data.tech.browsers.slice(0, 5).map((b, idx) => (
                  <li key={b.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-foreground truncate">
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length] }}
                      />
                      <span className="truncate">{b.name}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {b.count} ({b.pct}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Operating Systems Bar Chart */}
            <div className="lg:col-span-3 rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 font-display text-base font-semibold text-foreground">
                Systèmes d’exploitation
              </h3>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.tech.os.slice(0, 6)}
                    layout="vertical"
                    margin={{ left: 4, right: 12 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" stroke="#9ca3af" fontSize={10} />
                    <YAxis dataKey="name" type="category" stroke="#e5e7eb" fontSize={11} width={68} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1b1e29',
                        borderColor: '#2e3345',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="count" name="Sessions" fill="#38bdf8" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Screen Resolutions */}
            <div className="lg:col-span-3 rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 font-display text-base font-semibold text-foreground">
                Résolutions d’écran
              </h3>
              <ul className="space-y-2.5 text-xs tabular-nums">
                {data.tech.resolutions.slice(0, 7).map((r) => (
                  <li key={r.resolution}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-foreground">{r.resolution}</span>
                      <span className="text-muted-foreground">
                        {r.count} ({r.pct}%)
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(4, r.pct)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Pages & Navigation + Top Popular Content */}
          <section className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Pages les plus consultées & Navigation
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-2.5 pr-4 font-medium">Page (URL & Titre)</th>
                      <th className="py-2.5 px-3 text-right font-medium">Vues</th>
                      <th className="py-2.5 px-3 text-right font-medium">Visiteurs</th>
                      <th className="py-2.5 px-3 text-right font-medium">Durée moy.</th>
                      <th className="py-2.5 px-3 text-right font-medium">Entrées</th>
                      <th className="py-2.5 px-3 text-right font-medium">Sorties</th>
                      <th className="py-2.5 pl-3 text-right font-medium">Rebond</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {data.pages.topPages.map((p) => (
                      <tr key={p.path}>
                        <td className="py-2.5 pr-4">
                          <p className="font-medium text-foreground">{p.title}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{p.path}</p>
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                          {formatNumber(p.views)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-foreground">
                          {formatNumber(p.uniqueVisitors)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {formatDuration(p.avgDurationSec)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {formatNumber(p.entries)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {formatNumber(p.exits)}
                        </td>
                        <td className="py-2.5 pl-3 text-right text-muted-foreground">
                          {p.bounceRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-2">
                <Film className="size-4 text-primary" />
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Contenus les plus populaires
                </h3>
              </div>
              {data.pages.topContent.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucune fiche film, série ou anime consultée sur cette période.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.pages.topContent.map((c, idx) => (
                    <li key={c.path}>
                      <Link
                        to={c.path}
                        className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:text-primary"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            #{idx + 1} · {c.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {c.itemType} · <span className="font-mono">{c.path}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs tabular-nums">
                          <p className="font-semibold text-primary">{c.views} vues</p>
                          <p className="text-muted-foreground">
                            <Users className="mr-1 inline size-3" />
                            {c.uniqueVisitors}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
