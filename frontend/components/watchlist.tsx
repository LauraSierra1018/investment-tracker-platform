'use client';

import { useEffect, useState } from 'react';
import {
  Trash2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Search,
  LockKeyhole,
} from 'lucide-react';

import { api } from '@/lib/api';
import { RequireAuth } from '@/components/require-auth';

type WatchlistSavedItem = {
  id?: number;
  ticker: string;
};

type WatchlistStock = {
  ticker: string;
  company: string;

  sector?: string | null;
  industry?: string | null;
  description?: string | null;

  price?: number | null;
  currency?: string | null;

  target_price?: number | null;
  upside_percent?: number | null;

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
};

export function Watchlist() {
  return (
    <RequireAuth>
      <WatchlistContent />
    </RequireAuth>
  );
}

function WatchlistContent() {
  const [stocks, setStocks] = useState<WatchlistStock[]>([]);
  const [filteredStocks, setFilteredStocks] =
    useState<WatchlistStock[]>([]);

  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState('');

  async function loadWatchlist(showRefreshing = false) {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      }

      setError('');

      const saved =
        await api<WatchlistSavedItem[]>('/watchlist');

      const results = await Promise.all(
        saved.map(async (item) => {
          try {
            return await api<WatchlistStock>(
              `/stocks/${encodeURIComponent(item.ticker)}`
            );
          } catch (error) {
            console.error(
              `Error cargando ${item.ticker}`,
              error
            );

            return {
              ticker: item.ticker,
              company: item.ticker,
            } as WatchlistStock;
          }
        })
      );

      setStocks(results);
      setFilteredStocks(results);
    } catch (error: any) {
      console.error(
        'Error cargando watchlist:',
        error
      );

      setError(
        error?.message ||
          'No fue posible cargar la watchlist.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadWatchlist();
  }, []);

  useEffect(() => {
    const value =
      search.toLowerCase().trim();

    if (!value) {
      setFilteredStocks(stocks);
      return;
    }

    const filtered =
      stocks.filter((stock) => {
        return (
          stock.ticker
            .toLowerCase()
            .includes(value) ||
          stock.company
            .toLowerCase()
            .includes(value) ||
          stock.sector
            ?.toLowerCase()
            .includes(value) ||
          stock.industry
            ?.toLowerCase()
            .includes(value)
        );
      });

    setFilteredStocks(filtered);
  }, [search, stocks]);

  async function remove(ticker: string) {
    try {
      setError('');

      await api(
        `/watchlist/${encodeURIComponent(ticker)}`,
        {
          method: 'DELETE',
        }
      );

      const newStocks =
        stocks.filter(
          (stock) =>
            stock.ticker !== ticker
        );

      setStocks(newStocks);
    } catch (error: any) {
      console.error(
        'Error eliminando activo:',
        error
      );

      setError(
        error?.message ||
          'No fue posible eliminar el activo.'
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* HEADER */}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Seguimiento
          </p>

          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-3xl font-black">
              Watchlist
            </h1>

            <div className="flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-600">
              <LockKeyhole size={12} />
              Privada
            </div>
          </div>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Sigue las empresas que estás
            investigando y compara sus
            indicadores más importantes.
            Esta watchlist está asociada a
            tu cuenta.
          </p>
        </div>

        <button
          onClick={() =>
            loadWatchlist(true)
          }
          disabled={refreshing}
          className="flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw
            size={17}
            className={
              refreshing
                ? 'animate-spin'
                : ''
            }
          />

          {refreshing
            ? 'Actualizando...'
            : 'Actualizar datos'}
        </button>
      </div>

      {/* ERROR */}

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* SEARCH */}

      <div className="card p-4">
        <div className="flex items-center gap-3 rounded-xl border bg-slate-50 px-4">
          <Search
            size={18}
            className="text-slate-400"
          />

          <input
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Buscar dentro de tu watchlist..."
            className="h-11 flex-1 bg-transparent outline-none"
          />

          {search && (
            <button
              onClick={() =>
                setSearch('')
              }
              className="text-xs font-bold text-slate-400 hover:text-slate-700"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* EMPTY */}

      {stocks.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <Search className="text-slate-400" />
          </div>

          <h2 className="mt-4 text-xl font-black">
            Todavía no tienes activos guardados
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Busca una empresa desde
            Investigación y pulsa{' '}
            <strong>
              Guardar en watchlist
            </strong>
            .
          </p>
        </div>
      ) : filteredStocks.length === 0 ? (
        <div className="card p-10 text-center">
          <h2 className="font-black">
            No encontramos coincidencias
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Intenta buscar por ticker,
            empresa, sector o industria.
          </p>
        </div>
      ) : (
        /* TABLE */

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px]">

              {/* HEADER */}

              <thead>
                <tr className="border-b bg-slate-50 text-left">

                  <TableHeader>
                    Empresa
                  </TableHeader>

                  <TableHeader>
                    Descripción
                  </TableHeader>

                  <TableHeader align="right">
                    Precio
                  </TableHeader>

                  <TableHeader align="right">
                    Target
                  </TableHeader>

                  <TableHeader align="right">
                    Potencial
                  </TableHeader>

                  <TableHeader align="right">
                    P/E
                  </TableHeader>

                  <TableHeader align="right">
                    Market Cap
                  </TableHeader>

                  <TableHeader align="right">
                    Ventas
                  </TableHeader>

                  <TableHeader align="right">
                    Free Float
                  </TableHeader>

                  <TableHeader align="center">
                    Score
                  </TableHeader>

                  <TableHeader align="center">
                    Acción
                  </TableHeader>

                </tr>
              </thead>

              {/* BODY */}

              <tbody className="divide-y">
                {filteredStocks.map(
                  (stock) => {
                    const upside =
                      getUpside(stock);

                    const dailyChange =
                      stock.change_percent ??
                      stock.daily_change_percent ??
                      null;

                    return (
                      <tr
                        key={
                          stock.ticker
                        }
                        className="transition hover:bg-slate-50/80"
                      >

                        {/* COMPANY */}

                        <td className="px-5 py-5 align-top">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
                              {stock.ticker.slice(
                                0,
                                4
                              )}
                            </div>

                            <div>
                              <div className="font-black">
                                {
                                  stock.ticker
                                }
                              </div>

                              <div className="mt-0.5 max-w-[180px] truncate text-sm font-medium text-slate-700">
                                {
                                  stock.company
                                }
                              </div>

                              <div className="mt-1 text-xs text-slate-400">
                                {stock.sector ||
                                  'Sector sin dato'}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* DESCRIPTION */}

                        <td className="max-w-[300px] px-5 py-5 align-top">
                          <p className="line-clamp-3 text-sm leading-5 text-slate-600">
                            {getDescription(
                              stock
                            )}
                          </p>

                          {stock.industry && (
                            <span className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                              {
                                stock.industry
                              }
                            </span>
                          )}
                        </td>

                        {/* PRICE */}

                        <td className="px-5 py-5 text-right align-top">
                          <div className="font-black">
                            {formatPrice(
                              stock
                            )}
                          </div>

                          {dailyChange !=
                            null && (
                            <div
                              className={`mt-1 flex items-center justify-end gap-1 text-xs font-bold ${
                                dailyChange >=
                                0
                                  ? 'text-emerald-600'
                                  : 'text-rose-600'
                              }`}
                            >
                              {dailyChange >=
                              0 ? (
                                <TrendingUp
                                  size={
                                    13
                                  }
                                />
                              ) : (
                                <TrendingDown
                                  size={
                                    13
                                  }
                                />
                              )}

                              {dailyChange >=
                              0
                                ? '+'
                                : ''}

                              {dailyChange.toFixed(
                                2
                              )}
                              %
                            </div>
                          )}
                        </td>

                        {/* TARGET */}

                        <td className="px-5 py-5 text-right align-top font-bold">
                          {stock.target_price !=
                          null
                            ? `$${stock.target_price.toFixed(
                                2
                              )}`
                            : '—'}
                        </td>

                        {/* UPSIDE */}

                        <td className="px-5 py-5 text-right align-top">
                          {upside != null ? (
                            <span
                              className={`inline-flex rounded-lg px-2 py-1 text-xs font-black ${
                                upside >=
                                15
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : upside >=
                                    0
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-rose-100 text-rose-700'
                              }`}
                            >
                              {upside >=
                              0
                                ? '+'
                                : ''}

                              {upside.toFixed(
                                1
                              )}
                              %
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>

                        {/* PE */}

                        <td className="px-5 py-5 text-right align-top">
                          <MetricValue
                            value={
                              stock.pe_ratio !=
                              null
                                ? `${stock.pe_ratio.toFixed(
                                    1
                                  )}x`
                                : null
                            }
                            status={
                              stock.pe_ratio !=
                                null &&
                              stock.pe_ratio >=
                                20 &&
                              stock.pe_ratio <=
                                25
                                ? 'good'
                                : undefined
                            }
                          />
                        </td>

                        {/* MARKET CAP */}

                        <td className="px-5 py-5 text-right align-top font-medium">
                          {formatLargeNumber(
                            stock.market_cap
                          )}
                        </td>

                        {/* REVENUE */}

                        <td className="px-5 py-5 text-right align-top font-medium">
                          {formatRevenue(
                            stock
                          )}
                        </td>

                        {/* FLOAT */}

                        <td className="px-5 py-5 text-right align-top">
                          <MetricValue
                            value={
                              stock.free_float_percent !=
                              null
                                ? `${stock.free_float_percent.toFixed(
                                    1
                                  )}%`
                                : null
                            }
                            status={
                              stock.free_float_percent !=
                                null &&
                              stock.free_float_percent >=
                                40
                                ? 'good'
                                : undefined
                            }
                          />
                        </td>

                        {/* SCORE */}

                        <td className="px-5 py-5 text-center align-top">
                          <ScoreBadge
                            score={
                              stock.score
                            }
                            classification={
                              stock.classification
                            }
                          />
                        </td>

                        {/* DELETE */}

                        <td className="px-5 py-5 text-center align-top">
                          <button
                            onClick={() =>
                              remove(
                                stock.ticker
                              )
                            }
                            title="Eliminar de watchlist"
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2
                              size={17}
                            />
                          </button>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>

          {/* FOOTER */}

          <div className="flex items-center justify-between border-t bg-slate-50 px-5 py-3 text-xs text-slate-500">
            <span>
              {filteredStocks.length}{' '}
              {filteredStocks.length ===
              1
                ? 'activo'
                : 'activos'}{' '}
              en seguimiento
            </span>

            {search && (
              <span>
                Filtrando de{' '}
                {stocks.length}{' '}
                activos
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================
   TABLE HEADER
========================================================== */

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

/* ==========================================================
   METRIC
========================================================== */

function MetricValue({
  value,
  status,
}: {
  value: string | null;
  status?: 'good';
}) {
  if (!value) {
    return (
      <span className="text-slate-400">
        —
      </span>
    );
  }

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

/* ==========================================================
   SCORE
========================================================== */

function ScoreBadge({
  score,
  classification,
}: {
  score?: number | null;
  classification?: string | null;
}) {
  if (score == null) {
    return (
      <span className="text-slate-400">
        —
      </span>
    );
  }

  let style =
    'bg-rose-100 text-rose-700';

  if (score >= 75) {
    style =
      'bg-emerald-100 text-emerald-700';
  } else if (score >= 55) {
    style =
      'bg-amber-100 text-amber-700';
  }

  return (
    <div>
      <span
        className={`inline-flex rounded-lg px-3 py-1 text-sm font-black ${style}`}
      >
        {score.toFixed(0)}
      </span>

      {classification && (
        <p className="mt-1 whitespace-nowrap text-[10px] font-medium text-slate-400">
          {classification}
        </p>
      )}
    </div>
  );
}

/* ==========================================================
   HELPERS
========================================================== */

function getUpside(
  stock: WatchlistStock
): number | null {
  if (
    stock.upside_percent != null
  ) {
    return stock.upside_percent;
  }

  if (
    stock.price != null &&
    stock.price > 0 &&
    stock.target_price != null
  ) {
    return (
      ((stock.target_price -
        stock.price) /
        stock.price) *
      100
    );
  }

  return null;
}

function getDescription(
  stock: WatchlistStock
) {
  if (stock.description) {
    return stock.description;
  }

  if (
    stock.sector &&
    stock.industry
  ) {
    return `${stock.company} pertenece al sector ${stock.sector} y opera principalmente en la industria ${stock.industry}.`;
  }

  if (stock.sector) {
    return `${stock.company} es una empresa del sector ${stock.sector}.`;
  }

  return `${stock.company} (${stock.ticker}) es uno de los activos que estás siguiendo actualmente.`;
}

function formatPrice(
  stock: WatchlistStock
) {
  if (stock.price == null) {
    return '—';
  }

  const currency =
    stock.currency || 'USD';

  return `${currency} ${stock.price.toLocaleString(
    'en-US',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  )}`;
}

function formatLargeNumber(
  value?: number | null
) {
  if (value == null) {
    return '—';
  }

  if (value >= 1e12) {
    return `$${(
      value / 1e12
    ).toFixed(2)} T`;
  }

  if (value >= 1e9) {
    return `$${(
      value / 1e9
    ).toFixed(2)} B`;
  }

  if (value >= 1e6) {
    return `$${(
      value / 1e6
    ).toFixed(1)} M`;
  }

  return `$${value.toLocaleString()}`;
}

function formatRevenue(
  stock: WatchlistStock
) {
  if (stock.revenue != null) {
    return formatLargeNumber(
      stock.revenue
    );
  }

  if (
    stock.revenue_millions !=
    null
  ) {
    if (
      stock.revenue_millions >=
      1000
    ) {
      return `$${(
        stock.revenue_millions /
        1000
      ).toFixed(2)} B`;
    }

    return `$${stock.revenue_millions.toFixed(
      1
    )} M`;
  }

  return '—';
}