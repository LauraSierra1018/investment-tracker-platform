'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Check,
  ChevronRight,
  Info,
  Loader2,
  LockKeyhole,
  LogIn,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import { StockSearch } from '@/components/stock-search';
import { ResearchCompare } from '@/components/research-compare';
import type { Stock } from '@/types';

type ResearchTab = 'overview' | 'fundamentals' | 'valuation' | 'risk' | 'compare' | 'ai';
type ChartRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y';

type Criterion = {
  key: string;
  category: string;
  name: string;
  status: 'cumple' | 'revisar' | 'no_cumple' | 'sin_dato' | string;
  formatted_value: string;
  explanation: string;
  rule: string;
  value?: number | null;
};

type HistoryPoint = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

type HistoryResponse = {
  ticker: string;
  range: ChartRange;
  interval: string;
  currency?: string | null;
  first_close: number | null;
  last_close: number | null;
  change_percent: number | null;
  points: HistoryPoint[];
  source: string;
};

type AiResult = {
  available?: boolean;
  summary?: string;
  thesis?: string[];
  risks?: string[];
  questions?: string[];
};

const badge: Record<string, string> = {
  cumple: 'bg-emerald-100 text-emerald-800',
  revisar: 'bg-amber-100 text-amber-800',
  no_cumple: 'bg-rose-100 text-rose-800',
  sin_dato: 'bg-slate-100 text-slate-600',
};

const chartRanges: ChartRange[] = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y'];

const tabs: { id: ResearchTab; label: string }[] = [
  { id: 'overview', label: 'Resumen' },
  { id: 'fundamentals', label: 'Fundamentales' },
  { id: 'valuation', label: 'Valoración' },
  { id: 'risk', label: 'Riesgo' },
  { id: 'compare', label: 'Comparar' },
  { id: 'ai', label: 'IA' },
];

export function Research() {
  const router = useRouter();

  const [stock, setStock] = useState<Stock | null>(null);
  const [activeTab, setActiveTab] = useState<ResearchTab>('overview');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loginRequired, setLoginRequired] = useState(false);

  const [historyRange, setHistoryRange] = useState<ChartRange>('1M');
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const [ai, setAi] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  async function runTicker(ticker: string) {
    const cleanTicker = ticker.trim().toUpperCase();
    if (!cleanTicker) return;

    setLoading(true);
    setError('');
    setSaved(false);
    setLoginRequired(false);
    setAi(null);
    setAiError('');
    setActiveTab('overview');
    setHistoryRange('1M');

    try {
      const result = await api<Stock>(
        `/stocks/${encodeURIComponent(cleanTicker)}`
      );
      setStock(result);
    } catch (e: any) {
      console.error('Error buscando activo:', e);
      setError(
        e?.message || 'No fue posible obtener la información de este activo.'
      );
      setStock(null);
      setHistory(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(ticker: string, range: ChartRange) {
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const result = await api<HistoryResponse>(
        `/stocks/${encodeURIComponent(ticker)}/history?range=${encodeURIComponent(range)}`
      );
      setHistory(result);
    } catch (e: any) {
      console.error('Error cargando histórico:', e);
      setHistory(null);
      setHistoryError(e?.message || 'No fue posible cargar el gráfico histórico.');
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!stock?.ticker) return;
    loadHistory(stock.ticker, historyRange);
  }, [stock?.ticker, historyRange]);

  async function addToWatchlist() {
    if (!stock || saving || saved) return;

    setError('');
    setLoginRequired(false);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoginRequired(true);
        return;
      }

      setSaving(true);

      await api('/watchlist', {
        method: 'POST',
        body: JSON.stringify({ ticker: stock.ticker }),
      });

      setSaved(true);
    } catch (e: any) {
      console.error('Error guardando en watchlist:', e);
      setError(e?.message || 'No fue posible guardar el activo.');
    } finally {
      setSaving(false);
    }
  }

  async function analyze() {
    if (!stock) return;

    setAiLoading(true);
    setAiError('');
    setAi(null);

    try {
      const result = await api<AiResult>('/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ ticker: stock.ticker }),
      });
      setAi(result);
    } catch (e: any) {
      console.error('Error en análisis IA:', e);
      setAiError(
        e?.message || 'No fue posible generar el análisis con inteligencia artificial.'
      );
    } finally {
      setAiLoading(false);
    }
  }

  const criteria = useMemo(
    () => ((stock?.criteria ?? []) as Criterion[]),
    [stock]
  );

  const scoreSummary = useMemo(() => {
    const available = criteria.filter((item) => item.status !== 'sin_dato');
    return {
      passed: available.filter((item) => item.status === 'cumple').length,
      review: available.filter((item) => item.status === 'revisar').length,
      failed: available.filter((item) => item.status === 'no_cumple').length,
      missing: criteria.filter((item) => item.status === 'sin_dato').length,
      available: available.length,
    };
  }, [criteria]);

  return (
    <div className="space-y-5">
      <section className="card p-6">
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-400">
            Research
          </p>
          <h1 className="mt-1 text-3xl font-black">Investiga acciones y ETFs</h1>
          <p className="mt-2 text-slate-500">
            Busca por nombre o ticker y revisa precio, fundamentales, valoración,
            riesgo y análisis con IA desde una sola vista.
          </p>
        </div>

        <div className="mt-6">
          <StockSearch onSelect={runTicker} />
        </div>

        {loading && (
          <div className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-500">
            <Loader2 size={17} className="animate-spin" />
            Cargando información del activo...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}
      </section>

      {stock && (
        <>
          <AssetHeader
            stock={stock}
            saved={saved}
            saving={saving}
            onSave={addToWatchlist}
          />

          {loginRequired && (
            <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white">
                    <LockKeyhole size={19} className="text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-black">Inicia sesión para guardar {stock.ticker}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Research es público. La watchlist y el portafolio se guardan en tu cuenta.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/login')}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white"
                >
                  <LogIn size={16} />
                  Iniciar sesión
                </button>
              </div>
            </section>
          )}

          <nav className="card flex gap-1 overflow-x-auto p-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  activeTab === tab.id
                    ? 'bg-slate-950 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === 'overview' && (
            <OverviewTab
              stock={stock}
              criteria={criteria}
              scoreSummary={scoreSummary}
              history={history}
              historyRange={historyRange}
              historyLoading={historyLoading}
              historyError={historyError}
              onRangeChange={setHistoryRange}
              onRetryHistory={() => loadHistory(stock.ticker, historyRange)}
            />
          )}

          {activeTab === 'fundamentals' && (
            <CriteriaTab
              title="Fundamentales"
              description="Rentabilidad, crecimiento, eficiencia, liquidez y salud financiera."
              criteria={criteria}
            />
          )}

          {activeTab === 'valuation' && (
            <CriteriaTab
              title="Valoración"
              description="Múltiplos, precio objetivo y métricas relacionadas con cuánto estás pagando por el negocio."
              criteria={filterValuationCriteria(criteria)}
              emptyMessage="Todavía no hay métricas de valoración suficientes para este activo."
            />
          )}

          {activeTab === 'risk' && (
            <CriteriaTab
              title="Riesgo"
              description="Volatilidad, endeudamiento, liquidez, free float y otros factores que pueden aumentar la incertidumbre."
              criteria={filterRiskCriteria(criteria)}
              emptyMessage="Todavía no hay métricas de riesgo suficientes para este activo."
            />
          )}

          {activeTab === 'compare' && (
            <ResearchCompare baseStock={stock} />
          )}

          {activeTab === 'ai' && (
            <AiTab
              ai={ai}
              loading={aiLoading}
              error={aiError}
              onAnalyze={analyze}
            />
          )}

          <SourceFooter stock={stock} history={history} />
        </>
      )}
    </div>
  );
}

function AssetHeader({
  stock,
  saved,
  saving,
  onSave,
}: {
  stock: Stock;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const s = stock as any;
  const dailyChange =
    s.change_percent ?? s.daily_change_percent ?? s.regular_market_change_percent ?? null;

  return (
    <section className="card p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">
            {stock.ticker.slice(0, 4)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-3xl font-black">{stock.company}</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500">
                {stock.ticker}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {stock.exchange || 'Mercado'} · {stock.sector || 'Sector sin dato'} ·{' '}
              {stock.industry || 'Industria sin dato'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:text-right">
            <p className="text-3xl font-black">
              {stock.price != null
                ? `${stock.currency || ''} ${stock.price.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : 'Sin precio'}
            </p>
            {dailyChange != null && (
              <p
                className={`mt-1 text-sm font-black ${
                  dailyChange >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {dailyChange >= 0 ? '+' : ''}
                {Number(dailyChange).toFixed(2)}% hoy
              </p>
            )}
          </div>

          <button
            onClick={onSave}
            disabled={saving || saved}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition ${
              saved
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
            }`}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Guardando...
              </>
            ) : saved ? (
              <>
                <Check size={16} /> Guardado
              </>
            ) : (
              <>
                <Star size={16} /> Watchlist
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}

function OverviewTab({
  stock,
  criteria,
  scoreSummary,
  history,
  historyRange,
  historyLoading,
  historyError,
  onRangeChange,
  onRetryHistory,
}: {
  stock: Stock;
  criteria: Criterion[];
  scoreSummary: {
    passed: number;
    review: number;
    failed: number;
    missing: number;
    available: number;
  };
  history: HistoryResponse | null;
  historyRange: ChartRange;
  historyLoading: boolean;
  historyError: string;
  onRangeChange: (range: ChartRange) => void;
  onRetryHistory: () => void;
}) {
  const grouped = groupCriteria(criteria);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1.6fr_0.7fr]">
        <PriceChartCard
          stock={stock}
          history={history}
          range={historyRange}
          loading={historyLoading}
          error={historyError}
          onRangeChange={onRangeChange}
          onRetry={onRetryHistory}
        />

        <ScoreCard stock={stock} summary={scoreSummary} />
      </div>

      <KeyMetrics stock={stock} criteria={criteria} />

      <div className="grid gap-4 lg:grid-cols-2">
        {grouped.slice(0, 4).map(([category, items]) => (
          <CategoryPreview key={category} category={category} criteria={items} />
        ))}
      </div>
    </div>
  );
}

function PriceChartCard({
  stock,
  history,
  range,
  loading,
  error,
  onRangeChange,
  onRetry,
}: {
  stock: Stock;
  history: HistoryResponse | null;
  range: ChartRange;
  loading: boolean;
  error: string;
  onRangeChange: (range: ChartRange) => void;
  onRetry: () => void;
}) {
  const chartData = useMemo(
    () =>
      (history?.points ?? []).map((point) => ({
        ...point,
        label: formatChartDate(point.date, range),
      })),
    [history, range]
  );

  const positive = (history?.change_percent ?? 0) >= 0;

  return (
    <section className="card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-500">Precio</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <h3 className="text-2xl font-black">{stock.ticker}</h3>
            {history?.change_percent != null && (
              <span
                className={`text-sm font-black ${
                  positive ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {positive ? '+' : ''}
                {history.change_percent.toFixed(2)}% · {range}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {chartRanges.map((item) => (
            <button
              key={item}
              onClick={() => onRangeChange(item)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-black transition ${
                item === range
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 h-[330px]">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 size={18} className="animate-spin" /> Cargando gráfico...
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <ShieldAlert className="text-amber-500" />
            <p className="mt-3 max-w-md text-sm text-slate-500">{error}</p>
            <button
              onClick={onRetry}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold"
            >
              <RefreshCw size={15} /> Reintentar
            </button>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Sin datos históricos.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                minTickGap={35}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={62}
                tickFormatter={(value) => Number(value).toFixed(0)}
              />
              <Tooltip
                formatter={(value: number | string) => [
                  Number(value).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                  'Precio',
                ]}
                labelFormatter={(label) => String(label)}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="#4f46e5"
                strokeWidth={2.5}
                fill="url(#priceFill)"
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function ScoreCard({
  stock,
  summary,
}: {
  stock: Stock;
  summary: {
    passed: number;
    review: number;
    failed: number;
    missing: number;
    available: number;
  };
}) {
  const score = Number(stock.score ?? 0);
  const scoreStyle =
    score >= 75
      ? 'text-emerald-600 bg-emerald-50'
      : score >= 55
      ? 'text-amber-600 bg-amber-50'
      : 'text-rose-600 bg-rose-50';

  return (
    <section className="card p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-500">Investment score</p>
          <h3 className="mt-1 text-xl font-black">{stock.classification || 'Evaluación'}</h3>
        </div>
        <Sparkles size={20} className="text-indigo-500" />
      </div>

      <div className={`mt-6 rounded-2xl p-5 text-center ${scoreStyle}`}>
        <div className="text-5xl font-black">{score.toFixed(0)}</div>
        <div className="mt-1 text-xs font-black uppercase tracking-[0.2em]">de 100</div>
      </div>

      <div className="mt-5 space-y-3 text-sm">
        <ScoreRow label="Cumple" value={summary.passed} tone="good" />
        <ScoreRow label="Revisar" value={summary.review} tone="review" />
        <ScoreRow label="No cumple" value={summary.failed} tone="bad" />
        <ScoreRow label="Sin dato" value={summary.missing} tone="muted" />
      </div>

      <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
        El score resume los criterios con datos disponibles. Los indicadores sin dato no deben interpretarse como una señal negativa.
      </div>
    </section>
  );
}

function ScoreRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'good' | 'review' | 'bad' | 'muted';
}) {
  const dot = {
    good: 'bg-emerald-500',
    review: 'bg-amber-500',
    bad: 'bg-rose-500',
    muted: 'bg-slate-300',
  }[tone];

  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-600">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} /> {label}
      </span>
      <span className="font-black">{value}</span>
    </div>
  );
}

function KeyMetrics({ stock, criteria }: { stock: Stock; criteria: Criterion[] }) {
  const s = stock as any;
  const metrics = [
    {
      label: 'Market Cap',
      value: stock.market_cap ? formatLarge(stock.market_cap) : '—',
    },
    {
      label: 'P/E',
      value: stock.pe_ratio != null ? `${Number(stock.pe_ratio).toFixed(1)}x` : '—',
    },
    {
      label: 'Precio objetivo',
      value:
        s.target_price != null
          ? `${stock.currency || ''} ${Number(s.target_price).toFixed(2)}`
          : criterionValue(criteria, ['target', 'precio objetivo']),
    },
    {
      label: 'Free float',
      value:
        stock.free_float_percent != null
          ? `${Number(stock.free_float_percent).toFixed(1)}%`
          : '—',
    },
    {
      label: 'Beta',
      value: s.beta != null ? Number(s.beta).toFixed(2) : criterionValue(criteria, ['beta']),
    },
    {
      label: 'Revenue growth',
      value:
        s.revenue_growth != null
          ? formatPercentish(s.revenue_growth)
          : criterionValue(criteria, ['revenue growth', 'crecimiento ingresos']),
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {metrics.map((metric) => (
        <article key={metric.label} className="card p-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-400">
            {metric.label}
          </p>
          <p className="mt-2 text-lg font-black">{metric.value}</p>
        </article>
      ))}
    </section>
  );
}

function CategoryPreview({
  category,
  criteria,
}: {
  category: string;
  criteria: Criterion[];
}) {
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            Categoría
          </p>
          <h3 className="mt-1 text-lg font-black">{category}</h3>
        </div>
        <ChevronRight size={18} className="text-slate-300" />
      </div>

      <div className="mt-4 divide-y">
        {criteria.slice(0, 4).map((criterion) => (
          <div key={criterion.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{criterion.name}</p>
              <p className="mt-0.5 text-xs text-slate-400">{criterion.rule}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-black">{criterion.formatted_value}</p>
              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${statusBadge(criterion.status)}`}>
                {statusLabel(criterion.status)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CriteriaTab({
  title,
  description,
  criteria,
  emptyMessage = 'No hay criterios disponibles para esta sección.',
}: {
  title: string;
  description: string;
  criteria: Criterion[];
  emptyMessage?: string;
}) {
  const groups = groupCriteria(criteria);

  return (
    <div className="space-y-5">
      <section className="card p-6">
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
      </section>

      {criteria.length === 0 ? (
        <section className="card p-10 text-center text-sm text-slate-500">
          {emptyMessage}
        </section>
      ) : (
        groups.map(([category, items]) => (
          <section key={category} className="card overflow-hidden">
            <div className="border-b bg-slate-50 px-6 py-4">
              <h3 className="font-black">{category}</h3>
            </div>
            <div className="grid gap-0 divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              {items.map((criterion) => (
                <CriterionCard key={criterion.key} criterion={criterion} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function CriterionCard({ criterion }: { criterion: Criterion }) {
  return (
    <article className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-black">{criterion.name}</h4>
          <p className="mt-1 text-2xl font-black">{criterion.formatted_value}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusBadge(criterion.status)}`}>
          {statusLabel(criterion.status)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{criterion.explanation}</p>
      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Regla</p>
        <p className="mt-1 text-sm font-medium text-slate-700">{criterion.rule}</p>
      </div>
    </article>
  );
}

function AiTab({
  ai,
  loading,
  error,
  onAnalyze,
}: {
  ai: AiResult | null;
  loading: boolean;
  error: string;
  onAnalyze: () => void;
}) {
  return (
    <section className="card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50">
            <Brain className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-2xl font-black">Análisis con IA</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Resume los datos cuantitativos disponibles, separa fortalezas de riesgos y propone preguntas para profundizar.
            </p>
          </div>
        </div>

        <button
          onClick={onAnalyze}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-black text-white disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {loading ? 'Analizando...' : ai ? 'Actualizar análisis' : 'Generar análisis'}
        </button>
      </div>

      {error && (
        <div className="mt-5 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {!ai && !loading && !error && (
        <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">
          <Brain className="mx-auto text-slate-300" />
          <h3 className="mt-3 font-black">Genera una lectura narrativa</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            La IA no reemplaza los datos ni decide el score; interpreta la información que ya calculó el backend.
          </p>
        </div>
      )}

      {ai && (
        <div className="mt-6 space-y-5">
          {ai.available === false && (
            <div className="rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-800">
              El módulo de IA no está disponible actualmente.
            </div>
          )}

          {ai.summary && (
            <div className="rounded-2xl bg-slate-50 p-5">
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Resumen</p>
              <p className="mt-2 leading-7 text-slate-700">{ai.summary}</p>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <AiList title="Fortalezas" items={ai.thesis ?? []} positive />
            <AiList title="Riesgos" items={ai.risks ?? []} positive={false} />
          </div>

          {(ai.questions?.length ?? 0) > 0 && (
            <div className="rounded-2xl border p-5">
              <h3 className="font-black">Qué deberías investigar</h3>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                {ai.questions!.map((item, index) => (
                  <li key={`${item}-${index}`} className="flex gap-2">
                    <span className="font-black text-indigo-500">{index + 1}.</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AiList({
  title,
  items,
  positive,
}: {
  title: string;
  items: string[];
  positive: boolean;
}) {
  return (
    <div className={`rounded-2xl p-5 ${positive ? 'bg-emerald-50' : 'bg-rose-50'}`}>
      <h3 className={`font-black ${positive ? 'text-emerald-900' : 'text-rose-900'}`}>
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2">
              <span className={positive ? 'text-emerald-600' : 'text-rose-600'}>
                {positive ? '+' : '−'}
              </span>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Sin elementos adicionales.</p>
      )}
    </div>
  );
}

function SourceFooter({ stock, history }: { stock: Stock; history: HistoryResponse | null }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-center gap-1.5">
        <Info size={13} /> Datos del activo: {stock.source || 'Proveedor financiero'}
      </span>
      {history?.source && <span>Histórico: {history.source}</span>}
    </section>
  );
}

function groupCriteria(criteria: Criterion[]) {
  const groups = new Map<string, Criterion[]>();

  criteria.forEach((criterion) => {
    const category = criterion.category || 'Otros';
    const existing = groups.get(category) ?? [];
    existing.push(criterion);
    groups.set(category, existing);
  });

  return Array.from(groups.entries());
}

function filterValuationCriteria(criteria: Criterion[]) {
  const words = [
    'p/e',
    'pe ',
    'price',
    'precio',
    'target',
    'objetivo',
    'peg',
    'p/s',
    'p/b',
    'ev/',
    'ebitda',
    'valoración',
    'valuation',
    'upside',
    'potencial',
    'market cap',
    'capitalización',
  ];

  return criteria.filter((item) => {
    const haystack = `${item.key} ${item.name} ${item.category}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
}

function filterRiskCriteria(criteria: Criterion[]) {
  const words = [
    'beta',
    'riesgo',
    'risk',
    'volatil',
    'debt',
    'deuda',
    'liquidez',
    'current ratio',
    'free float',
    'float',
    'drawdown',
    'short',
  ];

  return criteria.filter((item) => {
    const haystack = `${item.key} ${item.name} ${item.category}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
}

function criterionValue(criteria: Criterion[], needles: string[]) {
  const found = criteria.find((item) => {
    const haystack = `${item.key} ${item.name}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });

  return found?.formatted_value || '—';
}

function statusBadge(status: string) {
  return badge[status] || badge.sin_dato;
}

function statusLabel(status: string) {
  return {
    cumple: 'Cumple',
    revisar: 'Revisar',
    no_cumple: 'No cumple',
    sin_dato: 'Sin dato',
  }[status] || status.replaceAll('_', ' ');
}

function formatLarge(value: number) {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)} M`;
  return `$${value.toLocaleString('en-US')}`;
}

function formatPercentish(value: number) {
  const normalized = Math.abs(value) <= 2 ? value * 100 : value;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(1)}%`;
}

function formatChartDate(value: string, range: ChartRange) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  if (range === '1D' || range === '5D') {
    return new Intl.DateTimeFormat('es-CO', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  if (range === '5Y') {
    return new Intl.DateTimeFormat('es-CO', {
      month: 'short',
      year: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat('es-CO', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
