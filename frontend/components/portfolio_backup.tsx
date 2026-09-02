'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Edit3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react';

import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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

type Analysis = {
  summary: {
    market_value: number;
    invested: number;
    pnl: number;
    pnl_percent: number;
    positions: number;
    sectors: number;
  };
  health: {
    diversification_score: number;
    concentration_score: number;
    quality_score: number;
    growth_score: number;
    risk_label: string;
    largest_position_percent: number;
    top3_concentration_percent: number;
  };
  allocation_by_asset: {
    ticker: string;
    value: number;
    percent: number;
  }[];
  allocation_by_sector: {
    sector: string;
    value: number;
    percent: number;
  }[];
  alerts: {
    type: 'positive' | 'warning';
    text: string;
  }[];
  recommendations: {
    ticker: string;
    company: string;
    match: number;
    score?: number | null;
    beta?: number | null;
    sector?: string | null;
    reasons: string[];
    cautions: string[];
  }[];
};

type HistoryPoint = {
  date: string;
  value: number;
};

type StockData = {
  ticker: string;
  company: string;
  price?: number | null;
  currency?: string | null;
};

type RiskProfile = 'conservative' | 'moderate' | 'aggressive';
type Goal = 'preserve' | 'balanced' | 'growth' | 'aggressive' | 'income' | 'custom';

type AssistantResponse = {
  summary: string;
  observations: string[];
  actions_to_explore: {
    title: string;
    rationale: string;
    ticker?: string | null;
  }[];
  allocation_example?: {
    ticker: string;
    percent: number;
    rationale: string;
  }[];
  risks: string[];
  disclaimer?: string;
};

const COLORS = [
  '#4f46e5',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#0ea5e9',
  '#84cc16',
];

const RANGES = ['1M', '3M', '6M', '1Y'] as const;

export function Portfolio() {
  return (
    <RequireAuth>
      <PortfolioContent />
    </RequireAuth>
  );
}

function PortfolioContent() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number]>('3M');

  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [averageCost, setAverageCost] = useState('');

  const [editing, setEditing] = useState<PortfolioItem | null>(null);
  const [editQuantity, setEditQuantity] = useState('');
  const [editAverageCost, setEditAverageCost] = useState('');

  const [riskProfile, setRiskProfile] = useState<RiskProfile>('moderate');
  const [goal, setGoal] = useState<Goal>('balanced');
  const [horizon, setHorizon] = useState('5+');
  const [priorities, setPriorities] = useState<string[]>([
    'growth',
    'quality',
    'diversification',
  ]);
  const [assistantPrompt, setAssistantPrompt] = useState(
    'Quiero mejorar mi portafolio manteniendo un equilibrio entre crecimiento y riesgo.'
  );
  const [assistant, setAssistant] = useState<AssistantResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadPortfolio() {
    const result = await api<PortfolioItem[]>('/portfolio');
    setItems(result);
  }

  async function loadAnalysis(profile = riskProfile) {
    const result = await api<Analysis>(
      `/portfolio/analysis?profile=${encodeURIComponent(profile)}`
    );
    setAnalysis(result);
  }

  async function loadHistory(nextRange = range) {
    setHistoryLoading(true);
    try {
      const result = await api<{ points: HistoryPoint[] }>(
        `/portfolio/history?range=${encodeURIComponent(nextRange)}`
      );
      setHistory(result.points || []);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadAll(showRefreshing = false) {
    try {
      if (showRefreshing) setRefreshing(true);
      setError('');

      await Promise.all([
        loadPortfolio(),
        loadAnalysis(),
        loadHistory(),
      ]);
    } catch (e: any) {
      setError(e?.message || 'No fue posible cargar tu portafolio.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadAnalysis(riskProfile);
    }
  }, [riskProfile]);

  async function selectStock(ticker: string) {
    setStockLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await api<StockData>(
        `/stocks/${encodeURIComponent(ticker)}`
      );
      setSelectedStock(result);
    } catch (e: any) {
      setSelectedStock(null);
      setError(e?.message || 'No fue posible cargar este activo.');
    } finally {
      setStockLoading(false);
    }
  }

  async function addPosition() {
    if (!selectedStock) {
      setError('Primero selecciona una acción o ETF.');
      return;
    }

    let finalQuantity = 0;
    let finalAverageCost = 0;

    if (advanced) {
      finalQuantity = Number(quantity);
      finalAverageCost = Number(averageCost);
    } else {
      const amount = Number(investmentAmount);
      const price = selectedStock.price ?? 0;

      if (amount <= 0 || price <= 0) {
        setError('Ingresa un monto válido.');
        return;
      }

      finalQuantity = amount / price;
      finalAverageCost = price;
    }

    if (finalQuantity <= 0 || finalAverageCost < 0) {
      setError('Los datos de la posición no son válidos.');
      return;
    }

    setAdding(true);
    setError('');
    setSuccess('');

    try {
      await api('/portfolio', {
        method: 'POST',
        body: JSON.stringify({
          ticker: selectedStock.ticker,
          quantity: finalQuantity,
          average_cost: finalAverageCost,
          currency: selectedStock.currency || 'USD',
        }),
      });

      setSuccess(`${selectedStock.ticker} fue agregado a tu portafolio.`);
      setSelectedStock(null);
      setInvestmentAmount('');
      setQuantity('');
      setAverageCost('');

      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No fue posible agregar la posición.');
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: PortfolioItem) {
    setEditing(item);
    setEditQuantity(String(item.quantity));
    setEditAverageCost(String(item.average_cost));
  }

  async function saveEdit() {
    if (!editing) return;

    const q = Number(editQuantity);
    const cost = Number(editAverageCost);

    if (q <= 0 || cost < 0) {
      setError('Ingresa valores válidos.');
      return;
    }

    try {
      await api(`/portfolio/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          quantity: q,
          average_cost: cost,
        }),
      });

      setSuccess(`${editing.ticker} fue actualizado.`);
      setEditing(null);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No fue posible actualizar la posición.');
    }
  }

  async function removePosition(item: PortfolioItem) {
    if (!window.confirm(`¿Eliminar ${item.ticker} del portafolio?`)) return;

    try {
      await api(`/portfolio/${item.id}`, { method: 'DELETE' });
      setSuccess(`${item.ticker} fue eliminado.`);
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'No fue posible eliminar la posición.');
    }
  }

  async function runAssistant() {
    setAssistantLoading(true);
    setAssistant(null);
    setError('');

    try {
      const result = await api<AssistantResponse>('/portfolio/assistant', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          risk_profile: riskProfile,
          horizon,
          priorities,
          prompt: assistantPrompt,
        }),
      });

      setAssistant(result);
    } catch (e: any) {
      setError(e?.message || 'No fue posible ejecutar el asistente IA.');
    } finally {
      setAssistantLoading(false);
    }
  }

  function togglePriority(value: string) {
    setPriorities((current) =>
      current.includes(value)
        ? current.filter((x) => x !== value)
        : [...current, value]
    );
  }

  const summary = analysis?.summary;
  const pnlPositive = (summary?.pnl ?? 0) >= 0;

  if (loading) {
    return (
      <div className="flex min-h-[450px] items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400">
            Inversiones
          </p>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-3xl font-black">Mi portafolio</h1>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-black uppercase text-indigo-600">
              Privado
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Rendimiento, riesgo, diversificación y oportunidades desde tu watchlist.
          </p>
        </div>

        <button
          onClick={() => loadAll(true)}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 font-bold shadow-sm"
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

      {success && (
        <div className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Summary
          label="Valor actual"
          value={money(summary?.market_value ?? 0)}
        />
        <Summary
          label="Invertido"
          value={money(summary?.invested ?? 0)}
        />
        <Summary
          label="P/L"
          value={`${pnlPositive ? '+' : ''}${money(summary?.pnl ?? 0)}`}
          subtitle={`${pnlPositive ? '+' : ''}${(summary?.pnl_percent ?? 0).toFixed(2)}%`}
        />
        <Summary
          label="Posiciones"
          value={String(summary?.positions ?? items.length)}
        />
        <Summary
          label="Riesgo"
          value={analysis?.health.risk_label ?? 'Sin dato'}
          subtitle={`Diversificación ${analysis?.health.diversification_score ?? 0}/100`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_0.85fr]">
        <section className="card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Evolución estimada</h2>
              <p className="mt-1 text-sm text-slate-500">
                Reconstrucción usando tus cantidades actuales.
              </p>
            </div>

            <div className="flex rounded-xl bg-slate-100 p-1">
              {RANGES.map((item) => (
                <button
                  key={item}
                  onClick={async () => {
                    setRange(item);
                    await loadHistory(item);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                    range === item ? 'bg-white shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 h-[320px]">
            {historyLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" />
              </div>
            ) : history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history.map((x) => ({
                    ...x,
                    label: chartDate(x.date),
                  }))}
                >
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    minTickGap={35}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => compactMoney(Number(value))}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                  />
                  <Tooltip
                    formatter={(value: number) => money(Number(value))}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No hay suficiente histórico todavía.
              </div>
            )}
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-400">
            Es una estimación basada en las cantidades que posees actualmente; no reemplaza un historial de transacciones.
          </p>
        </section>

        <section className="card p-6">
          <h2 className="text-xl font-black">Distribución</h2>
          <p className="mt-1 text-sm text-slate-500">Por activo</p>

          {(analysis?.allocation_by_asset?.length ?? 0) > 0 ? (
            <>
              <div className="mt-3 h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analysis?.allocation_by_asset}
                      dataKey="value"
                      nameKey="ticker"
                      innerRadius={65}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {analysis?.allocation_by_asset.map((x, index) => (
                        <Cell
                          key={x.ticker}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => money(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-3">
                {analysis?.allocation_by_asset.map((x, index) => (
                  <div
                    key={x.ticker}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{
                          backgroundColor: COLORS[index % COLORS.length],
                        }}
                      />
                      <span className="font-bold">{x.ticker}</span>
                    </div>
                    <span className="text-sm text-slate-500">
                      {x.percent.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-slate-500">
              Agrega posiciones para ver la distribución.
            </p>
          )}
        </section>
      </div>

      <section className="card p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-3">
            <ShieldCheck className="text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-black">Salud del portafolio</h2>
            <p className="mt-1 text-sm text-slate-500">
              Diversificación, concentración, calidad y crecimiento.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Health label="Diversificación" value={analysis?.health.diversification_score ?? 0} />
          <Health label="Concentración" value={analysis?.health.concentration_score ?? 0} />
          <Health label="Calidad" value={analysis?.health.quality_score ?? 0} />
          <Health label="Crecimiento" value={analysis?.health.growth_score ?? 0} />
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {(analysis?.alerts ?? []).map((alert, index) => (
            <div
              key={`${alert.text}-${index}`}
              className={`flex gap-3 rounded-xl p-4 ${
                alert.type === 'warning'
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-emerald-50 text-emerald-900'
              }`}
            >
              {alert.type === 'warning' ? (
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              ) : (
                <ShieldCheck size={18} className="mt-0.5 shrink-0" />
              )}
              <p className="text-sm leading-6">{alert.text}</p>
            </div>
          ))}
        </div>

        {(analysis?.allocation_by_sector?.length ?? 0) > 0 && (
          <div className="mt-6 border-t pt-5">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">
              Exposición por sector
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {analysis?.allocation_by_sector.map((x) => (
                <span
                  key={x.sector}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                >
                  {x.sector} · {x.percent.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-50 p-3">
            <Target className="text-violet-600" />
          </div>
          <div>
            <h2 className="text-xl font-black">¿Qué quieres lograr?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Personaliza el análisis según tu objetivo.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {[
            ['preserve', 'Preservar capital'],
            ['balanced', 'Balance'],
            ['growth', 'Crecimiento'],
            ['aggressive', 'Crecimiento agresivo'],
            ['income', 'Ingresos'],
            ['custom', 'Personalizado'],
          ].map(([id, label]) => (
            <Choice
              key={id}
              active={goal === id}
              onClick={() => setGoal(id as Goal)}
            >
              {label}
            </Choice>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-black">Tolerancia al riesgo</p>
            <div className="mt-2 flex rounded-xl bg-slate-100 p-1">
              <RiskChoice
                active={riskProfile === 'conservative'}
                onClick={() => setRiskProfile('conservative')}
              >
                Baja
              </RiskChoice>
              <RiskChoice
                active={riskProfile === 'moderate'}
                onClick={() => setRiskProfile('moderate')}
              >
                Media
              </RiskChoice>
              <RiskChoice
                active={riskProfile === 'aggressive'}
                onClick={() => setRiskProfile('aggressive')}
              >
                Alta
              </RiskChoice>
            </div>
          </div>

          <div>
            <p className="text-sm font-black">Horizonte</p>
            <select
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border bg-white px-4"
            >
              <option value="<1">Menos de 1 año</option>
              <option value="1-3">1–3 años</option>
              <option value="3-5">3–5 años</option>
              <option value="5+">5+ años</option>
            </select>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-black">Prioridades</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ['growth', 'Crecimiento'],
              ['quality', 'Calidad financiera'],
              ['low_volatility', 'Menor volatilidad'],
              ['valuation', 'Valoración'],
              ['income', 'Dividendos'],
              ['etf', 'ETFs'],
              ['diversification', 'Diversificación'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => togglePriority(id)}
                className={`rounded-xl border px-3 py-2 text-xs font-black ${
                  priorities.includes(id)
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                {priorities.includes(id) ? '✓ ' : ''}
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-3">
            <Brain className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-xl font-black">AI Portfolio Assistant</h2>
            <p className="mt-1 text-sm text-slate-500">
              Usa tu portafolio, perfil y watchlist para explicar ajustes y opciones a investigar.
            </p>
          </div>
        </div>

        <textarea
          value={assistantPrompt}
          onChange={(e) => setAssistantPrompt(e.target.value)}
          rows={4}
          className="mt-6 w-full resize-none rounded-2xl border bg-slate-50 p-4 text-sm leading-6"
        />

        <button
          onClick={runAssistant}
          disabled={assistantLoading}
          className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {assistantLoading ? (
            <>
              <Loader2 size={17} className="animate-spin" />
              Analizando...
            </>
          ) : (
            <>
              <Sparkles size={17} />
              Analizar mi portafolio
            </>
          )}
        </button>

        {assistant && (
          <div className="mt-6 space-y-5">
            <div className="rounded-2xl bg-slate-50 p-5">
              <p className="text-xs font-black uppercase text-slate-400">
                Resumen
              </p>
              <p className="mt-2 leading-7 text-slate-700">
                {assistant.summary}
              </p>
            </div>

            {assistant.observations?.length > 0 && (
              <div>
                <h3 className="font-black">Observaciones</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">
                  {assistant.observations.map((x, i) => (
                    <li key={`${x}-${i}`}>• {x}</li>
                  ))}
                </ul>
              </div>
            )}

            {assistant.actions_to_explore?.length > 0 && (
              <div>
                <h3 className="font-black">Opciones para explorar</h3>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {assistant.actions_to_explore.map((x, i) => (
                    <div
                      key={`${x.title}-${i}`}
                      className="rounded-xl border p-4"
                    >
                      <div className="flex justify-between gap-3">
                        <h4 className="font-black">{x.title}</h4>
                        {x.ticker && (
                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-black">
                            {x.ticker}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {x.rationale}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {assistant.allocation_example &&
              assistant.allocation_example.length > 0 && (
                <div>
                  <h3 className="font-black">
                    Ejemplo de asignación para explorar
                  </h3>
                  <div className="mt-3 overflow-hidden rounded-xl border">
                    {assistant.allocation_example.map((x) => (
                      <div
                        key={x.ticker}
                        className="flex justify-between gap-4 border-b px-4 py-3 last:border-b-0"
                      >
                        <div>
                          <p className="font-black">{x.ticker}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {x.rationale}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-lg bg-indigo-50 px-3 py-1 font-black text-indigo-700">
                          {x.percent}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {assistant.risks?.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-4 text-amber-900">
                <p className="font-black">Riesgos a revisar</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {assistant.risks.map((x, i) => (
                    <li key={`${x}-${i}`}>• {x}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs leading-5 text-slate-400">
              {assistant.disclaimer ||
                'Herramienta educativa; no constituye asesoría financiera personalizada.'}
            </p>
          </div>
        )}
      </section>

      <section className="card p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-50 p-3">
            <Sparkles className="text-violet-600" />
          </div>
          <div>
            <h2 className="text-xl font-black">Opciones desde tu watchlist</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ranking cuantitativo adaptado a tu perfil.
            </p>
          </div>
        </div>

        {(analysis?.recommendations?.length ?? 0) === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
            Guarda activos en tu watchlist para ver candidatos.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            {analysis?.recommendations.slice(0, 6).map((x) => (
              <article key={x.ticker} className="rounded-2xl border p-5">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="text-xl font-black">{x.ticker}</p>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">
                      {x.company}
                    </p>
                  </div>
                  <span className="rounded-xl bg-emerald-50 px-3 py-2 font-black text-emerald-700">
                    {x.match}%
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  {x.sector && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-bold">
                      {x.sector}
                    </span>
                  )}
                  {x.score != null && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-bold">
                      Score {x.score.toFixed(0)}
                    </span>
                  )}
                  {x.beta != null && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-bold">
                      Beta {x.beta.toFixed(2)}
                    </span>
                  )}
                </div>

                <ul className="mt-4 space-y-1 text-sm text-slate-600">
                  {x.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>
                      <span className="text-emerald-500">+ </span>
                      {reason}
                    </li>
                  ))}
                </ul>

                {x.cautions?.[0] && (
                  <p className="mt-3 text-xs text-amber-700">
                    Revisar: {x.cautions[0]}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b p-6">
          <h2 className="text-xl font-black">Mis posiciones</h2>
          <p className="mt-1 text-sm text-slate-500">
            Edita cantidades, costo promedio o elimina posiciones.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Tu portafolio está vacío.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-400">
                <tr>
                  <th className="p-4 text-left">Activo</th>
                  <th className="p-4 text-right">Cantidad</th>
                  <th className="p-4 text-right">Costo medio</th>
                  <th className="p-4 text-right">Precio</th>
                  <th className="p-4 text-right">Valor</th>
                  <th className="p-4 text-right">Peso</th>
                  <th className="p-4 text-right">P/L</th>
                  <th className="p-4 text-center">Acciones</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {items.map((item) => {
                  const weight =
                    analysis?.allocation_by_asset.find(
                      (x) => x.ticker === item.ticker
                    )?.percent ?? 0;

                  return (
                    <tr key={item.id}>
                      <td className="p-4 font-black">{item.ticker}</td>
                      <td className="p-4 text-right">
                        {item.quantity.toFixed(4)}
                      </td>
                      <td className="p-4 text-right">
                        {money(item.average_cost)}
                      </td>
                      <td className="p-4 text-right">
                        {item.current_price != null
                          ? money(item.current_price)
                          : '—'}
                      </td>
                      <td className="p-4 text-right font-black">
                        {item.market_value != null
                          ? money(item.market_value)
                          : '—'}
                      </td>
                      <td className="p-4 text-right">{weight.toFixed(1)}%</td>
                      <td
                        className={`p-4 text-right font-black ${
                          (item.unrealized_pnl ?? 0) >= 0
                            ? 'text-emerald-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {item.unrealized_pnl != null
                          ? `${item.unrealized_pnl >= 0 ? '+' : ''}${money(
                              item.unrealized_pnl
                            )}`
                          : '—'}
                      </td>
                      <td className="p-4">
                        <div className="flex justify-center gap-1">
                          <button
                            onClick={() => startEdit(item)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                          >
                            <Edit3 size={16} />
                          </button>
                          <button
                            onClick={() => removePosition(item)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-black">Editar {editing.ticker}</h2>

            <label className="mt-5 block text-sm font-black">Cantidad</label>
            <input
              type="number"
              value={editQuantity}
              onChange={(e) => setEditQuantity(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border px-4"
            />

            <label className="mt-4 block text-sm font-black">
              Costo promedio
            </label>
            <input
              type="number"
              value={editAverageCost}
              onChange={(e) => setEditAverageCost(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border px-4"
            />

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-xl border px-4 py-2 font-bold"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                className="rounded-xl bg-slate-950 px-4 py-2 font-bold text-white"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-3">
            <CircleDollarSign className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-xl font-black">Agregar inversión</h2>
            <p className="mt-1 text-sm text-slate-500">
              Busca el activo y escribe cuánto tienes invertido.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <StockSearch onSelect={selectStock} />
        </div>

        {stockLoading && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Consultando...
          </div>
        )}

        {selectedStock && (
          <div className="mt-5 flex justify-between gap-4 rounded-2xl bg-slate-50 p-5">
            <div>
              <p className="font-black">{selectedStock.ticker}</p>
              <p className="text-sm text-slate-500">{selectedStock.company}</p>
            </div>
            <p className="text-xl font-black">
              {selectedStock.price != null
                ? `${selectedStock.currency || 'USD'} ${selectedStock.price.toFixed(
                    2
                  )}`
                : 'Sin precio'}
            </p>
          </div>
        )}

        {!advanced ? (
          <div className="mt-5">
            <label className="text-sm font-black">
              ¿Cuánto tienes invertido?
            </label>
            <div className="mt-2 flex items-center rounded-xl border px-4">
              <span className="font-bold text-slate-400">$</span>
              <input
                type="number"
                value={investmentAmount}
                onChange={(e) => setInvestmentAmount(e.target.value)}
                className="h-12 flex-1 px-3 outline-none"
                placeholder="500"
              />
            </div>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-12 rounded-xl border px-4"
              placeholder="Cantidad"
            />
            <input
              type="number"
              value={averageCost}
              onChange={(e) => setAverageCost(e.target.value)}
              className="h-12 rounded-xl border px-4"
              placeholder="Costo promedio"
            />
          </div>
        )}

        <button
          onClick={() => setAdvanced(!advanced)}
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
          disabled={adding || !selectedStock}
          className="mt-6 flex h-12 items-center gap-2 rounded-xl bg-slate-950 px-8 font-black text-white disabled:opacity-50"
        >
          {adding ? (
            <>
              <Loader2 size={17} className="animate-spin" />
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
    </div>
  );
}

function Summary({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
      {subtitle && <p className="mt-1 text-xs font-bold text-slate-500">{subtitle}</p>}
    </div>
  );
}

function Health({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex justify-between">
        <p className="font-black">{label}</p>
        <p className="font-black">{Math.round(safe)}/100</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-slate-950"
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}

function Choice({
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
      className={`rounded-xl border px-4 py-2 text-sm font-black ${
        active
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 bg-white text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function RiskChoice({
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
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-black ${
        active ? 'bg-white shadow-sm' : 'text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function money(value: number) {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function chartDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('es-CO', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
