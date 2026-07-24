'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { api } from '@/lib/api';
import { StockSearch } from '@/components/stock-search';
import { RequireAuth } from '@/components/require-auth';

type PortfolioItem = {
  id: number;
  ticker: string;
  quantity: number;
  average_cost: number;
  currency?: string | null;

  current_price?: number | null;
  market_value?: number | null;

  unrealized_pnl?: number | null;
  unrealized_pnl_percent?: number | null;
};

type StockData = {
  ticker: string;
  company: string;

  price?: number | null;
  currency?: string | null;

  sector?: string | null;
  industry?: string | null;

  score?: number | null;
  classification?: string | null;

  market_cap?: number | null;
  pe_ratio?: number | null;

  beta?: number | null;
  revenue_growth?: number | null;
  earnings_growth?: number | null;

  target_price?: number | null;
  upside_percent?: number | null;
};

type WatchlistItem = {
  ticker: string;
};

type RiskProfile =
  | 'conservative'
  | 'moderate'
  | 'aggressive';

type Recommendation = {
  stock: StockData;
  match: number;
  positives: string[];
  cautions: string[];
};

const PIE_COLORS = [
  '#4f46e5',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#0ea5e9',
  '#84cc16',
];

/*
 * =========================================================
 * PORTFOLIO
 *
 * El contenido real solo se monta cuando RequireAuth
 * confirma que existe un usuario.
 * =========================================================
 */

export function Portfolio() {
  return (
    <RequireAuth>
      <PortfolioContent />
    </RequireAuth>
  );
}

/*
 * =========================================================
 * PRIVATE PORTFOLIO CONTENT
 * =========================================================
 */

function PortfolioContent() {
  const [items, setItems] =
    useState<PortfolioItem[]>([]);

  const [watchlistStocks, setWatchlistStocks] =
    useState<StockData[]>([]);

  const [selectedStock, setSelectedStock] =
    useState<StockData | null>(null);

  const [investmentAmount, setInvestmentAmount] =
    useState('');

  const [advanced, setAdvanced] =
    useState(false);

  const [quantity, setQuantity] =
    useState('');

  const [averageCost, setAverageCost] =
    useState('');

  const [riskProfile, setRiskProfile] =
    useState<RiskProfile>('moderate');

  const [loading, setLoading] =
    useState(true);

  const [adding, setAdding] =
    useState(false);

  const [refreshing, setRefreshing] =
    useState(false);

  const [stockLoading, setStockLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  /*
   * =======================================================
   * PORTFOLIO DATA
   * =======================================================
   */

  async function loadPortfolio() {
    const result =
      await api<PortfolioItem[]>(
        '/portfolio'
      );

    setItems(result);
  }

  /*
   * =======================================================
   * WATCHLIST
   *
   * Se utiliza para las opciones según perfil de riesgo.
   * =======================================================
   */

  async function loadWatchlist() {
    try {
      const saved =
        await api<WatchlistItem[]>(
          '/watchlist'
        );

      const stocks =
        await Promise.all(
          saved.map(
            async (item) => {
              try {
                return await api<StockData>(
                  `/stocks/${encodeURIComponent(
                    item.ticker
                  )}`
                );
              } catch (error) {
                console.error(
                  `No se pudo cargar ${item.ticker}`,
                  error
                );

                return null;
              }
            }
          )
        );

      setWatchlistStocks(
        stocks.filter(
          (
            item
          ): item is StockData =>
            item !== null
        )
      );
    } catch (error) {
      console.error(
        'Error cargando watchlist:',
        error
      );

      setWatchlistStocks([]);
    }
  }

  /*
   * =======================================================
   * INITIAL LOAD
   *
   * Este componente solo existe después de RequireAuth,
   * por lo que ya sabemos que hay usuario.
   * =======================================================
   */

  async function loadAll(
    showRefreshing = false
  ) {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      }

      setError('');

      await Promise.all([
        loadPortfolio(),
        loadWatchlist(),
      ]);
    } catch (e: any) {
      console.error(
        'Error cargando portafolio:',
        e
      );

      setError(
        e?.message ||
          'No fue posible cargar tu portafolio.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  /*
   * =======================================================
   * SELECT ASSET
   * =======================================================
   */

  async function selectStock(
    ticker: string
  ) {
    setStockLoading(true);
    setError('');
    setSuccess('');

    try {
      const stock =
        await api<StockData>(
          `/stocks/${encodeURIComponent(
            ticker
          )}`
        );

      setSelectedStock(stock);
    } catch (e: any) {
      setSelectedStock(null);

      setError(
        e?.message ||
          'No fue posible cargar este activo.'
      );
    } finally {
      setStockLoading(false);
    }
  }

  /*
   * =======================================================
   * ADD POSITION
   * =======================================================
   */

  async function addPosition() {
    if (!selectedStock) {
      setError(
        'Primero selecciona una acción o ETF.'
      );

      return;
    }

    let finalQuantity = 0;
    let finalAverageCost = 0;

    if (advanced) {
      finalQuantity =
        Number(quantity);

      finalAverageCost =
        Number(averageCost);

      if (
        finalQuantity <= 0 ||
        finalAverageCost <= 0
      ) {
        setError(
          'Ingresa una cantidad y costo promedio válidos.'
        );

        return;
      }
    } else {
      const amount =
        Number(investmentAmount);

      const price =
        selectedStock.price;

      if (
        amount <= 0 ||
        !price ||
        price <= 0
      ) {
        setError(
          'Ingresa un monto válido y asegúrate de que el activo tenga precio disponible.'
        );

        return;
      }

      finalQuantity =
        amount / price;

      finalAverageCost =
        price;
    }

    setAdding(true);
    setError('');
    setSuccess('');

    try {
      await api('/portfolio', {
        method: 'POST',

        body: JSON.stringify({
          ticker:
            selectedStock.ticker,

          quantity:
            finalQuantity,

          average_cost:
            finalAverageCost,

          currency:
            selectedStock.currency ||
            'USD',
        }),
      });

      setSuccess(
        `${selectedStock.ticker} fue agregado a tu portafolio.`
      );

      setInvestmentAmount('');
      setQuantity('');
      setAverageCost('');
      setSelectedStock(null);

      await loadPortfolio();
    } catch (e: any) {
      console.error(
        'Error agregando posición:',
        e
      );

      setError(
        e?.message ||
          'No fue posible agregar la posición.'
      );
    } finally {
      setAdding(false);
    }
  }

  /*
   * =======================================================
   * TOTALS
   * =======================================================
   */

  const totals = useMemo(() => {
    const marketValue =
      items.reduce(
        (sum, item) =>
          sum +
          (item.market_value ?? 0),
        0
      );

    const invested =
      items.reduce(
        (sum, item) =>
          sum +
          item.quantity *
            item.average_cost,
        0
      );

    const pnl =
      marketValue - invested;

    const pnlPercent =
      invested > 0
        ? (pnl / invested) * 100
        : 0;

    return {
      marketValue,
      invested,
      pnl,
      pnlPercent,
    };
  }, [items]);

  /*
   * =======================================================
   * ALLOCATION
   * =======================================================
   */

  const allocation = useMemo(() => {
    const total =
      items.reduce(
        (sum, item) =>
          sum +
          (item.market_value ?? 0),
        0
      );

    if (!total) {
      return [];
    }

    return items
      .filter(
        (item) =>
          (item.market_value ?? 0) > 0
      )
      .map((item) => ({
        name: item.ticker,

        value:
          item.market_value ?? 0,

        percent:
          ((item.market_value ?? 0) /
            total) *
          100,
      }));
  }, [items]);

  /*
   * =======================================================
   * RISK RECOMMENDATIONS
   * =======================================================
   */

  const recommendations =
    useMemo(() => {
      return watchlistStocks
        .map((stock) =>
          calculateMatch(
            stock,
            riskProfile
          )
        )
        .sort(
          (a, b) =>
            b.match - a.match
        )
        .slice(0, 3);
    }, [
      watchlistStocks,
      riskProfile,
    ]);

  /*
   * =======================================================
   * LOADING
   * =======================================================
   */

  if (loading) {
    return (
      <div className="flex min-h-[450px] items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* HEADER */}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Inversiones
          </p>

          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-3xl font-black">
              Mi portafolio
            </h1>

            <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase text-indigo-600">
              Privado
            </span>
          </div>

          <p className="mt-2 text-sm text-slate-500">
            Tu portafolio personal está
            asociado a tu cuenta.
          </p>
        </div>

        <button
          onClick={() =>
            loadAll(true)
          }
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
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

      {/* ERROR */}

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {/* SUCCESS */}

      {success && (
        <div className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {success}
        </div>
      )}

      {/* ================================================
          EMPTY PORTFOLIO
      ================================================= */}

      {items.length === 0 ? (
        <section className="card p-10">
          <div className="mx-auto max-w-lg text-center">

            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
              <Wallet className="text-indigo-600" />
            </div>

            <h2 className="mt-5 text-2xl font-black">
              Tu portafolio está vacío
            </h2>

            <p className="mt-2 leading-6 text-slate-500">
              Registra tu primera inversión
              para comenzar a seguir el valor,
              distribución y rendimiento de
              tu portafolio.
            </p>

          </div>
        </section>
      ) : (
        /* ================================================
           PORTFOLIO SUMMARY
        ================================================= */

        <div className="grid gap-5 xl:grid-cols-[1.6fr_0.8fr]">

          <section className="card p-6">

            <p className="text-sm font-medium text-slate-500">
              Valor actual
            </p>

            <h2 className="mt-1 text-4xl font-black">
              $
              {totals.marketValue.toLocaleString(
                'en-US',
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}
            </h2>

            <div
              className={`mt-2 flex items-center gap-1 text-sm font-black ${
                totals.pnl >= 0
                  ? 'text-emerald-600'
                  : 'text-rose-600'
              }`}
            >
              {totals.pnl >= 0 ? (
                <ArrowUpRight
                  size={17}
                />
              ) : (
                <ArrowDownRight
                  size={17}
                />
              )}

              {totals.pnl >= 0
                ? '+'
                : ''}

              $
              {totals.pnl.toLocaleString(
                'en-US',
                {
                  maximumFractionDigits: 2,
                }
              )}

              {' · '}

              {totals.pnlPercent >= 0
                ? '+'
                : ''}

              {totals.pnlPercent.toFixed(
                2
              )}
              %
            </div>

            <div className="mt-7 grid gap-4 sm:grid-cols-3">

              <SummaryMetric
                label="Capital invertido"
                value={`$${totals.invested.toLocaleString(
                  'en-US',
                  {
                    maximumFractionDigits: 2,
                  }
                )}`}
              />

              <SummaryMetric
                label="Ganancia / pérdida"
                value={`${totals.pnl >= 0 ? '+' : ''}$${totals.pnl.toLocaleString(
                  'en-US',
                  {
                    maximumFractionDigits: 2,
                  }
                )}`}
              />

              <SummaryMetric
                label="Posiciones"
                value={String(
                  items.length
                )}
              />

            </div>

            {/* DISTRIBUTION */}

            {allocation.length > 0 && (
              <div className="mt-7 border-t pt-6">

                <h3 className="font-black">
                  Distribución
                </h3>

                <div className="mt-4 grid items-center gap-5 md:grid-cols-[240px_1fr]">

                  <div className="h-[220px]">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                    >
                      <PieChart>

                        <Pie
                          data={allocation}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={65}
                          outerRadius={95}
                          paddingAngle={2}
                        >
                          {allocation.map(
                            (
                              entry,
                              index
                            ) => (
                              <Cell
                                key={
                                  entry.name
                                }
                                fill={
                                  PIE_COLORS[
                                    index %
                                      PIE_COLORS.length
                                  ]
                                }
                              />
                            )
                          )}
                        </Pie>

                        <Tooltip />

                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-3">

                    {allocation.map(
                      (
                        item,
                        index
                      ) => (
                        <div
                          key={
                            item.name
                          }
                          className="flex items-center justify-between"
                        >

                          <div className="flex items-center gap-2">

                            <span
                              className="h-3 w-3 rounded-full"
                              style={{
                                backgroundColor:
                                  PIE_COLORS[
                                    index %
                                      PIE_COLORS.length
                                  ],
                              }}
                            />

                            <span className="font-bold">
                              {
                                item.name
                              }
                            </span>

                          </div>

                          <span className="text-sm text-slate-500">
                            {item.percent.toFixed(
                              1
                            )}
                            %
                          </span>

                        </div>
                      )
                    )}

                  </div>

                </div>

              </div>
            )}

          </section>

          {/* ASSETS */}

          <section className="card p-6">

            <h2 className="text-xl font-black">
              Mis activos
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Posiciones de tu cuenta
            </p>

            <div className="mt-5 space-y-4">

              {items.map(
                (item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-4"
                  >

                    <div className="flex items-center gap-3">

                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                        {item.ticker.slice(
                          0,
                          4
                        )}
                      </div>

                      <div>
                        <p className="font-black">
                          {
                            item.ticker
                          }
                        </p>

                        <p className="text-xs text-slate-400">
                          {item.quantity.toFixed(
                            4
                          )}{' '}
                          acciones
                        </p>
                      </div>

                    </div>

                    <div className="text-right">

                      <p className="font-black">
                        $
                        {(
                          item.market_value ??
                          0
                        ).toLocaleString(
                          'en-US',
                          {
                            maximumFractionDigits: 2,
                          }
                        )}
                      </p>

                      {item.unrealized_pnl_percent !=
                        null && (
                        <p
                          className={`text-xs font-bold ${
                            item.unrealized_pnl_percent >=
                            0
                              ? 'text-emerald-600'
                              : 'text-rose-600'
                          }`}
                        >
                          {item.unrealized_pnl_percent >=
                          0
                            ? '+'
                            : ''}

                          {item.unrealized_pnl_percent.toFixed(
                            2
                          )}
                          %
                        </p>
                      )}

                    </div>

                  </div>
                )
              )}

            </div>

          </section>

        </div>
      )}

      {/* ================================================
          ADD INVESTMENT
      ================================================= */}

      <section className="card p-6">

        <div className="flex items-center gap-3">

          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
            <CircleDollarSign className="text-indigo-600" />
          </div>

          <div>
            <h2 className="text-xl font-black">
              Agregar inversión
            </h2>

            <p className="text-sm text-slate-500">
              Busca una acción o ETF y
              registra tu inversión.
            </p>
          </div>

        </div>

        <div className="mt-6">

          <StockSearch
            onSelect={
              selectStock
            }
          />

        </div>

        {stockLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">

            <Loader2
              size={16}
              className="animate-spin"
            />

            Consultando precio...

          </div>
        )}

        {selectedStock && (
          <div className="mt-5 rounded-2xl bg-slate-50 p-5">

            <div className="flex items-center justify-between">

              <div>
                <p className="text-lg font-black">
                  {
                    selectedStock.ticker
                  }
                </p>

                <p className="text-sm text-slate-500">
                  {
                    selectedStock.company
                  }
                </p>
              </div>

              <div className="text-right">

                <p className="text-xs font-bold uppercase text-slate-400">
                  Precio actual
                </p>

                <p className="text-xl font-black">
                  {selectedStock.price !=
                  null
                    ? `${
                        selectedStock.currency ||
                        'USD'
                      } ${selectedStock.price.toFixed(
                        2
                      )}`
                    : 'Sin dato'}
                </p>

              </div>

            </div>

          </div>
        )}

        {!advanced ? (
          <div className="mt-5">

            <label className="text-sm font-black">
              ¿Cuánto tienes invertido?
            </label>

            <div className="mt-2 flex items-center rounded-xl border bg-white px-4">

              <span className="font-bold text-slate-400">
                $
              </span>

              <input
                type="number"
                value={
                  investmentAmount
                }
                onChange={(e) =>
                  setInvestmentAmount(
                    e.target.value
                  )
                }
                placeholder="500"
                className="h-12 flex-1 px-3 outline-none"
              />

            </div>

            {selectedStock?.price &&
              Number(
                investmentAmount
              ) > 0 && (
                <p className="mt-2 text-sm text-slate-500">

                  Aproximadamente{' '}

                  <strong>
                    {(
                      Number(
                        investmentAmount
                      ) /
                      selectedStock.price
                    ).toFixed(4)}
                  </strong>{' '}

                  acciones.

                </p>
              )}

          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">

            <input
              type="number"
              value={quantity}
              onChange={(e) =>
                setQuantity(
                  e.target.value
                )
              }
              placeholder="Cantidad de acciones"
              className="h-12 rounded-xl border px-4"
            />

            <input
              type="number"
              value={
                averageCost
              }
              onChange={(e) =>
                setAverageCost(
                  e.target.value
                )
              }
              placeholder="Costo promedio"
              className="h-12 rounded-xl border px-4"
            />

          </div>
        )}

        <button
          onClick={() =>
            setAdvanced(
              !advanced
            )
          }
          className="mt-4 flex items-center gap-1 text-sm font-bold text-indigo-600"
        >
          {advanced ? (
            <>
              <ChevronUp size={16} />
              Usar modo simple
            </>
          ) : (
            <>
              <ChevronDown size={16} />
              Opciones avanzadas
            </>
          )}
        </button>

        <button
          onClick={addPosition}
          disabled={
            adding ||
            !selectedStock
          }
          className="mt-6 flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-8 font-black text-white disabled:opacity-50"
        >
          {adding ? (
            <>
              <Loader2
                size={17}
                className="animate-spin"
              />

              Agregando...
            </>
          ) : (
            <>
              <Wallet size={17} />

              Agregar al portafolio
            </>
          )}
        </button>

      </section>

      {/* ================================================
          RECOMMENDATIONS
      ================================================= */}

      <section className="card p-6">

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">

          <div className="flex gap-3">

            <Sparkles className="text-violet-600" />

            <div>

              <h2 className="text-xl font-black">
                Opciones para investigar
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Se analizan exclusivamente
                activos guardados en tu
                watchlist.
              </p>

            </div>

          </div>

          <div className="flex rounded-xl bg-slate-100 p-1">

            <RiskButton
              active={
                riskProfile ===
                'conservative'
              }
              onClick={() =>
                setRiskProfile(
                  'conservative'
                )
              }
            >
              Conservador
            </RiskButton>

            <RiskButton
              active={
                riskProfile ===
                'moderate'
              }
              onClick={() =>
                setRiskProfile(
                  'moderate'
                )
              }
            >
              Moderado
            </RiskButton>

            <RiskButton
              active={
                riskProfile ===
                'aggressive'
              }
              onClick={() =>
                setRiskProfile(
                  'aggressive'
                )
              }
            >
              Agresivo
            </RiskButton>

          </div>

        </div>

        {watchlistStocks.length ===
        0 ? (
          <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">

            <ShieldCheck className="mx-auto text-slate-300" />

            <h3 className="mt-3 font-black">
              Tu watchlist está vacía
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Guarda empresas primero para
              recibir comparaciones según
              perfil de riesgo.
            </p>

          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-3">

            {recommendations.map(
              (recommendation) => (
                <RecommendationCard
                  key={
                    recommendation
                      .stock.ticker
                  }
                  recommendation={
                    recommendation
                  }
                />
              )
            )}

          </div>
        )}

      </section>

    </div>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-lg font-black">
        {value}
      </p>
    </div>
  );
}

function RiskButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-bold ${
        active
          ? 'bg-white text-slate-950 shadow-sm'
          : 'text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function RecommendationCard({
  recommendation,
}: {
  recommendation: Recommendation;
}) {
  return (
    <article className="rounded-2xl border p-5">

      <div className="flex justify-between">

        <div>
          <h3 className="text-xl font-black">
            {
              recommendation.stock
                .ticker
            }
          </h3>

          <p className="text-sm text-slate-500">
            {
              recommendation.stock
                .company
            }
          </p>
        </div>

        <span className="rounded-xl bg-emerald-50 px-3 py-2 font-black text-emerald-700">
          {
            recommendation.match
          }
          %
        </span>

      </div>

      {recommendation.positives.length >
        0 && (
        <ul className="mt-4 space-y-1 text-sm">

          {recommendation.positives
            .slice(0, 3)
            .map((item) => (
              <li key={item}>
                <span className="text-emerald-600">
                  +{' '}
                </span>

                {item}
              </li>
            ))}

        </ul>
      )}

    </article>
  );
}

/* =========================================================
   RISK ENGINE
========================================================= */

function calculateMatch(
  stock: StockData,
  profile: RiskProfile
): Recommendation {
  let score =
    stock.score ?? 50;

  const positives: string[] = [];
  const cautions: string[] = [];

  if (
    profile === 'conservative'
  ) {
    if (
      stock.beta != null &&
      stock.beta <= 1
    ) {
      score += 10;

      positives.push(
        'Volatilidad relativamente controlada.'
      );
    }

    if (
      stock.market_cap != null &&
      stock.market_cap >= 50e9
    ) {
      score += 10;

      positives.push(
        'Alta capitalización bursátil.'
      );
    }
  }

  if (
    profile === 'moderate'
  ) {
    if (
      stock.beta != null &&
      stock.beta <= 1.4
    ) {
      score += 8;

      positives.push(
        'Volatilidad compatible con un perfil moderado.'
      );
    }

    if (
      stock.upside_percent != null &&
      stock.upside_percent >= 10
    ) {
      score += 10;

      positives.push(
        'Potencial frente al precio objetivo.'
      );
    }
  }

  if (
    profile === 'aggressive'
  ) {
    if (
      stock.revenue_growth !=
        null &&
      stock.revenue_growth > 0.15
    ) {
      score += 12;

      positives.push(
        'Crecimiento de ingresos elevado.'
      );
    }

    if (
      stock.earnings_growth !=
        null &&
      stock.earnings_growth >
        0.15
    ) {
      score += 12;

      positives.push(
        'Crecimiento de ganancias elevado.'
      );
    }
  }

  return {
    stock,

    match: Math.min(
      100,
      Math.max(
        0,
        Math.round(score)
      )
    ),

    positives,
    cautions,
  };
}