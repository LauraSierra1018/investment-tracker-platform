'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  Scale,
  Trash2,
} from 'lucide-react';

import { api } from '@/lib/api';
import { StockSearch } from '@/components/stock-search';
import type { Stock } from '@/types';

type ComparableStock = Stock & {
  beta?: number | null;
  revenue_growth?: number | null;
  earnings_growth?: number | null;
  roe?: number | null;
  roa?: number | null;
  operating_margin?: number | null;
  debt_to_equity?: number | null;
  current_ratio?: number | null;
  free_cash_flow?: number | null;
  target_price?: number | null;
  upside_percent?: number | null;
};

type MetricDefinition = {
  key: string;
  label: string;
  category: 'Valoración' | 'Crecimiento' | 'Calidad' | 'Riesgo' | 'Tamaño';
  direction?: 'higher' | 'lower' | 'neutral';
  getValue: (stock: ComparableStock) => number | null;
  format: (value: number | null) => string;
};

const MAX_ASSETS = 4;

const metrics: MetricDefinition[] = [
  {
    key: 'score',
    label: 'Score',
    category: 'Calidad',
    direction: 'higher',
    getValue: (s) => numberOrNull(s.score),
    format: (v) => (v == null ? '—' : `${v.toFixed(0)}/100`),
  },
  {
    key: 'market_cap',
    label: 'Market Cap',
    category: 'Tamaño',
    direction: 'higher',
    getValue: (s) => numberOrNull(s.market_cap),
    format: formatLargeNumber,
  },
  {
    key: 'pe_ratio',
    label: 'P/E',
    category: 'Valoración',
    direction: 'lower',
    getValue: (s) => numberOrNull(s.pe_ratio),
    format: (v) => (v == null ? '—' : `${v.toFixed(1)}x`),
  },
  {
    key: 'upside',
    label: 'Potencial',
    category: 'Valoración',
    direction: 'higher',
    getValue: (s) => getUpside(s),
    format: formatPercent,
  },
  {
    key: 'revenue_growth',
    label: 'Crecimiento ingresos',
    category: 'Crecimiento',
    direction: 'higher',
    getValue: (s) => normalizePercent(numberOrNull(s.revenue_growth)),
    format: formatPercent,
  },
  {
    key: 'earnings_growth',
    label: 'Crecimiento ganancias',
    category: 'Crecimiento',
    direction: 'higher',
    getValue: (s) => normalizePercent(numberOrNull(s.earnings_growth)),
    format: formatPercent,
  },
  {
    key: 'roe',
    label: 'ROE',
    category: 'Calidad',
    direction: 'higher',
    getValue: (s) => normalizePercent(metricFromStockOrCriteria(s, ['roe', 'return_on_equity'])),
    format: formatPercent,
  },
  {
    key: 'operating_margin',
    label: 'Margen operativo',
    category: 'Calidad',
    direction: 'higher',
    getValue: (s) => normalizePercent(metricFromStockOrCriteria(s, ['operating_margin', 'operating_margins'])),
    format: formatPercent,
  },
  {
    key: 'debt_to_equity',
    label: 'Deuda / Equity',
    category: 'Riesgo',
    direction: 'lower',
    getValue: (s) => metricFromStockOrCriteria(s, ['debt_to_equity', 'debt_equity']),
    format: (v) => (v == null ? '—' : v.toFixed(2)),
  },
  {
    key: 'beta',
    label: 'Beta',
    category: 'Riesgo',
    direction: 'lower',
    getValue: (s) => metricFromStockOrCriteria(s, ['beta']),
    format: (v) => (v == null ? '—' : v.toFixed(2)),
  },
  {
    key: 'free_float',
    label: 'Free Float',
    category: 'Riesgo',
    direction: 'higher',
    getValue: (s) => numberOrNull(s.free_float_percent),
    format: formatPercent,
  },
];

export function ResearchCompare({ baseStock }: { baseStock: Stock }) {
  const [assets, setAssets] = useState<ComparableStock[]>([
    baseStock as ComparableStock,
  ]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const baseTicker = baseStock.ticker;

  // If the user researches a different base ticker without remounting this component,
  // keep the current research asset as the first column.
  const normalizedAssets = useMemo(() => {
    const hasBase = assets.some((asset) => asset.ticker === baseTicker);
    if (hasBase) return assets;
    return [baseStock as ComparableStock, ...assets].slice(0, MAX_ASSETS);
  }, [assets, baseStock, baseTicker]);

  async function addTicker(ticker: string) {
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;

    if (normalizedAssets.some((asset) => asset.ticker === clean)) {
      setError(`${clean} ya está en la comparación.`);
      return;
    }

    if (normalizedAssets.length >= MAX_ASSETS) {
      setError(`Puedes comparar hasta ${MAX_ASSETS} activos a la vez.`);
      return;
    }

    setAdding(true);
    setError('');

    try {
      const result = await api<ComparableStock>(
        `/stocks/${encodeURIComponent(clean)}`
      );
      setAssets((current) => {
        const next = current.some((asset) => asset.ticker === baseTicker)
          ? current
          : [baseStock as ComparableStock, ...current];
        return [...next, result].slice(0, MAX_ASSETS);
      });
    } catch (e: any) {
      setError(e?.message || `No fue posible cargar ${clean}.`);
    } finally {
      setAdding(false);
    }
  }

  function removeTicker(ticker: string) {
    if (ticker === baseTicker) return;
    setAssets((current) => current.filter((asset) => asset.ticker !== ticker));
  }

  const winners = useMemo(() => {
    const result = new Map<string, string>();

    for (const metric of metrics) {
      if (metric.direction === 'neutral') continue;
      const rows = normalizedAssets
        .map((asset) => ({ ticker: asset.ticker, value: metric.getValue(asset) }))
        .filter((row): row is { ticker: string; value: number } => row.value != null);

      if (rows.length < 2) continue;

      const sorted = [...rows].sort((a, b) =>
        metric.direction === 'lower' ? a.value - b.value : b.value - a.value
      );
      result.set(metric.key, sorted[0].ticker);
    }

    return result;
  }, [normalizedAssets]);

  const categories = ['Valoración', 'Crecimiento', 'Calidad', 'Riesgo', 'Tamaño'] as const;

  return (
    <section className="space-y-5">
      <div className="card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Scale size={20} className="text-indigo-600" />
              <h2 className="text-2xl font-black">Comparar activos</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Compara hasta cuatro acciones o ETFs lado a lado. La plataforma destaca
              automáticamente el mejor valor disponible en cada métrica, pero no convierte
              esa diferencia en una recomendación de compra.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            <span className="font-black text-slate-900">{normalizedAssets.length}</span>
            {' / '}{MAX_ASSETS} activos
          </div>
        </div>

        {normalizedAssets.length < MAX_ASSETS && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-400">
              Añadir activo
            </p>
            <StockSearch onSelect={addTicker} />
            {adding && (
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                Añadiendo a la comparación...
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="sticky left-0 z-20 min-w-[190px] bg-slate-50 px-5 py-4 text-left text-xs font-black uppercase tracking-wide text-slate-400">
                  Métrica
                </th>
                {normalizedAssets.map((asset) => (
                  <th key={asset.ticker} className="min-w-[190px] px-5 py-4 text-left align-top">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-950">{asset.ticker}</p>
                        <p className="mt-1 max-w-[160px] truncate text-xs font-medium text-slate-500">
                          {asset.company}
                        </p>
                        <p className="mt-2 text-sm font-black text-slate-900">
                          {asset.price != null
                            ? `${asset.currency || ''} ${asset.price.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : 'Sin precio'}
                        </p>
                      </div>

                      {asset.ticker !== baseTicker && (
                        <button
                          onClick={() => removeTicker(asset.ticker)}
                          title={`Quitar ${asset.ticker}`}
                          className="rounded-lg p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {categories.map((category) => {
                const categoryMetrics = metrics.filter((metric) => metric.category === category);

                return [
                  <tr key={`${category}-header`} className="border-b bg-white">
                    <td
                      colSpan={normalizedAssets.length + 1}
                      className="px-5 pb-2 pt-6 text-xs font-black uppercase tracking-[0.16em] text-indigo-600"
                    >
                      {category}
                    </td>
                  </tr>,
                  ...categoryMetrics.map((metric) => {
                    const winner = winners.get(metric.key);

                    return (
                      <tr key={metric.key} className="border-b last:border-b-0 hover:bg-slate-50/60">
                        <td className="sticky left-0 z-10 bg-white px-5 py-4 text-sm font-bold text-slate-700">
                          <div className="flex items-center gap-2">
                            {metric.label}
                            {metric.direction === 'higher' && (
                              <ArrowUp size={13} className="text-slate-300" />
                            )}
                            {metric.direction === 'lower' && (
                              <ArrowDown size={13} className="text-slate-300" />
                            )}
                          </div>
                        </td>

                        {normalizedAssets.map((asset) => {
                          const value = metric.getValue(asset);
                          const isWinner = winner === asset.ticker;

                          return (
                            <td key={`${metric.key}-${asset.ticker}`} className="px-5 py-4 align-middle">
                              <div
                                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-black ${
                                  isWinner
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'text-slate-800'
                                }`}
                              >
                                {isWinner && <CheckCircle2 size={15} />}
                                {metric.format(value)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {normalizedAssets.map((asset) => (
          <article key={asset.ticker} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xl font-black">{asset.ticker}</p>
                <p className="text-sm text-slate-500">{asset.company}</p>
              </div>
              <span className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black">
                {asset.score != null ? `${Number(asset.score).toFixed(0)}/100` : 'Sin score'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniMetric label="P/E" value={metrics[2].format(metrics[2].getValue(asset))} />
              <MiniMetric label="Potencial" value={metrics[3].format(metrics[3].getValue(asset))} />
              <MiniMetric label="Beta" value={metrics[9].format(metrics[9].getValue(asset))} />
              <MiniMetric label="Market Cap" value={metrics[1].format(metrics[1].getValue(asset))} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 font-black text-slate-800">{value}</p>
    </div>
  );
}

function metricFromStockOrCriteria(
  stock: ComparableStock,
  keys: string[]
): number | null {
  for (const key of keys) {
    const direct = numberOrNull((stock as any)[key]);
    if (direct != null) return direct;
  }

  const criteria = ((stock as any).criteria ?? []) as Array<{
    key?: string;
    name?: string;
    value?: number | null;
  }>;

  const normalizedKeys = keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ''));

  for (const criterion of criteria) {
    const candidates = [criterion.key ?? '', criterion.name ?? ''].map((value) =>
      value.toLowerCase().replace(/[^a-z0-9]/g, '')
    );

    if (candidates.some((candidate) => normalizedKeys.some((key) => candidate.includes(key)))) {
      const value = numberOrNull(criterion.value);
      if (value != null) return value;
    }
  }

  return null;
}

function getUpside(stock: ComparableStock): number | null {
  const explicit = numberOrNull(stock.upside_percent);
  if (explicit != null) return explicit;

  if (stock.price != null && stock.price > 0 && stock.target_price != null) {
    return ((stock.target_price - stock.price) / stock.price) * 100;
  }

  return metricFromStockOrCriteria(stock, ['upside', 'potential', 'potencial']);
}

function normalizePercent(value: number | null): number | null {
  if (value == null) return null;
  return Math.abs(value) <= 2 ? value * 100 : value;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPercent(value: number | null): string {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatLargeNumber(value: number | null): string {
  if (value == null) return '—';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)} M`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
