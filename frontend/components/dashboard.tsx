'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Star,
} from 'lucide-react';

import { api } from '@/lib/api';

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
  price: number | null;
  change_percent: number | null;
};

export function Dashboard() {
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  async function loadDashboard(showRefreshing = false) {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      }

      setError('');

      const [marketData, watchlistData] = await Promise.all([
        api<MarketOverview>('/market/overview'),
        api<WatchlistItem[]>('/watchlist'),
      ]);

      setMarket(marketData);

      const rows = await Promise.all(
        watchlistData.map(async (item) => {
          try {
            const stock = await api<any>(
              `/stocks/${encodeURIComponent(item.ticker)}`
            );

            return {
              ticker: stock.ticker,
              company: stock.company,
              price: stock.price,
              change_percent:
                stock.change_percent ??
                stock.daily_change_percent ??
                stock.regular_market_change_percent ??
                null,
            } as WatchlistRow;
          } catch (error) {
            console.error(
              `No fue posible actualizar ${item.ticker}`,
              error
            );

            return {
              ticker: item.ticker,
              company: item.ticker,
              price: null,
              change_percent: null,
            } as WatchlistRow;
          }
        })
      );

      setWatchlist(rows);
    } catch (error: any) {
      console.error('Error cargando dashboard:', error);

      setError(
        error?.message ||
          'No fue posible cargar la información del mercado.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadDashboard();

    const interval = window.setInterval(() => {
      loadDashboard();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const updatedLabel = useMemo(() => {
    if (!market?.updated_at) return '';

    try {
      const date = new Date(market.updated_at);

      return new Intl.DateTimeFormat('es-CO', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(date);
    } catch {
      return market.updated_at;
    }
  }, [market?.updated_at]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* HEADER */}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Mercado
          </p>

          <h1 className="mt-1 text-3xl font-black">
            Dashboard
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Sigue el mercado y tus acciones favoritas desde un solo lugar.
          </p>
        </div>

        <button
          onClick={() => loadDashboard(true)}
          disabled={refreshing}
          className="flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw
            size={17}
            className={refreshing ? 'animate-spin' : ''}
          />

          {refreshing ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* ÍNDICES */}

      {market?.indices && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {market.indices.map((index) => {
            const positive =
              (index.change_percent ?? 0) >= 0;

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
                        ? index.price.toLocaleString('en-US', {
                            maximumFractionDigits: 2,
                          })
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
                  {index.change_percent != null
                    ? `${
                        index.change_percent >= 0 ? '+' : ''
                      }${index.change_percent.toFixed(2)}%`
                    : 'Sin dato'}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* WATCHLIST */}

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
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Tus acciones guardadas y su comportamiento más reciente.
            </p>
          </div>

          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {watchlist.length}{' '}
            {watchlist.length === 1
              ? 'acción'
              : 'acciones'}
          </div>
        </div>

        {watchlist.length === 0 ? (
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

            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Investiga una empresa y pulsa
              <strong> Guardar </strong>
              para añadirla a esta sección.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {watchlist.map((item) => {
              const change = item.change_percent;

              const positive =
                change != null && change >= 0;

              return (
                <div
                  key={item.ticker}
                  className="flex items-center justify-between gap-4 px-6 py-4 transition hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
                        {item.ticker.slice(0, 4)}
                      </div>

                      <div className="min-w-0">
                        <p className="font-black">
                          {item.ticker}
                        </p>

                        <p className="truncate text-sm text-slate-500">
                          {item.company}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-black">
                      {item.price != null
                        ? `$${item.price.toLocaleString(
                            'en-US',
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }
                          )}`
                        : 'Sin precio'}
                    </div>

                    <div
                      className={`mt-1 text-sm font-black ${
                        change == null
                          ? 'text-slate-400'
                          : positive
                          ? 'text-emerald-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {change != null
                        ? `${positive ? '+' : ''}${change.toFixed(
                            2
                          )}%`
                        : 'Sin variación'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {updatedLabel && (
          <div className="border-t bg-slate-50 px-6 py-3 text-xs text-slate-500">
            Última actualización: {updatedLabel}
          </div>
        )}
      </section>

      {/* MAPA DEL MERCADO */}

      {market?.stocks && (
        <section className="card p-6">
          <div>
            <h2 className="text-xl font-black">
              Mapa del mercado
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Principales empresas según capitalización y comportamiento diario.
            </p>
          </div>

          <div className="mt-5 grid auto-rows-[100px] grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            {market.stocks.map((stock, index) => {
              const positive =
                (stock.change_percent ?? 0) >= 0;

              const large =
                index === 0 ||
                index === 1 ||
                index === 2;

              return (
                <div
                  key={stock.ticker}
                  title={`${stock.company}
${stock.price ?? 'Sin precio'}
${stock.change_percent ?? 'Sin variación'}%`}
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
                      {stock.ticker}
                    </p>

                    <p className="mt-1 truncate text-xs text-white/70">
                      {stock.company}
                    </p>

                    <div className="mt-3 text-xl font-black">
                      {stock.change_percent != null
                        ? `${
                            stock.change_percent >= 0
                              ? '+'
                              : ''
                          }${stock.change_percent.toFixed(
                            2
                          )}%`
                        : 'Sin dato'}
                    </div>
                  </div>

                  <div className="absolute inset-0 bg-white/0 transition group-hover:bg-white/5" />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* GANADORES / PERDEDORES */}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-emerald-500" />

            <h2 className="text-xl font-black">
              Mayores subidas
            </h2>
          </div>

          <div className="mt-5 space-y-4">
            {market?.leaders?.slice(0, 5).map(
              (stock) => (
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
                        ? `$${stock.price.toFixed(2)}`
                        : '—'}
                    </p>

                    <p className="text-sm font-black text-emerald-600">
                      {stock.change_percent != null
                        ? `+${stock.change_percent.toFixed(
                            2
                          )}%`
                        : '—'}
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-center gap-2">
            <TrendingDown className="text-rose-500" />

            <h2 className="text-xl font-black">
              Mayores caídas
            </h2>
          </div>

          <div className="mt-5 space-y-4">
            {market?.laggards?.slice(0, 5).map(
              (stock) => (
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
                        ? `$${stock.price.toFixed(2)}`
                        : '—'}
                    </p>

                    <p className="text-sm font-black text-rose-600">
                      {stock.change_percent != null
                        ? `${stock.change_percent.toFixed(
                            2
                          )}%`
                        : '—'}
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </section>
      </div>

      {/* FOOTER INFO */}

      <div className="flex flex-col justify-between gap-2 text-xs text-slate-400 md:flex-row">
        <p>
          Fuente: {market?.source || 'Datos financieros'}
        </p>

        {updatedLabel && (
          <p>
            Última actualización: {updatedLabel}
          </p>
        )}
      </div>
    </div>
  );
}