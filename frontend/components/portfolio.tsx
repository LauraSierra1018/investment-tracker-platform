'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Loader2,
  PieChart as PieChartIcon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
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

  free_float_percent?: number | null;

  criteria?: Array<{
    key: string;
    name: string;
    status: string;
    value?: number | null;
    formatted_value?: string;
  }>;
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

export function Portfolio() {
  const [items, setItems] = useState<PortfolioItem[]>([]);

  const [watchlistStocks, setWatchlistStocks] = useState<
    StockData[]
  >([]);

  const [selectedTicker, setSelectedTicker] =
    useState('');

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

  async function loadPortfolio() {
    const result =
      await api<PortfolioItem[]>('/portfolio');

    setItems(result);
  }

  async function loadWatchlist() {
    try {
      const saved =
        await api<WatchlistItem[]>('/watchlist');

      const stocks = await Promise.all(
        saved.map(async (item) => {
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
        })
      );

      setWatchlistStocks(
        stocks.filter(
          (item): item is StockData =>
            item !== null
        )
      );
    } catch (error) {
      console.error(
        'Error cargando watchlist:',
        error
      );
    }
  }

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
      setError(
        e?.message ||
          'No fue posible cargar el portafolio.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function selectStock(
    ticker: string
  ) {
    setSelectedTicker(ticker);
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
        `${selectedStock.ticker} fue agregado al portafolio.`
      );

      setInvestmentAmount('');
      setQuantity('');
      setAverageCost('');
      setSelectedTicker('');
      setSelectedStock(null);

      await loadPortfolio();
    } catch (e: any) {
      setError(
        e?.message ||
          'No fue posible agregar la posición.'
      );
    } finally {
      setAdding(false);
    }
  }

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
      marketValue -
      invested;

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

          <h1 className="mt-1 text-3xl font-black">
            Mi portafolio
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Registra tus inversiones,
            revisa su evolución y explora
            oportunidades de tu watchlist.
          </p>
        </div>

        <button
          onClick={() =>
            loadAll(true)
          }
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold shadow-sm transition hover:bg-slate-50"
        >
          <RefreshCw
            size={17}
            className={
              refreshing
                ? 'animate-spin'
                : ''
            }
          />

          Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {success}
        </div>
      )}

      {/* MAIN SUMMARY */}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_0.8fr]">

        <section className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
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
            </div>

            <div className="rounded-xl bg-indigo-50 p-3">
              <Wallet className="text-indigo-600" />
            </div>
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
              value={`${
                totals.pnl >= 0
                  ? '+'
                  : ''
              }$${totals.pnl.toLocaleString(
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

          <div className="mt-7 border-t pt-6">
            <h3 className="font-black">
              Distribución
            </h3>

            {allocation.length > 0 ? (
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

                      <Tooltip
                        formatter={(
                          value: number
                        ) =>
                          `$${Number(
                            value
                          ).toLocaleString(
                            'en-US',
                            {
                              maximumFractionDigits: 2,
                            }
                          )}`
                        }
                      />
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
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Agrega una posición para
                comenzar a visualizar tu
                distribución.
              </p>
            )}
          </div>
        </section>

        {/* ASSETS */}

        <section className="card p-6">
          <h2 className="text-xl font-black">
            Mis activos
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Posiciones actuales
          </p>

          <div className="mt-5 space-y-4">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">
                Todavía no tienes
                posiciones registradas.
              </p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-black text-white">
                      {item.ticker.slice(
                        0,
                        4
                      )}
                    </div>

                    <div>
                      <p className="font-black">
                        {item.ticker}
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
              ))
            )}
          </div>
        </section>
      </div>

      {/* ADD POSITION */}

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
              Busca el activo y registra el
              monto de forma sencilla.
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

              <div className="text-left sm:text-right">
                <p className="text-xs font-bold uppercase text-slate-400">
                  Precio actual
                </p>

                <p className="text-xl font-black">
                  {selectedStock.price !=
                  null
                    ? `${
                        selectedStock.currency ||
                        '$'
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
              ¿Cuánto quieres registrar
              como invertido?
            </label>

            <div className="mt-2 flex items-center rounded-xl border bg-white px-4">
              <span className="font-bold text-slate-400">
                $
              </span>

              <input
                type="number"
                min="0"
                step="0.01"
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
                  Equivale aproximadamente
                  a{' '}
                  <strong>
                    {(
                      Number(
                        investmentAmount
                      ) /
                      selectedStock.price
                    ).toFixed(4)}
                  </strong>{' '}
                  acciones al precio actual.
                </p>
              )}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-black">
                Cantidad de acciones
              </label>

              <input
                type="number"
                value={quantity}
                onChange={(e) =>
                  setQuantity(
                    e.target.value
                  )
                }
                className="mt-2 h-12 w-full rounded-xl border px-4 outline-none"
                placeholder="10"
              />
            </div>

            <div>
              <label className="text-sm font-black">
                Costo promedio
              </label>

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
                className="mt-2 h-12 w-full rounded-xl border px-4 outline-none"
                placeholder="180.50"
              />
            </div>
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
              <ChevronDown
                size={16}
              />
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
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 font-black text-white transition hover:bg-slate-800 disabled:opacity-50 sm:w-auto sm:px-8"
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

        {!advanced && (
          <p className="mt-3 max-w-2xl text-xs leading-5 text-slate-400">
            En modo simple se registra la
            posición usando el precio actual
            como costo inicial. Para una
            inversión que compraste
            anteriormente, usa Opciones
            avanzadas e ingresa tu cantidad y
            costo promedio reales.
          </p>
        )}
      </section>

      {/* RISK RECOMMENDATIONS */}

      <section className="card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50">
              <Sparkles className="text-violet-600" />
            </div>

            <div>
              <h2 className="text-xl font-black">
                Opciones para investigar
              </h2>

              <p className="mt-1 max-w-xl text-sm text-slate-500">
                El ranking utiliza únicamente
                activos que ya guardaste en tu
                watchlist y adapta los pesos
                según el nivel de riesgo
                seleccionado.
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
              Guarda primero algunas
              empresas o ETFs para comparar
              cuáles se ajustan mejor a cada
              perfil.
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
                  profile={
                    riskProfile
                  }
                />
              )
            )}
          </div>
        )}

        <div className="mt-5 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
          Estas coincidencias son una herramienta
          de investigación basada en métricas
          cuantitativas disponibles. Un porcentaje
          alto significa mayor compatibilidad con
          los criterios del perfil seleccionado,
          no una garantía de rendimiento ni una
          instrucción de compra.
        </div>
      </section>
    </div>
  );
}


/* ==========================================================
   SUMMARY
========================================================== */

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-lg font-black">
        {value}
      </p>
    </div>
  );
}


/* ==========================================================
   RISK BUTTON
========================================================== */

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
      className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
        active
          ? 'bg-white text-slate-950 shadow-sm'
          : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}


/* ==========================================================
   RECOMMENDATION CARD
========================================================== */

function RecommendationCard({
  recommendation,
  profile,
}: {
  recommendation: Recommendation;
  profile: RiskProfile;
}) {
  const {
    stock,
    match,
    positives,
    cautions,
  } = recommendation;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xl font-black">
            {stock.ticker}
          </p>

          <p className="mt-1 line-clamp-1 text-sm text-slate-500">
            {stock.company}
          </p>
        </div>

        <div
          className={`rounded-xl px-3 py-2 text-center ${
            match >= 80
              ? 'bg-emerald-50 text-emerald-700'
              : match >= 65
              ? 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          <p className="text-xl font-black">
            {match}%
          </p>

          <p className="text-[9px] font-bold uppercase">
            coincidencia
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <SmallMetric
          label="Score"
          value={
            stock.score != null
              ? `${stock.score.toFixed(
                  0
                )}/100`
              : '—'
          }
        />

        <SmallMetric
          label="Beta"
          value={
            stock.beta != null
              ? stock.beta.toFixed(2)
              : '—'
          }
        />

        <SmallMetric
          label="P/E"
          value={
            stock.pe_ratio != null
              ? `${stock.pe_ratio.toFixed(
                  1
                )}x`
              : '—'
          }
        />

        <SmallMetric
          label="Perfil"
          value={
            profile ===
            'conservative'
              ? 'Conservador'
              : profile ===
                'moderate'
              ? 'Moderado'
              : 'Agresivo'
          }
        />
      </div>

      {positives.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-600">
            A favor
          </p>

          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {positives
              .slice(0, 3)
              .map((text) => (
                <li
                  key={text}
                  className="flex gap-2"
                >
                  <span className="text-emerald-500">
                    +
                  </span>
                  {text}
                </li>
              ))}
          </ul>
        </div>
      )}

      {cautions.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-amber-600">
            Revisar
          </p>

          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {cautions
              .slice(0, 2)
              .map((text) => (
                <li
                  key={text}
                  className="flex gap-2"
                >
                  <span className="text-amber-500">
                    −
                  </span>
                  {text}
                </li>
              ))}
          </ul>
        </div>
      )}
    </article>
  );
}


function SmallMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 font-black">
        {value}
      </p>
    </div>
  );
}


/* ==========================================================
   RECOMMENDATION ENGINE
========================================================== */

function calculateMatch(
  stock: StockData,
  profile: RiskProfile
): Recommendation {
  let points = 0;
  let possible = 0;

  const positives: string[] = [];
  const cautions: string[] = [];

  const add = (
    earned: number,
    max: number
  ) => {
    points += earned;
    possible += max;
  };

  const score =
    stock.score ?? null;

  const beta =
    stock.beta ?? null;

  const marketCap =
    stock.market_cap ?? null;

  const pe =
    stock.pe_ratio ?? null;

  const revenueGrowth =
    normalizePercent(
      stock.revenue_growth
    );

  const earningsGrowth =
    normalizePercent(
      stock.earnings_growth
    );

  const upside =
    stock.upside_percent ??
    calculateUpside(stock);

  /* GENERAL QUALITY */

  if (score != null) {
    possible += 25;

    add(
      Math.min(
        25,
        score * 0.25
      ),
      0
    );

    if (score >= 75) {
      positives.push(
        'Buen puntaje fundamental global.'
      );
    } else if (score < 55) {
      cautions.push(
        'El puntaje fundamental requiere revisión.'
      );
    }
  }

  /* CONSERVATIVE */

  if (
    profile === 'conservative'
  ) {
    if (beta != null) {
      possible += 25;

      if (beta <= 0.8) {
        points += 25;
        positives.push(
          'Beta relativamente baja.'
        );
      } else if (
        beta <= 1.1
      ) {
        points += 18;
      } else {
        points += 6;
        cautions.push(
          'Volatilidad superior a la preferida para un perfil conservador.'
        );
      }
    }

    if (marketCap != null) {
      possible += 20;

      if (
        marketCap >= 100e9
      ) {
        points += 20;
        positives.push(
          'Capitalización bursátil muy alta.'
        );
      } else if (
        marketCap >= 20e9
      ) {
        points += 14;
      } else {
        points += 5;
      }
    }

    if (pe != null) {
      possible += 15;

      if (
        pe > 0 &&
        pe <= 25
      ) {
        points += 15;
        positives.push(
          'Valoración P/E relativamente contenida.'
        );
      } else if (
        pe <= 35
      ) {
        points += 9;
      } else {
        points += 3;
        cautions.push(
          'Múltiplo P/E elevado.'
        );
      }
    }

    if (upside != null) {
      possible += 15;

      if (upside >= 10) {
        points += 15;
      } else if (
        upside >= 0
      ) {
        points += 10;
      } else {
        points += 2;
      }
    }
  }

  /* MODERATE */

  if (
    profile === 'moderate'
  ) {
    if (beta != null) {
      possible += 20;

      if (
        beta >= 0.7 &&
        beta <= 1.3
      ) {
        points += 20;
        positives.push(
          'Nivel de volatilidad compatible con un perfil moderado.'
        );
      } else if (
        beta <= 1.6
      ) {
        points += 13;
      } else {
        points += 6;
        cautions.push(
          'Volatilidad relativamente elevada.'
        );
      }
    }

    if (marketCap != null) {
      possible += 15;

      if (
        marketCap >= 20e9
      ) {
        points += 15;
        positives.push(
          'Capitalización bursátil sólida.'
        );
      } else if (
        marketCap >= 5e9
      ) {
        points += 10;
      } else {
        points += 5;
      }
    }

    if (
      revenueGrowth != null
    ) {
      possible += 15;

      if (
        revenueGrowth >= 10
      ) {
        points += 15;
        positives.push(
          'Crecimiento de ingresos atractivo.'
        );
      } else if (
        revenueGrowth >= 0
      ) {
        points += 9;
      } else {
        points += 2;
      }
    }

    if (upside != null) {
      possible += 25;

      if (upside >= 15) {
        points += 25;
        positives.push(
          'Potencial frente al precio objetivo atractivo.'
        );
      } else if (
        upside >= 5
      ) {
        points += 17;
      } else if (
        upside >= 0
      ) {
        points += 10;
      } else {
        points += 2;
        cautions.push(
          'El precio objetivo no muestra potencial positivo actualmente.'
        );
      }
    }
  }

  /* AGGRESSIVE */

  if (
    profile === 'aggressive'
  ) {
    if (beta != null) {
      possible += 15;

      if (
        beta >= 1.1 &&
        beta <= 2
      ) {
        points += 15;
        positives.push(
          'Mayor sensibilidad al mercado compatible con un perfil agresivo.'
        );
      } else if (
        beta > 2
      ) {
        points += 10;
        cautions.push(
          'Volatilidad especialmente elevada.'
        );
      } else {
        points += 8;
      }
    }

    if (
      revenueGrowth != null
    ) {
      possible += 25;

      if (
        revenueGrowth >= 20
      ) {
        points += 25;
        positives.push(
          'Crecimiento de ingresos elevado.'
        );
      } else if (
        revenueGrowth >= 10
      ) {
        points += 18;
      } else if (
        revenueGrowth >= 0
      ) {
        points += 10;
      } else {
        points += 2;
      }
    }

    if (
      earningsGrowth != null
    ) {
      possible += 20;

      if (
        earningsGrowth >= 20
      ) {
        points += 20;
        positives.push(
          'Crecimiento de ganancias elevado.'
        );
      } else if (
        earningsGrowth >= 5
      ) {
        points += 13;
      } else {
        points += 5;
      }
    }

    if (upside != null) {
      possible += 15;

      if (upside >= 20) {
        points += 15;
        positives.push(
          'Potencial estimado elevado.'
        );
      } else if (
        upside >= 10
      ) {
        points += 11;
      } else {
        points += 5;
      }
    }
  }

  const match =
    possible > 0
      ? Math.round(
          (points / possible) *
            100
        )
      : Math.round(
          stock.score ?? 50
        );

  return {
    stock,
    match: Math.max(
      0,
      Math.min(100, match)
    ),
    positives,
    cautions,
  };
}


/* ==========================================================
   HELPERS
========================================================== */

function calculateUpside(
  stock: StockData
): number | null {
  if (
    stock.price == null ||
    stock.price <= 0 ||
    stock.target_price == null
  ) {
    return null;
  }

  return (
    ((stock.target_price -
      stock.price) /
      stock.price) *
    100
  );
}


function normalizePercent(
  value?: number | null
): number | null {
  if (value == null) {
    return null;
  }

  /*
    Yahoo suele entregar crecimientos
    como decimal:
    0.15 = 15 %
  */

  if (
    Math.abs(value) <= 2
  ) {
    return value * 100;
  }

  return value;
}