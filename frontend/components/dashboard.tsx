'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Star,
  LockKeyhole,
  LogIn,
  Loader2,
} from 'lucide-react';

import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

import { api } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';

type MarketStock = {
  ticker: string;
  company: string;
  price: number | null;
  change_percent: number | null;
  market_cap: number | null;
};

type MarketIndex = {
  ticker: string;
  name: string;
  price: number | null;
  change_percent: number | null;
};

type MarketOverview = {
  stocks: MarketStock[];
  indices: MarketIndex[];
  leaders: MarketStock[];
  laggards: MarketStock[];
  updated_at: string;
  source: string;
};

type WatchlistItem = {
  ticker: string;
};

type WatchlistRow = {
  ticker: string;
  company: string;

  description?: string | null;
  sector?: string | null;
  industry?: string | null;

  score: number | null;
  classification?: string | null;

  price: number | null;
  target_price: number | null;
  upside_percent: number | null;

  pe_ratio?: number | null;
  market_cap?: number | null;
  revenue?: number | null;
  free_float_percent?: number | null;

  change_percent: number | null;
  currency?: string | null;
};

export function Dashboard() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [market, setMarket] =
    useState<MarketOverview | null>(null);

  const [watchlist, setWatchlist] =
    useState<WatchlistRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [watchlistLoading, setWatchlistLoading] =
    useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  /*
   * ========================================================
   * AUTH
   * ========================================================
   */

  useEffect(() => {
    const supabase = createClient();

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setUser(user);
      setAuthLoading(false);
    }

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const currentUser =
          session?.user ?? null;

        setUser(currentUser);

        /*
         * Si alguien cierra sesión,
         * limpiamos inmediatamente la watchlist
         * del estado del navegador.
         */
        if (!currentUser) {
          setWatchlist([]);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  /*
   * ========================================================
   * MARKET DATA
   * Siempre es público.
   * ========================================================
   */

  async function loadMarket() {
    const marketData =
      await api<MarketOverview>(
        '/market/overview'
      );

    setMarket(marketData);
  }

  /*
   * ========================================================
   * WATCHLIST
   * Solo se consulta si existe usuario.
   * ========================================================
   */

async function loadWatchlist() {
  if (!user) {
    setWatchlist([]);
    return;
  }

  setWatchlistLoading(true);

  try {
    const saved = await api<WatchlistItem[]>('/watchlist');

    const previousByTicker = new Map(
      watchlist.map((item) => [
        item.ticker.toUpperCase(),
        item,
      ])
    );

    const baseRows: WatchlistRow[] = saved.map((item) => {
      const ticker = item.ticker.toUpperCase();
      const previous = previousByTicker.get(ticker);

      return (
        previous ?? {
          ticker,
          company: ticker,
          description: null,
          sector: null,
          industry: null,
          score: null,
          classification: null,
          price: null,
          target_price: null,
          upside_percent: null,
          pe_ratio: null,
          market_cap: null,
          revenue: null,
          free_float_percent: null,
          change_percent: null,
          currency: 'USD',
        }
      );
    });

    setWatchlist(
      [...baseRows].sort(compareDashboardRows)
    );

    const updatedRows: WatchlistRow[] = [];

    const batchSize = 3;

    for (
      let start = 0;
      start < saved.length;
      start += batchSize
    ) {
      const batch = saved.slice(
        start,
        start + batchSize
      );

      const results = await Promise.allSettled(
        batch.map((item) =>
          api<any>(
            `/stocks/${encodeURIComponent(
              item.ticker
            )}`
          )
        )
      );

      results.forEach((result, index) => {
        const savedItem = batch[index];
        const ticker =
          savedItem.ticker.toUpperCase();

        const previous =
          previousByTicker.get(ticker);

        if (result.status === 'fulfilled') {
          const stock = result.value;

          const price =
            stock.price != null
              ? Number(stock.price)
              : null;

          const target =
            stock.target_price != null
              ? Number(stock.target_price)
              : null;

          const upside =
            stock.upside_percent ??
            stock.upside_pct ??
            (
              price != null &&
              price > 0 &&
              target != null
                ? ((target - price) / price) * 100
                : null
            );

          updatedRows.push({
            ticker:
              stock.ticker ?? ticker,

            company:
              stock.company ?? ticker,

            description:
              stock.description ?? null,

            sector:
              stock.sector ?? null,

            industry:
              stock.industry ?? null,

            score:
              stock.score != null
                ? Number(stock.score)
                : null,

            classification:
              stock.classification ?? null,

            price,

            target_price: target,

            upside_percent:
              upside != null
                ? Number(upside)
                : null,

            pe_ratio:
              stock.pe_ratio != null
                ? Number(stock.pe_ratio)
                : null,

            market_cap:
              stock.market_cap != null
                ? Number(stock.market_cap)
                : null,

            revenue:
              stock.revenue != null
                ? Number(stock.revenue)
                : null,

            free_float_percent:
              stock.free_float_percent != null
                ? Number(
                    stock.free_float_percent
                  )
                : null,

            change_percent:
              stock.change_percent ??
              stock.daily_change_percent ??
              stock.regular_market_change_percent ??
              null,

            currency:
              stock.currency ?? 'USD',
          });
        } else {
          console.error(
            `No fue posible actualizar ${ticker}:`,
            result.reason
          );

          updatedRows.push(
            previous ?? {
              ticker,
              company: ticker,
              description: null,
              sector: null,
              industry: null,
              score: null,
              classification: null,
              price: null,
              target_price: null,
              upside_percent: null,
              pe_ratio: null,
              market_cap: null,
              revenue: null,
              free_float_percent: null,
              change_percent: null,
              currency: 'USD',
            }
          );
        }
      });

      const remainingRows = baseRows.filter(
        (base) =>
          !updatedRows.some(
            (updated) =>
              updated.ticker === base.ticker
          )
      );

      const partialRows = [
        ...updatedRows,
        ...remainingRows,
      ].sort(compareDashboardRows);

      setWatchlist(partialRows);

      if (start + batchSize < saved.length) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 500);
        });
      }
    }

    setWatchlist(
      [...updatedRows].sort(
        compareDashboardRows
      )
    );
  } catch (error) {
    console.error(
      'Error cargando watchlist:',
      error
    );

    setError(
      'No fue posible actualizar todos los datos de la watchlist. Se conserva la última información disponible.'
    );
  } finally {
    setWatchlistLoading(false);
  }
}

  /*
   * ========================================================
   * DASHBOARD
   * ========================================================
   */

  async function loadDashboard(
    showRefreshing = false
  ) {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      }

      setError('');

      /*
       * El mercado siempre se actualiza.
       */
      await loadMarket();

      /*
       * La watchlist SOLO si hay sesión.
       */
      if (user) {
        await loadWatchlist();
      } else {
        setWatchlist([]);
      }
    } catch (error: any) {
      console.error(
        'Error cargando dashboard:',
        error
      );

      setError(
        error?.message ||
          'No fue posible cargar la información del mercado.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  /*
   * Primera carga.
   */

  useEffect(() => {
    if (authLoading) return;

    loadDashboard();
  }, [authLoading, user?.id]);

  /*
   * Actualización automática cada 30 segundos.
   */

  useEffect(() => {
    if (authLoading) return;

    const interval =
      window.setInterval(() => {
        loadDashboard();
      }, 300000);

    return () => {
      window.clearInterval(interval);
    };
  }, [authLoading, user?.id]);

  /*
   * ========================================================
   * UPDATED TIME
   * ========================================================
   */

  const updatedLabel =
    useMemo(() => {
      if (!market?.updated_at) {
        return '';
      }

      try {
        const date =
          new Date(
            market.updated_at
          );

        return new Intl.DateTimeFormat(
          'es-CO',
          {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
          }
        ).format(date);
      } catch {
        return market.updated_at;
      }
    }, [market?.updated_at]);

  /*
   * ========================================================
   * LOADING
   * ========================================================
   */

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ================================================
          HEADER
      ================================================= */}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Mercado
          </p>

          <h1 className="mt-1 text-3xl font-black">
            Dashboard
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Sigue el mercado y tus inversiones
            desde un solo lugar.
          </p>
        </div>

        <button
          onClick={() =>
            loadDashboard(true)
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
            : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* ================================================
          INDICES
      ================================================= */}

      {market?.indices && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {market.indices.map(
            (index) => {
              const positive =
                (index.change_percent ??
                  0) >= 0;

              return (
                <article
                  key={index.ticker}
                  className="card p-5"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-500">
                        {index.name}
                      </p>

                      <div className="mt-2 text-2xl font-black">
                        {index.price != null
                          ? index.price.toLocaleString(
                              'en-US',
                              {
                                maximumFractionDigits: 2,
                              }
                            )
                          : 'Sin dato'}
                      </div>
                    </div>

                    {positive ? (
                      <TrendingUp className="text-emerald-500" />
                    ) : (
                      <TrendingDown className="text-rose-500" />
                    )}
                  </div>

                  <div
                    className={`mt-2 text-sm font-black ${
                      positive
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {index.change_percent !=
                    null
                      ? `${
                          index.change_percent >=
                          0
                            ? '+'
                            : ''
                        }${index.change_percent.toFixed(
                          2
                        )}%`
                      : 'Sin dato'}
                  </div>
                </article>
              );
            }
          )}
        </div>
      )}

      {/* ================================================
          WATCHLIST
      ================================================= */}

      {!user ? (
        /*
         * VISITANTE
         *
         * No consultamos /watchlist y no mostramos
         * ningún activo guardado anteriormente.
         */
        <section className="card overflow-hidden">
          <div className="p-8">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
                <LockKeyhole className="text-indigo-600" />
              </div>

              <h2 className="mt-5 text-xl font-black">
                Tu watchlist personal
              </h2>

              <p className="mt-2 leading-6 text-slate-500">
                Inicia sesión para guardar las
                empresas y ETFs que estás
                investigando y verlos directamente
                en tu dashboard.
              </p>

              <button
                onClick={() =>
                  router.push('/login')
                }
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800"
              >
                <LogIn size={16} />
                Iniciar sesión
              </button>

              <p className="mt-3 text-xs text-slate-400">
                El Dashboard y la sección
                Investigación son públicos.
              </p>
            </div>
          </div>
        </section>
      ) : (
        /*
         * USUARIO AUTENTICADO
         */
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b p-6">
            <div>
              <div className="flex items-center gap-2">
                <Star
                  size={19}
                  className="text-amber-500"
                />

                <h2 className="text-xl font-black">
                  Mi watchlist
                </h2>

                <span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-black uppercase text-indigo-600">
                  Privada
                </span>
              </div>

              <p className="mt-1 text-sm text-slate-500">
                Ordenados automáticamente de mayor a menor score.
              </p>
            </div>

            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {watchlist.length}{' '}
              {watchlist.length === 1
                ? 'activo'
                : 'activos'}
            </div>
          </div>

          {watchlistLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
              <Loader2
                size={17}
                className="animate-spin"
              />

              Cargando tu watchlist...
            </div>
          ) : watchlist.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <Star
                  size={21}
                  className="text-slate-400"
                />
              </div>

              <h3 className="mt-4 font-black">
                Tu watchlist está vacía
              </h3>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Investiga una empresa o ETF y pulsa{' '}
                <strong>
                  Guardar en watchlist
                </strong>{' '}
                para comenzar.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1450px]">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <DashboardHeader>Ticker</DashboardHeader>
                    <DashboardHeader>Empresa</DashboardHeader>
                    <DashboardHeader>Descripción</DashboardHeader>
                    <DashboardHeader align="center">Score</DashboardHeader>
                    <DashboardHeader align="right">Potencial</DashboardHeader>
                    <DashboardHeader align="right">Precio</DashboardHeader>
                    <DashboardHeader align="right">Target</DashboardHeader>
                    <DashboardHeader align="right">P/E</DashboardHeader>
                    <DashboardHeader align="right">Market Cap</DashboardHeader>
                    <DashboardHeader align="right">Ventas</DashboardHeader>
                    <DashboardHeader align="right">Free Float</DashboardHeader>
                  </tr>
                </thead>

                <tbody className="divide-y">
                  {watchlist.map((item) => {
                    const dailyPositive =
                      item.change_percent != null &&
                      item.change_percent >= 0;

                    return (
                      <tr
                        key={item.ticker}
                        className="transition hover:bg-slate-50/80"
                      >
                        <td className="px-5 py-4 align-top">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
                              {item.ticker.slice(0, 4)}
                            </div>
                            <span className="font-black">{item.ticker}</span>
                          </div>
                        </td>

                        <td className="max-w-[220px] px-5 py-4 align-top">
                          <p className="font-bold text-slate-800">{item.company}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {item.sector || 'Sector sin dato'}
                          </p>
                        </td>

                        <td className="max-w-[320px] px-5 py-4 align-top">
                          <p className="line-clamp-3 text-sm leading-5 text-slate-600">
                            {getDashboardDescription(item)}
                          </p>
                        </td>

                        <td className="px-5 py-4 text-center align-top">
                          <DashboardScoreBadge
                            score={item.score}
                            classification={item.classification}
                          />
                        </td>

                        <td className="px-5 py-4 text-right align-top">
                          <DashboardUpsideBadge value={item.upside_percent} />
                        </td>

                        <td className="px-5 py-4 text-right align-top">
                          <p className="font-black">
                            {formatDashboardPrice(item.price, item.currency)}
                          </p>
                          {item.change_percent != null && (
                            <p
                              className={`mt-1 text-xs font-black ${
                                dailyPositive
                                  ? 'text-emerald-600'
                                  : 'text-rose-600'
                              }`}
                            >
                              {dailyPositive ? '+' : ''}
                              {item.change_percent.toFixed(2)}%
                            </p>
                          )}
                        </td>

                        <td className="px-5 py-4 text-right align-top font-bold">
                          {formatDashboardPrice(item.target_price, item.currency)}
                        </td>

                        <td className="px-5 py-4 text-right align-top font-bold">
                          {item.pe_ratio != null
                            ? `${item.pe_ratio.toFixed(1)}x`
                            : '—'}
                        </td>

                        <td className="px-5 py-4 text-right align-top">
                          {formatDashboardLarge(item.market_cap)}
                        </td>

                        <td className="px-5 py-4 text-right align-top">
                          {formatDashboardLarge(item.revenue)}
                        </td>

                        <td className="px-5 py-4 text-right align-top">
                          {item.free_float_percent != null
                            ? `${item.free_float_percent.toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {updatedLabel && (
            <div className="border-t bg-slate-50 px-6 py-3 text-xs text-slate-500">
              Última actualización:{' '}
              {updatedLabel}
            </div>
          )}
        </section>
      )}

      {/* ================================================
          MARKET MAP
      ================================================= */}

      {market?.stocks && (
        <section className="card p-6">
          <div>
            <h2 className="text-xl font-black">
              Mapa del mercado
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Principales empresas según
              capitalización y comportamiento
              diario.
            </p>
          </div>

          <div className="mt-5 grid auto-rows-[100px] grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {market.stocks.map(
              (stock, index) => {
                const positive =
                  (stock.change_percent ??
                    0) >= 0;

                const large =
                  index === 0 ||
                  index === 1 ||
                  index === 2;

                return (
                  <div
                    key={
                      stock.ticker
                    }
                    title={`${stock.company}
${stock.price ?? 'Sin precio'}
${
  stock.change_percent ??
  'Sin variación'
}%`}
                    className={`
                      group relative overflow-hidden rounded-xl p-4 text-white
                      transition duration-200 hover:-translate-y-1 hover:shadow-lg

                      ${
                        positive
                          ? 'bg-emerald-600'
                          : 'bg-rose-600'
                      }

                      ${
                        large
                          ? 'col-span-2 row-span-2'
                          : ''
                      }
                    `}
                  >
                    <div className="relative z-10">
                      <p className="text-lg font-black">
                        {
                          stock.ticker
                        }
                      </p>

                      <p className="mt-1 truncate text-xs text-white/70">
                        {
                          stock.company
                        }
                      </p>

                      <div className="mt-3 text-xl font-black">
                        {stock.change_percent !=
                        null
                          ? `${
                              stock.change_percent >=
                              0
                                ? '+'
                                : ''
                            }${stock.change_percent.toFixed(
                              2
                            )}%`
                          : 'Sin dato'}
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </section>
      )}

      {/* ================================================
          LEADERS / LAGGARDS
      ================================================= */}

      <div className="grid gap-6 lg:grid-cols-2">

        <MarketList
          title="Mayores subidas"
          items={
            market?.leaders ?? []
          }
          positive
        />

        <MarketList
          title="Mayores caídas"
          items={
            market?.laggards ??
            []
          }
          positive={false}
        />

      </div>

      {/* ================================================
          FOOTER
      ================================================= */}

      <div className="flex flex-col justify-between gap-2 text-xs text-slate-400 md:flex-row">
        <p>
          Fuente:{' '}
          {market?.source ||
            'Datos financieros'}
        </p>

        {updatedLabel && (
          <p>
            Última actualización:{' '}
            {updatedLabel}
          </p>
        )}
      </div>
    </div>
  );
}


function DashboardHeader({
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

function DashboardScoreBadge({
  score,
  classification,
}: {
  score: number | null;
  classification?: string | null;
}) {
  if (score == null) {
    return <span className="text-slate-400">—</span>;
  }

  const style =
    score >= 80
      ? 'bg-emerald-100 text-emerald-700'
      : score >= 65
      ? 'bg-blue-100 text-blue-700'
      : score >= 50
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';

  return (
    <div>
      <span
        className={`inline-flex rounded-lg px-3 py-1 text-sm font-black ${style}`}
      >
        {score.toFixed(1)}
      </span>

      {classification && (
        <p className="mt-1 whitespace-nowrap text-[10px] text-slate-400">
          {classification}
        </p>
      )}
    </div>
  );
}

function DashboardUpsideBadge({
  value,
}: {
  value: number | null;
}) {
  if (value == null) {
    return <span className="text-slate-400">—</span>;
  }

  const style =
    value >= 15
      ? 'bg-emerald-100 text-emerald-700'
      : value >= 0
      ? 'bg-amber-100 text-amber-700'
      : 'bg-rose-100 text-rose-700';

  return (
    <span
      className={`inline-flex rounded-lg px-2 py-1 text-xs font-black ${style}`}
    >
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

function compareDashboardRows(
  a: WatchlistRow,
  b: WatchlistRow
) {
  if (a.score == null && b.score == null) {
    return a.ticker.localeCompare(b.ticker);
  }

  if (a.score == null) return 1;
  if (b.score == null) return -1;

  return b.score - a.score;
}

function getDashboardDescription(item: WatchlistRow) {
  if (item.description) {
    return item.description;
  }

  if (item.sector && item.industry) {
    return `${item.company} pertenece al sector ${item.sector} y opera principalmente en la industria ${item.industry}.`;
  }

  if (item.sector) {
    return `${item.company} pertenece al sector ${item.sector}.`;
  }

  return `${item.company} (${item.ticker}) forma parte de tu lista de seguimiento.`;
}

function formatDashboardPrice(
  value?: number | null,
  currency?: string | null
) {
  if (value == null) return '—';

  const safeCurrency = currency || 'USD';

  return `${safeCurrency} ${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDashboardLarge(value?: number | null) {
  if (value == null) return '—';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)} M`;
  return `$${value.toLocaleString('en-US')}`;
}

/*
 * ==========================================================
 * MARKET LIST
 * ==========================================================
 */

function MarketList({
  title,
  items,
  positive,
}: {
  title: string;
  items: MarketStock[];
  positive: boolean;
}) {
  return (
    <section className="card p-6">
      <div className="flex items-center gap-2">
        {positive ? (
          <TrendingUp className="text-emerald-500" />
        ) : (
          <TrendingDown className="text-rose-500" />
        )}

        <h2 className="text-xl font-black">
          {title}
        </h2>
      </div>

      <div className="mt-5 space-y-4">
        {items
          .slice(0, 5)
          .map((stock) => (
            <div
              key={stock.ticker}
              className="flex items-center justify-between"
            >
              <div>
                <p className="font-black">
                  {stock.ticker}
                </p>

                <p className="text-xs text-slate-500">
                  {stock.company}
                </p>
              </div>

              <div className="text-right">
                <p className="font-bold">
                  {stock.price != null
                    ? `$${stock.price.toFixed(
                        2
                      )}`
                    : '—'}
                </p>

                <p
                  className={`text-sm font-black ${
                    positive
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {stock.change_percent !=
                  null
                    ? `${
                        stock.change_percent >=
                        0
                          ? '+'
                          : ''
                      }${stock.change_percent.toFixed(
                        2
                      )}%`
                    : '—'}
                </p>
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}