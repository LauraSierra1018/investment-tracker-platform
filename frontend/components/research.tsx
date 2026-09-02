'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  FlaskConical,
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
  Target,
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


type ResearchOpportunity = {
  ticker: string;
  company: string;
  match: number;
  score?: number | null;
  beta?: number | null;
  sector?: string | null;
  reasons: string[];
  cautions: string[];
  components?: {
    investment_quality?: number;
    diversification_benefit?: number;
    risk_fit?: number;
    valuation?: number;
    concentration_penalty?: number;
  };
};

type OpportunitiesResponse = {
  profile: 'moderate';
  portfolio_summary?: {
    positions?: number;
    sectors?: number;
    source?: string;
  };
  opportunities: ResearchOpportunity[];
};

type ImpactResponse = ResearchOpportunity & {
  already_in_portfolio?: boolean;
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


  const [opportunities, setOpportunities] = useState<ResearchOpportunity[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false);
  const [opportunitiesAvailable, setOpportunitiesAvailable] = useState(false);
  const [portfolioSource, setPortfolioSource] = useState<string | null>(null);

  const [impact, setImpact] = useState<ImpactResponse | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);


  async function loadPortfolioOpportunities() {
    setOpportunitiesLoading(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setOpportunitiesAvailable(false);
        setOpportunities([]);
        return;
      }

      const result = await api<OpportunitiesResponse>(
        '/portfolio/opportunities?profile=moderate'
      );

      setOpportunities(result.opportunities || []);
      setPortfolioSource(result.portfolio_summary?.source ?? null);
      setOpportunitiesAvailable(true);
    } catch {
      // Research sigue siendo público aunque las oportunidades personalizadas
      // requieran una sesión autenticada.
      setOpportunitiesAvailable(false);
      setOpportunities([]);
    } finally {
      setOpportunitiesLoading(false);
    }
  }

  useEffect(() => {
    loadPortfolioOpportunities();
  }, []);

  function testInPortfolioLab(ticker: string) {
    localStorage.setItem('portfolio-lab-pending-ticker', ticker.toUpperCase());
    localStorage.setItem('portfolio-preferred-mode', 'lab');
    router.push('/portfolio');
  }

  async function loadImpact(ticker: string) {
    setImpactLoading(true);
    setImpact(null);

    try {
      const result = await api<ImpactResponse>(
        `/portfolio/impact/${encodeURIComponent(ticker)}?profile=moderate`
      );
      setImpact(result);
    } catch {
      setLoginRequired(true);
    } finally {
      setImpactLoading(false);
    }
  }

  async function runTicker(ticker: string) {
    const cleanTicker = ticker.trim().toUpperCase();
    if (!cleanTicker) return;

    setLoading(true);
    setError('');
    setSaved(false);
    setLoginRequired(false);
    setAi(null);
    setAiError('');
    setImpact(null);
    setActiveTab('overview');
    setHistoryRange('1M');

    try {
      const result = await api<Stock>(
        `/stocks/${encodeURIComponent(cleanTicker)}`
      );
      setStock(result);
      api(`/portfolio/universe/${encodeURIComponent(cleanTicker)}`, {
        method: 'POST',
      }).catch(() => {
        // Registrar el activo en Research Universe no debe bloquear la investigación.
      });
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

      <section className="card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <div className="rounded-xl bg-violet-50 p-3">
              <Target className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-xl font-black">Oportunidades para tu portafolio</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Activos de Research Universe priorizados por calidad, diversificación,
                ajuste de riesgo, valoración y concentración de tu portafolio actual.
              </p>
              {portfolioSource && (
                <p className="mt-2 text-xs font-bold text-slate-400">
                  Contexto: {portfolioSource === 'snaptrade' ? 'portafolio conectado por broker' : 'portafolio manual'}
                </p>
              )}
            </div>
          </div>

          {opportunitiesAvailable && (
            <button
              onClick={loadPortfolioOpportunities}
              disabled={opportunitiesLoading}
              className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-black"
            >
              <RefreshCw size={15} className={opportunitiesLoading ? 'animate-spin' : ''} />
              Actualizar
            </button>
          )}
        </div>

        {opportunitiesLoading ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Analizando tu portafolio...
          </div>
        ) : !opportunitiesAvailable ? (
          <div className="mt-6 rounded-2xl border border-dashed p-6">
            <p className="font-black">Inicia sesión para personalizar Research</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              La investigación individual sigue siendo pública. Al iniciar sesión podemos
              priorizar activos según tu portafolio real o simulado.
            </p>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed p-6 text-sm text-slate-500">
            Investiga más activos para ampliar Research Universe y generar candidatos.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            {opportunities.slice(0, 6).map((item) => (
              <article key={item.ticker} className="rounded-2xl border p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-black">{item.ticker}</p>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">
                      {item.company}
                    </p>
                  </div>
                  <span className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">
                    {item.match}%
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {item.sector && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-bold">
                      {item.sector}
                    </span>
                  )}
                  {item.score != null && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 font-bold">
                      Score {Number(item.score).toFixed(0)}
                    </span>
                  )}
                </div>

                <ul className="mt-4 space-y-1.5 text-sm leading-5 text-slate-600">
                  {item.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>+ {reason}</li>
                  ))}
                </ul>

                {item.cautions?.[0] && (
                  <p className="mt-3 text-xs leading-5 text-amber-700">
                    Revisar: {item.cautions[0]}
                  </p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => runTicker(item.ticker)}
                    className="rounded-xl bg-slate-950 px-3 py-2.5 text-sm font-black text-white"
                  >
                    Investigar
                  </button>
                  <button
                    onClick={() => testInPortfolioLab(item.ticker)}
                    className="rounded-xl border px-3 py-2.5 text-sm font-black"
                  >
                    Probar en Lab
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {impact && (
        <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-indigo-500">
                Impacto frente a tu portafolio
              </p>
              <div className="mt-2 flex items-center gap-3">
                <h3 className="text-xl font-black">{impact.ticker}</h3>
                <span className="rounded-lg bg-white px-3 py-1 font-black text-indigo-700">
                  Match {impact.match}%
                </span>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                {impact.reasons.slice(0, 3).map((x) => <li key={x}>+ {x}</li>)}
              </ul>
              {impact.cautions?.length > 0 && (
                <p className="mt-3 text-sm text-amber-800">
                  Revisar: {impact.cautions.join(' · ')}
                </p>
              )}
            </div>
            <button
              onClick={() => testInPortfolioLab(impact.ticker)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white"
            >
              <FlaskConical size={16} />
              Probar en Portfolio Lab
            </button>
          </div>
        </section>
      )}

      {stock && (
        <>
          <AssetHeader
            stock={stock}
            saved={saved}
            saving={saving}
            onSave={addToWatchlist}
            onLab={() => testInPortfolioLab(stock.ticker)}
            onImpact={() => loadImpact(stock.ticker)}
            impactLoading={impactLoading}
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
            <FundamentalsTab stock={stock} criteria={criteria} />
          )}

          {activeTab === 'valuation' && (
            <ValuationTab stock={stock} criteria={criteria} />
          )}

          {activeTab === 'risk' && (
            <RiskTab stock={stock} criteria={criteria} history={history} />
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
  onLab,
  onImpact,
  impactLoading,
}: {
  stock: Stock;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onLab: () => void;
  onImpact: () => void;
  impactLoading: boolean;
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

          <div className="flex flex-wrap justify-end gap-2">
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

            <button
              onClick={onImpact}
              disabled={impactLoading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-black text-indigo-700"
            >
              {impactLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Target size={16} />
              )}
              Ver impacto
            </button>

            <button
              onClick={onLab}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-black text-white"
            >
              <FlaskConical size={16} />
              Portfolio Lab
            </button>
          </div>
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


function FundamentalsTab({
  stock,
  criteria,
}: {
  stock: Stock;
  criteria: Criterion[];
}) {
  const groups = [
    {
      title: 'Crecimiento',
      description: 'Evalúa si el negocio está expandiendo ingresos y beneficios.',
      criteria: filterFundamentalCriteria(criteria, 'growth'),
    },
    {
      title: 'Rentabilidad',
      description: 'Mide la capacidad de convertir capital, activos e ingresos en beneficios.',
      criteria: filterFundamentalCriteria(criteria, 'profitability'),
    },
    {
      title: 'Balance y liquidez',
      description: 'Revisa endeudamiento y capacidad de responder a obligaciones de corto plazo.',
      criteria: filterFundamentalCriteria(criteria, 'balance'),
    },
    {
      title: 'Flujo de caja',
      description: 'Mide la generación de efectivo disponible después de financiar la operación.',
      criteria: filterFundamentalCriteria(criteria, 'cashflow'),
    },
  ].filter((group) => group.criteria.length > 0);

  const fundamentalCriteria = uniqueCriteria(
    groups.flatMap((group) => group.criteria)
  );

  const score = calculateSectionScore(fundamentalCriteria);

  return (
    <div className="space-y-5">
      <ResearchSectionHeader
        eyebrow="Análisis del negocio"
        title="Fundamentales"
        description="Profundiza en crecimiento, rentabilidad, balance y generación de caja. Aquí la pregunta principal es si el negocio que estás comprando es financieramente sólido."
        score={score}
        scoreLabel={scoreLabel(score)}
      />

      <MetricStrip
        items={[
          metricFromCriterion(criteria, ['revenue growth', 'crecimiento ingresos'], 'Revenue growth'),
          metricFromCriterion(criteria, ['earnings growth', 'crecimiento beneficios', 'crecimiento ganancias'], 'Earnings growth'),
          metricFromCriterion(criteria, ['roe', 'return on equity'], 'ROE'),
          metricFromCriterion(criteria, ['operating margin', 'margen operativo'], 'Operating margin'),
          metricFromCriterion(criteria, ['free cash flow', 'flujo de caja libre'], 'Free cash flow'),
          metricFromCriterion(criteria, ['current ratio', 'liquidez corriente'], 'Current ratio'),
        ].filter(Boolean) as ResearchMetric[]}
      />

      {groups.length === 0 ? (
        <EmptyResearchState>
          No hay suficientes métricas fundamentales disponibles para este activo.
        </EmptyResearchState>
      ) : (
        groups.map((group) => (
          <DeepDiveSection
            key={group.title}
            title={group.title}
            description={group.description}
            criteria={group.criteria}
          />
        ))
      )}

      <SectionTakeaways
        title="Lectura fundamental"
        criteria={fundamentalCriteria}
        positiveTitle="Fortalezas del negocio"
        negativeTitle="Puntos a vigilar"
      />
    </div>
  );
}

function ValuationTab({
  stock,
  criteria,
}: {
  stock: Stock;
  criteria: Criterion[];
}) {
  const s = stock as any;
  const valuationCriteria = filterValuationCriteria(criteria);
  const score = calculateSectionScore(valuationCriteria);

  const price = stock.price != null ? Number(stock.price) : null;
  const target =
    s.target_price != null
      ? Number(s.target_price)
      : criterionNumber(criteria, ['target', 'precio objetivo']);
  const upside =
    s.upside_percent ??
    s.upside_pct ??
    (price != null && price > 0 && target != null
      ? ((target - price) / price) * 100
      : criterionNumber(criteria, ['upside', 'potencial']));

  return (
    <div className="space-y-5">
      <ResearchSectionHeader
        eyebrow="Precio vs. valor"
        title="Valoración"
        description="Esta sección responde cuánto estás pagando por el negocio. Separa la calidad de la empresa de la conveniencia del precio actual."
        score={score}
        scoreLabel={scoreLabel(score)}
      />

      <MetricStrip
        items={[
          {
            label: 'Precio actual',
            value:
              price != null
                ? `${stock.currency || ''} ${price.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : '—',
          },
          {
            label: 'Precio objetivo',
            value:
              target != null
                ? `${stock.currency || ''} ${target.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : '—',
          },
          {
            label: 'Potencial',
            value:
              upside != null
                ? `${Number(upside) >= 0 ? '+' : ''}${Number(upside).toFixed(1)}%`
                : '—',
            tone:
              upside == null
                ? 'neutral'
                : Number(upside) >= 15
                ? 'good'
                : Number(upside) < 0
                ? 'bad'
                : 'review',
          },
          {
            label: 'P/E',
            value:
              stock.pe_ratio != null
                ? `${Number(stock.pe_ratio).toFixed(1)}x`
                : criterionValue(criteria, ['p/e', 'pe ratio']),
          },
          {
            label: 'Market Cap',
            value: stock.market_cap ? formatLarge(stock.market_cap) : '—',
          },
        ]}
      />

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="card overflow-hidden">
          <div className="border-b bg-slate-50 px-6 py-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
              Múltiplos y expectativas
            </p>
            <h3 className="mt-1 text-lg font-black">Qué está descontando el mercado</h3>
          </div>

          {valuationCriteria.length > 0 ? (
            <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              {valuationCriteria.map((criterion) => (
                <CriterionCard key={criterion.key} criterion={criterion} />
              ))}
            </div>
          ) : (
            <div className="p-8 text-sm text-slate-500">
              No hay suficientes múltiplos disponibles para este activo.
            </div>
          )}
        </div>

        <ValuationPerspective
          price={price}
          target={target}
          upside={upside != null ? Number(upside) : null}
          pe={stock.pe_ratio != null ? Number(stock.pe_ratio) : null}
        />
      </section>

      <SectionTakeaways
        title="Lectura de valoración"
        criteria={valuationCriteria}
        positiveTitle="Señales favorables"
        negativeTitle="Riesgos de precio"
      />
    </div>
  );
}

function RiskTab({
  stock,
  criteria,
  history,
}: {
  stock: Stock;
  criteria: Criterion[];
  history: HistoryResponse | null;
}) {
  const riskCriteria = filterRiskCriteria(criteria);
  const score = calculateRiskScore(riskCriteria);
  const beta =
    (stock as any).beta != null
      ? Number((stock as any).beta)
      : criterionNumber(criteria, ['beta']);

  const drawdown = calculateMaxDrawdown(history?.points ?? []);
  const volatility = calculateAnnualizedVolatility(history?.points ?? []);

  return (
    <div className="space-y-5">
      <ResearchSectionHeader
        eyebrow="Protección del capital"
        title="Riesgo"
        description="Profundiza en volatilidad, sensibilidad al mercado, liquidez y estructura financiera. Aquí una puntuación más alta significa un perfil de riesgo más saludable dentro de los criterios disponibles."
        score={score}
        scoreLabel={riskScoreLabel(score)}
      />

      <MetricStrip
        items={[
          {
            label: 'Beta',
            value: beta != null ? beta.toFixed(2) : '—',
            tone:
              beta == null
                ? 'neutral'
                : beta >= 0.7 && beta <= 1.3
                ? 'good'
                : beta <= 2
                ? 'review'
                : 'bad',
          },
          {
            label: 'Volatilidad anualizada',
            value: volatility != null ? `${volatility.toFixed(1)}%` : '—',
          },
          {
            label: 'Máx. drawdown',
            value: drawdown != null ? `${drawdown.toFixed(1)}%` : '—',
            tone:
              drawdown == null
                ? 'neutral'
                : drawdown >= -15
                ? 'good'
                : drawdown >= -30
                ? 'review'
                : 'bad',
          },
          metricFromCriterion(criteria, ['debt to equity', 'debt/equity', 'deuda'], 'Debt / Equity'),
          metricFromCriterion(criteria, ['current ratio', 'liquidez corriente'], 'Current ratio'),
          metricFromCriterion(criteria, ['free float', 'float'], 'Free float'),
        ].filter(Boolean) as ResearchMetric[]}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <DeepDiveSection
          title="Riesgo de mercado"
          description="Sensibilidad del precio y amplitud de las caídas observadas en el histórico disponible."
          criteria={filterRiskCriteria(criteria, 'market')}
          extra={
            <div className="grid gap-3 sm:grid-cols-2">
              <InlineRiskMetric
                label="Volatilidad"
                value={volatility != null ? `${volatility.toFixed(1)}%` : '—'}
                description="Desviación anualizada aproximada de los retornos diarios del histórico cargado."
              />
              <InlineRiskMetric
                label="Máximo drawdown"
                value={drawdown != null ? `${drawdown.toFixed(1)}%` : '—'}
                description="Mayor caída desde un máximo previo dentro del histórico cargado."
              />
            </div>
          }
        />

        <DeepDiveSection
          title="Riesgo financiero"
          description="Endeudamiento, liquidez y estructura que pueden aumentar la fragilidad financiera."
          criteria={filterRiskCriteria(criteria, 'financial')}
        />
      </div>

      <SectionTakeaways
        title="Mapa de riesgos"
        criteria={riskCriteria}
        positiveTitle="Factores defensivos"
        negativeTitle="Riesgos principales"
      />
    </div>
  );
}

type ResearchMetric = {
  label: string;
  value: string;
  tone?: 'good' | 'review' | 'bad' | 'neutral';
};

function ResearchSectionHeader({
  eyebrow,
  title,
  description,
  score,
  scoreLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  score: number | null;
  scoreLabel: string;
}) {
  const tone =
    score == null
      ? 'bg-slate-100 text-slate-600'
      : score >= 75
      ? 'bg-emerald-50 text-emerald-700'
      : score >= 55
      ? 'bg-amber-50 text-amber-700'
      : 'bg-rose-50 text-rose-700';

  return (
    <section className="card p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-2xl font-black">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        </div>

        <div className={`min-w-[150px] rounded-2xl px-5 py-4 text-center ${tone}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">
            Subscore
          </p>
          <p className="mt-1 text-3xl font-black">
            {score != null ? score.toFixed(0) : '—'}
            {score != null && <span className="text-sm">/100</span>}
          </p>
          <p className="mt-1 text-xs font-black">{scoreLabel}</p>
        </div>
      </div>
    </section>
  );
}

function MetricStrip({ items }: { items: ResearchMetric[] }) {
  if (items.length === 0) return null;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => {
        const tone =
          item.tone === 'good'
            ? 'text-emerald-700'
            : item.tone === 'review'
            ? 'text-amber-700'
            : item.tone === 'bad'
            ? 'text-rose-700'
            : 'text-slate-950';

        return (
          <article key={item.label} className="card p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
              {item.label}
            </p>
            <p className={`mt-2 text-lg font-black ${tone}`}>{item.value}</p>
          </article>
        );
      })}
    </section>
  );
}

function DeepDiveSection({
  title,
  description,
  criteria,
  extra,
}: {
  title: string;
  description: string;
  criteria: Criterion[];
  extra?: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b bg-slate-50 px-6 py-4">
        <h3 className="text-lg font-black">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>
      </div>

      {extra && <div className="border-b p-5">{extra}</div>}

      {criteria.length > 0 ? (
        <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {criteria.map((criterion) => (
            <CriterionCard key={criterion.key} criterion={criterion} />
          ))}
        </div>
      ) : (
        !extra && (
          <div className="p-6 text-sm text-slate-500">
            No hay suficientes datos disponibles para esta subsección.
          </div>
        )
      )}
    </section>
  );
}

function ValuationPerspective({
  price,
  target,
  upside,
  pe,
}: {
  price: number | null;
  target: number | null;
  upside: number | null;
  pe: number | null;
}) {
  const message =
    upside == null
      ? 'No hay un precio objetivo suficiente para estimar potencial.'
      : upside >= 15
      ? 'El precio objetivo disponible implica un potencial atractivo según el umbral del modelo.'
      : upside >= 0
      ? 'El precio objetivo implica potencial positivo, aunque todavía en zona de revisión.'
      : 'El precio actual se encuentra por encima del precio objetivo disponible.';

  return (
    <aside className="card p-6">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
        Perspectiva
      </p>
      <h3 className="mt-1 text-lg font-black">Precio frente a expectativas</h3>

      <div className="mt-5 space-y-4">
        <PerspectiveRow label="Precio actual" value={price != null ? price.toFixed(2) : '—'} />
        <PerspectiveRow label="Target medio" value={target != null ? target.toFixed(2) : '—'} />
        <PerspectiveRow
          label="Potencial"
          value={upside != null ? `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%` : '—'}
        />
        <PerspectiveRow label="P/E" value={pe != null ? `${pe.toFixed(1)}x` : '—'} />
      </div>

      <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        {message}
      </div>

      <p className="mt-4 text-xs leading-5 text-slate-400">
        El precio objetivo es una estimación de consenso, no una garantía de retorno.
      </p>
    </aside>
  );
}

function PerspectiveRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="font-black">{value}</span>
    </div>
  );
}

function InlineRiskMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function SectionTakeaways({
  title,
  criteria,
  positiveTitle,
  negativeTitle,
}: {
  title: string;
  criteria: Criterion[];
  positiveTitle: string;
  negativeTitle: string;
}) {
  const positives = criteria.filter((item) => item.status === 'cumple');
  const negatives = criteria.filter(
    (item) => item.status === 'revisar' || item.status === 'no_cumple'
  );

  if (positives.length === 0 && negatives.length === 0) return null;

  return (
    <section className="card p-6">
      <h3 className="text-lg font-black">{title}</h3>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TakeawayList title={positiveTitle} criteria={positives} positive />
        <TakeawayList title={negativeTitle} criteria={negatives} positive={false} />
      </div>
    </section>
  );
}

function TakeawayList({
  title,
  criteria,
  positive,
}: {
  title: string;
  criteria: Criterion[];
  positive: boolean;
}) {
  return (
    <div className={positive ? 'rounded-2xl bg-emerald-50 p-5' : 'rounded-2xl bg-amber-50 p-5'}>
      <h4 className={positive ? 'font-black text-emerald-900' : 'font-black text-amber-900'}>
        {title}
      </h4>
      {criteria.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {criteria.slice(0, 5).map((criterion) => (
            <li key={criterion.key} className="text-sm leading-5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold">{criterion.name}</span>
                <span className="font-black">{criterion.formatted_value}</span>
              </div>
              <p className="mt-1 text-xs opacity-70">{criterion.explanation}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm opacity-70">No hay señales disponibles en esta categoría.</p>
      )}
    </div>
  );
}

function EmptyResearchState({ children }: { children: React.ReactNode }) {
  return (
    <section className="card p-10 text-center text-sm text-slate-500">{children}</section>
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


function uniqueCriteria(criteria: Criterion[]) {
  const seen = new Set<string>();
  return criteria.filter((item) => {
    const key = item.key || item.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function criterionNumber(criteria: Criterion[], needles: string[]) {
  const found = criteria.find((item) => {
    const haystack = `${item.key} ${item.name}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });

  if (found?.value != null && Number.isFinite(Number(found.value))) {
    return Number(found.value);
  }

  if (!found?.formatted_value) return null;

  const cleaned = found.formatted_value.replace(/[$,%xX\s]/g, '').replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function metricFromCriterion(
  criteria: Criterion[],
  needles: string[],
  label: string
): ResearchMetric | null {
  const found = criteria.find((item) => {
    const haystack = `${item.key} ${item.name}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  });

  if (!found) return null;

  return {
    label,
    value: found.formatted_value || '—',
    tone:
      found.status === 'cumple'
        ? 'good'
        : found.status === 'revisar'
        ? 'review'
        : found.status === 'no_cumple'
        ? 'bad'
        : 'neutral',
  };
}

function calculateSectionScore(criteria: Criterion[]) {
  const available = criteria.filter((item) => item.status !== 'sin_dato');
  if (available.length === 0) return null;

  const points: Record<string, number> = {
    cumple: 100,
    revisar: 55,
    no_cumple: 15,
  };

  const total = available.reduce(
    (sum, item) => sum + (points[item.status] ?? 0),
    0
  );

  return total / available.length;
}

function calculateRiskScore(criteria: Criterion[]) {
  return calculateSectionScore(criteria);
}

function scoreLabel(score: number | null) {
  if (score == null) return 'Sin datos suficientes';
  if (score >= 80) return 'Muy sólido';
  if (score >= 65) return 'Sólido';
  if (score >= 50) return 'Mixto';
  return 'Débil';
}

function riskScoreLabel(score: number | null) {
  if (score == null) return 'Sin datos suficientes';
  if (score >= 80) return 'Riesgo contenido';
  if (score >= 65) return 'Riesgo moderado';
  if (score >= 50) return 'Riesgo a vigilar';
  return 'Riesgo elevado';
}

function filterFundamentalCriteria(
  criteria: Criterion[],
  section: 'growth' | 'profitability' | 'balance' | 'cashflow'
) {
  const words: Record<'growth' | 'profitability' | 'balance' | 'cashflow', string[]> = {
    growth: [
      'revenue growth',
      'earnings growth',
      'crecimiento ingresos',
      'crecimiento beneficios',
      'crecimiento ganancias',
      'revenue',
      'ingresos',
    ],
    profitability: [
      'roe',
      'roa',
      'return on equity',
      'return on assets',
      'operating margin',
      'margen operativo',
      'rentabilidad',
    ],
    balance: [
      'debt',
      'deuda',
      'current ratio',
      'liquidez',
    ],
    cashflow: [
      'free cash flow',
      'free cashflow',
      'flujo de caja',
      'fcf',
    ],
  };

  return criteria.filter((item) => {
    const haystack = `${item.key} ${item.name} ${item.category}`.toLowerCase();
    return words[section].some((word) => haystack.includes(word));
  });
}

function filterRiskCriteria(
  criteria: Criterion[],
  section?: 'market' | 'financial'
) {
  const marketWords = [
    'beta',
    'riesgo',
    'risk',
    'volatil',
    'free float',
    'float',
    'drawdown',
    'short',
  ];

  const financialWords = [
    'debt',
    'deuda',
    'current ratio',
    'liquidez',
    'free cash flow',
    'flujo de caja',
  ];

  const words =
    section === 'market'
      ? marketWords
      : section === 'financial'
      ? financialWords
      : [...marketWords, ...financialWords];

  return criteria.filter((item) => {
    const haystack = `${item.key} ${item.name} ${item.category}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });
}

function calculateMaxDrawdown(points: HistoryPoint[]) {
  const closes = points
    .map((point) => Number(point.close))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (closes.length < 2) return null;

  let peak = closes[0];
  let maxDrawdown = 0;

  for (const close of closes) {
    if (close > peak) peak = close;
    const drawdown = ((close - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

function calculateAnnualizedVolatility(points: HistoryPoint[]) {
  const closes = points
    .map((point) => Number(point.close))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (closes.length < 3) return null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    Math.max(returns.length - 1, 1);

  return Math.sqrt(variance) * Math.sqrt(252) * 100;
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
