'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  LockKeyhole,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

import { api } from '@/lib/api';
import { RequireAuth } from '@/components/require-auth';

type WatchlistSavedItem = {
  id?: number;
  ticker: string;
  created_at?: string | null;
};

type WatchlistStock = {
  id?: number;
  ticker: string;
  company: string;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  target_price?: number | null;
  upside_percent?: number | null;
  upside_pct?: number | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  revenue?: number | null;
  revenue_millions?: number | null;
  free_float_percent?: number | null;
  score?: number | null;
  classification?: string | null;
  change_percent?: number | null;
  daily_change_percent?: number | null;
  source?: string | null;
  created_at?: string | null;
  market_data_available?: boolean;
  market_data_error?: string | null;
};

const CACHE_KEY = 'investment-tracker-watchlist-cache-v2';
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 450;

export function Watchlist() {
  return (
    <RequireAuth>
      <WatchlistContent />
    </RequireAuth>
  );
}

function WatchlistContent() {
  const [stocks, setStocks] = useState<WatchlistStock[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const filteredStocks = useMemo(() => {
    const value = search.toLowerCase().trim();
    const source = value
      ? stocks.filter((stock) =>
          stock.ticker.toLowerCase().includes(value) ||
          stock.company.toLowerCase().includes(value) ||
          stock.sector?.toLowerCase().includes(value) ||
          stock.industry?.toLowerCase().includes(value)
        )
      : stocks;

    return [...source].sort(compareStocksByScore);
  }, [search, stocks]);

  function readCache(): WatchlistStock[] {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCache(items: WatchlistStock[]) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch (cacheError) {
      console.warn('No se pudo guardar la caché local:', cacheError);
    }
  }

  async function enrichInBatches(rows: WatchlistStock[]) {
    const output: WatchlistStock[] = [];

    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((item) =>
          api<WatchlistStock>(
            `/stocks/${encodeURIComponent(item.ticker)}`
          )
        )
      );

      results.forEach((result, index) => {
        const base = batch[index];

        if (result.status === 'fulfilled') {
          output.push({
            ...base,
            ...result.value,
            id: base.id,
            ticker: base.ticker,
            created_at: base.created_at,
            market_data_available: true,
            market_data_error: null,
          });
        } else {
          output.push({
            ...base,
            market_data_available: false,
            market_data_error:
              result.reason instanceof Error
                ? result.reason.message
                : 'Datos de mercado temporalmente no disponibles.',
          });
        }
      });

      if (start + BATCH_SIZE < rows.length) {
        await delay(BATCH_DELAY_MS);
      }
    }

    return output;
  }

  async function loadWatchlist(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    setError('');
    setWarning('');

    const cached = readCache();

    if (stocks.length === 0 && cached.length > 0) {
      setStocks([...cached].sort(compareStocksByScore));
    }

    try {
      const saved = await api<WatchlistSavedItem[]>('/watchlist');
      const previousByTicker = new Map(
        [...stocks, ...cached].map((item) => [
          item.ticker.toUpperCase(),
          item,
        ])
      );

      const baseRows: WatchlistStock[] = saved.map((item) => {
        const ticker = item.ticker.trim().toUpperCase();
        const previous = previousByTicker.get(ticker);

        return {
          id: item.id,
          ticker,
          company: previous?.company || ticker,
          sector: previous?.sector ?? null,
          industry: previous?.industry ?? null,
          description: previous?.description ?? null,
          price: previous?.price ?? null,
          currency: previous?.currency ?? null,
          target_price: previous?.target_price ?? null,
          upside_percent:
            previous?.upside_percent ?? previous?.upside_pct ?? null,
          market_cap: previous?.market_cap ?? null,
          pe_ratio: previous?.pe_ratio ?? null,
          revenue: previous?.revenue ?? null,
          revenue_millions: previous?.revenue_millions ?? null,
          free_float_percent: previous?.free_float_percent ?? null,
          score: previous?.score ?? null,
          classification: previous?.classification ?? null,
          change_percent: previous?.change_percent ?? null,
          daily_change_percent: previous?.daily_change_percent ?? null,
          source: previous?.source ?? null,
          created_at: item.created_at ?? previous?.created_at ?? null,
          market_data_available: previous?.market_data_available ?? false,
          market_data_error: previous?.market_data_error ?? null,
        };
      });

      // La lista guardada se muestra antes de consultar Yahoo.
      setStocks([...baseRows].sort(compareStocksByScore));
      saveCache(baseRows);

      const enriched = await enrichInBatches(baseRows);
      const ordered = [...enriched].sort(compareStocksByScore);

      setStocks(ordered);
      saveCache(ordered);

      const unavailable = ordered.filter(
        (item) => item.market_data_available === false
      );

      if (unavailable.length > 0) {
        setWarning(
          `${unavailable.length} ${
            unavailable.length === 1 ? 'activo no pudo' : 'activos no pudieron'
          } actualizar sus datos de mercado. Los tickers siguen guardados.`
        );
      }
    } catch (loadError: any) {
      console.error('Error cargando watchlist:', loadError);

      const fallback = stocks.length > 0 ? stocks : cached;

      // Nunca vaciamos la lista por un error 429/502.
      if (fallback.length > 0) {
        setStocks([...fallback].sort(compareStocksByScore));
        setWarning(
          'No fue posible consultar el servidor. Se muestra la última versión guardada de tu watchlist.'
        );
      } else {
        setError(
          loadError?.message || 'No fue posible cargar la watchlist.'
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(ticker: string) {
    try {
      setError('');
      setWarning('');

      await api(`/watchlist/${encodeURIComponent(ticker)}`, {
        method: 'DELETE',
      });

      const next = stocks.filter((stock) => stock.ticker !== ticker);
      setStocks(next);
      saveCache(next);
    } catch (removeError: any) {
      setError(
        removeError?.message || 'No fue posible eliminar el activo.'
      );
    }
  }

  if (loading && stocks.length === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Seguimiento
          </p>

          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-3xl font-black">Watchlist</h1>
            <div className="flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600">
              <LockKeyhole size={12} />
              Privada
            </div>
          </div>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Tus activos están ordenados automáticamente de mayor a menor score.
            Un error temporal del proveedor no elimina los tickers guardados.
          </p>
        </div>

        <button
          onClick={() => loadWatchlist(true)}
          disabled={refreshing}
          className="flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw
            size={17}
            className={refreshing ? 'animate-spin' : ''}
          />
          {refreshing ? 'Actualizando...' : 'Actualizar datos'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {warning && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center gap-3 rounded-xl border bg-slate-50 px-4">
          <Search size={18} className="text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar dentro de tu watchlist..."
            className="h-11 flex-1 bg-transparent outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs font-bold text-slate-400 hover:text-slate-700"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {stocks.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <Search className="text-slate-400" />
          </div>
          <h2 className="mt-4 text-xl font-black">
            Todavía no tienes activos guardados
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Busca una empresa desde Investigación y pulsa{' '}
            <strong>Guardar en watchlist</strong>.
          </p>
        </div>
      ) : filteredStocks.length === 0 ? (
        <div className="card p-10 text-center">
          <h2 className="font-black">No encontramos coincidencias</h2>
          <p className="mt-2 text-sm text-slate-500">
            Intenta buscar por ticker, empresa, sector o industria.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1720px]">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <TableHeader align="center">Score</TableHeader>
                  <TableHeader>Acción</TableHeader>
                  <TableHeader>Descripción</TableHeader>
                  <TableHeader align="right">Potencial</TableHeader>
                  <TableHeader align="right">Precio</TableHeader>
                  <TableHeader align="right">Target</TableHeader>
                  <TableHeader align="right">P/E</TableHeader>
                  <TableHeader align="right">Market Cap</TableHeader>
                  <TableHeader align="right">Ventas</TableHeader>
                  <TableHeader align="right">Free Float</TableHeader>
                  <TableHeader align="center">Estado</TableHeader>
                  <TableHeader align="center">Eliminar</TableHeader>
                </tr>
              </thead>

              <tbody className="divide-y">
                {filteredStocks.map((stock) => {
                  const upside = getUpside(stock);
                  const dailyChange =
                    stock.change_percent ??
                    stock.daily_change_percent ??
                    null;

                  return (
                    <tr
                      key={stock.ticker}
                      className="transition hover:bg-slate-50/80"
                    >
                      <td className="px-5 py-5 text-center align-top">
                        <ScoreBadge
                          score={stock.score}
                          classification={stock.classification}
                        />
                      </td>

                      <td className="min-w-[230px] px-5 py-5 align-top">
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
                            {stock.ticker.slice(0, 4)}
                          </div>
                          <div>
                            <p className="font-black text-slate-900">
                              {stock.ticker}
                            </p>
                            <p className="mt-0.5 max-w-[170px] text-sm font-bold text-slate-700">
                              {stock.company}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              {stock.sector || 'Sector sin dato'}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="max-w-[360px] px-5 py-5 align-top">
                        <p className="line-clamp-3 text-sm leading-5 text-slate-600">
                          {getDescription(stock)}
                        </p>
                        {stock.industry && (
                          <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                            {stock.industry}
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-5 text-right align-top">
                        {upside != null ? (
                          <span
                            className={`inline-flex rounded-lg px-2 py-1 text-xs font-black ${
                              upside >= 15
                                ? 'bg-emerald-100 text-emerald-700'
                                : upside >= 0
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-rose-100 text-rose-700'
                            }`}
                          >
                            {upside >= 0 ? '+' : ''}
                            {upside.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-5 py-5 text-right align-top">
                        <div className="font-black">{formatPrice(stock)}</div>
                        {dailyChange != null && (
                          <div
                            className={`mt-1 flex items-center justify-end gap-1 text-xs font-bold ${
                              dailyChange >= 0
                                ? 'text-emerald-600'
                                : 'text-rose-600'
                            }`}
                          >
                            {dailyChange >= 0 ? (
                              <TrendingUp size={13} />
                            ) : (
                              <TrendingDown size={13} />
                            )}
                            {dailyChange >= 0 ? '+' : ''}
                            {dailyChange.toFixed(2)}%
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-5 text-right align-top font-bold">
                        {stock.target_price != null
                          ? `${stock.currency || 'USD'} ${stock.target_price.toFixed(2)}`
                          : '—'}
                      </td>

                      <td className="px-5 py-5 text-right align-top">
                        <MetricValue
                          value={
                            stock.pe_ratio != null
                              ? `${stock.pe_ratio.toFixed(1)}x`
                              : null
                          }
                          status={
                            stock.pe_ratio != null &&
                            stock.pe_ratio >= 20 &&
                            stock.pe_ratio <= 25
                              ? 'good'
                              : undefined
                          }
                        />
                      </td>

                      <td className="px-5 py-5 text-right align-top font-medium">
                        {formatLargeNumber(stock.market_cap)}
                      </td>

                      <td className="px-5 py-5 text-right align-top font-medium">
                        {formatRevenue(stock)}
                      </td>

                      <td className="px-5 py-5 text-right align-top">
                        <MetricValue
                          value={
                            stock.free_float_percent != null
                              ? `${stock.free_float_percent.toFixed(1)}%`
                              : null
                          }
                          status={
                            stock.free_float_percent != null &&
                            stock.free_float_percent >= 40
                              ? 'good'
                              : undefined
                          }
                        />
                      </td>

                      <td className="px-5 py-5 text-center align-top">
                        {stock.market_data_available === false ? (
                          <span
                            title={stock.market_data_error || undefined}
                            className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700"
                          >
                            Sin actualizar
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                            Actualizado
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-5 text-center align-top">
                        <button
                          onClick={() => remove(stock.ticker)}
                          title="Eliminar de watchlist"
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t bg-slate-50 px-5 py-3 text-xs text-slate-500">
            <span>
              {filteredStocks.length}{' '}
              {filteredStocks.length === 1 ? 'activo' : 'activos'} en seguimiento
            </span>
            <span>Ordenados de mayor a menor score</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TableHeader({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  const alignment =
    align === 'right'
      ? 'text-right'
      : align === 'center'
      ? 'text-center'
      : 'text-left';

  return (
    <th
      className={`px-5 py-3 text-[11px] font-black uppercase tracking-wider text-slate-400 ${alignment}`}
    >
      {children}
    </th>
  );
}

function MetricValue({
  value,
  status,
}: {
  value: string | null;
  status?: 'good';
}) {
  if (!value) return <span className="text-slate-400">—</span>;

  return (
    <span
      className={
        status === 'good'
          ? 'font-black text-emerald-600'
          : 'font-bold text-slate-700'
      }
    >
      {value}
    </span>
  );
}

function ScoreBadge({
  score,
  classification,
}: {
  score?: number | null;
  classification?: string | null;
}) {
  if (score == null) return <span className="text-slate-400">—</span>;

  let style = 'bg-rose-100 text-rose-700';

  if (score >= 80) style = 'bg-emerald-100 text-emerald-700';
  else if (score >= 65) style = 'bg-blue-100 text-blue-700';
  else if (score >= 50) style = 'bg-amber-100 text-amber-700';

  return (
    <div>
      <span
        className={`inline-flex rounded-lg px-3 py-1 text-sm font-black ${style}`}
      >
        {score.toFixed(1)}
      </span>
      {classification && (
        <p className="mt-1 whitespace-nowrap text-[10px] font-medium text-slate-400">
          {classification}
        </p>
      )}
    </div>
  );
}

function getUpside(stock: WatchlistStock): number | null {
  const direct = stock.upside_percent ?? stock.upside_pct ?? null;
  if (direct != null) return Number(direct);

  if (
    stock.price != null &&
    stock.price > 0 &&
    stock.target_price != null
  ) {
    return ((stock.target_price - stock.price) / stock.price) * 100;
  }

  return null;
}

function getDescription(stock: WatchlistStock) {
  if (stock.description) return stock.description;

  if (stock.sector && stock.industry) {
    return `${stock.company} pertenece al sector ${stock.sector} y opera principalmente en la industria ${stock.industry}.`;
  }

  if (stock.sector) {
    return `${stock.company} es una empresa del sector ${stock.sector}.`;
  }

  if (stock.market_data_available === false) {
    return `${stock.ticker} continúa guardado en tu watchlist. Los datos financieros no pudieron actualizarse temporalmente.`;
  }

  return `${stock.company} (${stock.ticker}) es uno de los activos que estás siguiendo actualmente.`;
}

function formatPrice(stock: WatchlistStock) {
  if (stock.price == null) return '—';

  return `${stock.currency || 'USD'} ${stock.price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatLargeNumber(value?: number | null) {
  if (value == null) return '—';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)} M`;
  return `$${value.toLocaleString()}`;
}

function formatRevenue(stock: WatchlistStock) {
  if (stock.revenue != null) return formatLargeNumber(stock.revenue);

  if (stock.revenue_millions != null) {
    if (stock.revenue_millions >= 1000) {
      return `$${(stock.revenue_millions / 1000).toFixed(2)} B`;
    }
    return `$${stock.revenue_millions.toFixed(1)} M`;
  }

  return '—';
}

function compareStocksByScore(a: WatchlistStock, b: WatchlistStock) {
  if (a.score == null && b.score == null) {
    return a.ticker.localeCompare(b.ticker);
  }
  if (a.score == null) return 1;
  if (b.score == null) return -1;
  return Number(b.score) - Number(a.score);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}