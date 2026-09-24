'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ArrowDownRight, RefreshCw, Star, Wallet, Globe2, Loader2, LockKeyhole } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { api } from '@/lib/api';
import { createClient, getCurrentUser } from '@/lib/supabase/client';

type MarketStock = { ticker: string; company: string; price: number | null; change_percent: number | null; market_cap: number | null };
type MarketOverview = {
  stocks: MarketStock[];
  indices: { ticker: string; name: string; price: number | null; change_percent: number | null }[];
  leaders: MarketStock[]; laggards: MarketStock[]; updated_at: string; source: string;
  stale?: boolean; warning?: string | null;
  refresh_seconds?: number;
};
type WatchRow = { ticker: string; company?: string; price?: number | null; currency?: string; score?: number | null };
type PortfolioOverview = {
  summary: { market_value: number; invested: number; pnl: number; pnl_percent: number; positions: number; estimated?: boolean; stale?: boolean };
  allocation_by_asset: { ticker: string; value: number; percent: number }[];
};

const money = (value: number | null | undefined, currency = 'USD') => value == null || !Number.isFinite(value) ? '—' :
  `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [market, setMarket] = useState<MarketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    getCurrentUser().then(({ data }) => { if (active) { setUser(data.user); setAuthLoading(false); } })
      .catch(() => { if (active) setAuthLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setUser(session?.user ?? null); setAuthLoading(false); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      if (busy || !active) return;
      busy = true;
      let nextRefresh = 30000;
      setLoading(true); setError('');
      try {
        const result = await api<MarketOverview>('/market/overview', { signal: controller.signal });
        nextRefresh = Math.max(5000, Math.min(60000, (result.refresh_seconds ?? 60) * 1000));
        if (active) setMarket(result);
      } catch {
        if (active) setError('El mercado no se pudo actualizar. Puedes seguir consultando tus inversiones.');
      } finally {
        busy = false;
        if (active) {
          setLoading(false);
          timer = setTimeout(load, nextRefresh);
        }
      }
    }
    load();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [refresh]);

  const observedAt = market?.updated_at ? new Date(market.updated_at) : null;
  const updatedLabel = observedAt && !Number.isNaN(observedAt.getTime())
    ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(observedAt) : null;

  return <div className="space-y-7">
    <header className="page-heading">
      <div><p className="eyebrow">Tu perspectiva de inversión</p><h1>Resumen</h1><p>El mercado, lo que sigues y lo que tienes. Todo en un solo lugar.</p></div>
      <button className="button-secondary" onClick={() => setRefresh(x => x + 1)} disabled={loading}>
        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {loading ? 'Actualizando…' : 'Actualizar'}
      </button>
    </header>

    <section aria-labelledby="market-heading" className="card overflow-hidden">
      <div className="section-heading"><div className="flex items-center gap-3"><Globe2 size={18} className="text-indigo-600" /><div><h2 id="market-heading">Panorama del mercado</h2><p>Índices de referencia · variación frente al cierre anterior</p></div></div>
        {updatedLabel && <span className="text-xs text-slate-500">{updatedLabel}</span>}
      </div>
      {error && <p role="alert" className="mx-5 mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
      {market?.warning && <p role="status" className="mx-5 mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{market.warning}</p>}
      {!market ? <LoadingState text={loading ? 'Consultando los índices…' : 'Los índices estarán disponibles cuando se restablezcan los datos.'} loading={loading} /> :
        market.indices.length ? <div className="grid grid-cols-2 border-t border-slate-100 xl:grid-cols-4">
          {market.indices.map(index => <article key={index.ticker} className="min-w-0 border-b border-r border-slate-100 p-5 last:border-r-0 sm:p-6">
            <p className="text-sm font-medium text-slate-600">{index.name}</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{index.price == null ? '—' : index.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>
            <div className="mt-2"><Change value={index.change_percent} /></div>
          </article>)}
        </div> : <LoadingState loading={false} text="No hay índices disponibles en esta actualización." />}
    </section>

    <div className="grid items-stretch gap-5 md:grid-cols-2">
      <section className="card flex min-w-0 flex-col overflow-hidden" aria-labelledby="watchlist-heading">
        <div className="section-heading"><div className="flex items-center gap-3"><span className="icon-tile bg-indigo-50 text-indigo-600"><Star size={18} /></span><div><h2 id="watchlist-heading">Watchlist</h2><p>Lo que estás siguiendo</p></div></div><Link className="quiet-link" href="/?tab=watchlist" aria-label="Abrir watchlist"><ArrowUpRight size={19} /></Link></div>
        {authLoading ? <LoadingState text="Cargando tu cuenta…" /> : !user ? <PrivatePrompt label="Guarda acciones y ETFs para seguirlos de cerca." /> : <WatchlistPreview key={user.id} refresh={refresh} />}
        <Link className="card-footer-link" href="/?tab=watchlist">Abrir mi watchlist <ArrowRight size={15} /></Link>
      </section>
      <section className="card flex min-w-0 flex-col overflow-hidden" aria-labelledby="portfolio-heading">
        <div className="section-heading"><div className="flex items-center gap-3"><span className="icon-tile bg-violet-50 text-violet-600"><Wallet size={18} /></span><div><h2 id="portfolio-heading">Portafolio</h2><p>Lo que tienes invertido</p></div></div><Link className="quiet-link" href="/?tab=portfolio" aria-label="Abrir portafolio"><ArrowUpRight size={19} /></Link></div>
        {authLoading ? <LoadingState text="Cargando tu cuenta…" /> : !user ? <PrivatePrompt label="Reúne tus inversiones y sigue su evolución." /> : <PortfolioPreview key={user.id} refresh={refresh} />}
        <Link className="card-footer-link" href="/?tab=portfolio">Abrir mi portafolio <ArrowRight size={15} /></Link>
      </section>
    </div>

    <section className="card overflow-hidden" aria-labelledby="map-heading">
      <div className="section-heading"><div><h2 id="map-heading">El mercado de un vistazo</h2><p>Variación diaria de las empresas de la selección de mercado.</p></div>
        <div className="flex gap-3 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Sube</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" />Baja</span></div>
      </div>
      {market?.stocks.length ? <div className="grid grid-cols-2 gap-2 px-5 pb-5 sm:grid-cols-3 xl:grid-cols-5">
        {market.stocks.map(stock => {
          const change = stock.change_percent;
          const tone = change == null || change === 0 ? 'border-slate-200 bg-slate-50' : change > 0 ? 'border-emerald-100 bg-emerald-50/70' : 'border-rose-100 bg-rose-50/70';
          return <Link key={stock.ticker} href={`/research?ticker=${encodeURIComponent(stock.ticker)}`} className={`market-tile ${tone}`} aria-label={`Investigar ${stock.company} (${stock.ticker})`}>
            <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900">{stock.ticker}</span><ArrowUpRight size={14} className="shrink-0 text-slate-400" /></div>
            <p className="mt-1 truncate text-xs text-slate-600" title={stock.company}>{stock.company}</p>
            <div className="mt-4"><Change value={change} /></div>
          </Link>;
        })}
      </div> : <LoadingState loading={loading} text={loading ? 'Cargando la selección de mercado…' : 'No hay cotizaciones disponibles en esta actualización.'} />}
    </section>

    <div className="grid gap-5 md:grid-cols-2">
      <MarketMovers title="Mayores subidas" items={(market?.leaders ?? []).filter(item => item.change_percent != null && item.change_percent > 0)} loading={loading} />
      <MarketMovers title="Mayores caídas" items={(market?.laggards ?? []).filter(item => item.change_percent != null && item.change_percent < 0)} loading={loading} />
    </div>
    <footer className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><p>Fuente: {market?.source || 'Datos de mercado'} · Las cotizaciones pueden tener retraso.</p><Link className="quiet-link" href="/?tab=criteria">Entender los datos y puntajes <ArrowRight size={13} /></Link></footer>
  </div>;
}

function WatchlistPreview({ refresh }: { refresh: number }) {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const saved = await api<WatchRow[]>('/watchlist');
        if (!active) return;
        setCount(saved.length);
        const preview = saved.slice(0, 5);
        setRows(preview);
        // Only enrich the visible preview, in small batches using the existing cache.
        for (let i = 0; i < preview.length; i += 3) {
          const batch = preview.slice(i, i + 3);
          const results = await Promise.allSettled(batch.map(item => api<WatchRow>(`/stocks/${encodeURIComponent(item.ticker)}`)));
          if (!active) return;
          results.forEach((result, j) => { if (result.status === 'fulfilled') preview[i + j] = { ...batch[j], ...result.value }; });
          setRows([...preview]);
          if (results.some(x => x.status === 'rejected')) setError('Algunas cotizaciones no están disponibles.');
        }
      } catch { if (active) setError('No se pudo actualizar tu watchlist. Inténtalo de nuevo desde la lista.'); }
      finally { if (active) setLoading(false); }
    }
    load(); return () => { active = false; };
  }, [refresh]);
  return <div className="flex-1">
    {error && <p role="status" className="px-5 pb-3 text-xs text-amber-800">{error}</p>}
    {loading && !rows.length ? <LoadingState text="Cargando tu watchlist…" /> : !rows.length ? <EmptyState title={error ? 'Watchlist no disponible' : 'Tu próxima idea empieza aquí'} text={error ? 'Tu lista sigue guardada. Puedes volver a intentar su consulta.' : 'Busca una empresa y guárdala para seguir su evolución.'} href="/?tab=research" action="Investigar activos" /> : <>
      <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-y border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-500"><span>Activo</span><span className="w-24 text-right">Precio</span><Link href="/?tab=criteria#score" className="w-14 text-right underline decoration-dotted underline-offset-4">Puntaje</Link></div>
      <div className="divide-y divide-slate-100">{rows.map(row => <Link key={row.ticker} href={`/research?ticker=${encodeURIComponent(row.ticker)}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50">
        <div className="min-w-0"><p className="text-sm font-semibold">{row.ticker}</p><p className="mt-0.5 truncate text-xs text-slate-500">{row.company || 'Datos pendientes'}</p></div>
        <span className="w-24 text-right text-xs font-medium tabular-nums">{money(row.price, row.currency)}</span>
        <span className={`w-14 rounded-md py-1 text-center text-xs font-semibold tabular-nums ${row.score == null ? 'bg-slate-50 text-slate-400' : row.score >= 80 ? 'bg-emerald-50 text-emerald-700' : row.score >= 65 ? 'bg-indigo-50 text-indigo-700' : row.score >= 50 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700'}`}>{row.score == null ? '—' : `${row.score.toFixed(0)}/100`}</span>
      </Link>)}</div>
      <p className="px-5 py-3 text-xs text-slate-500">{loading ? 'Actualizando precios…' : `${Math.min(count, 5)} de ${count} activos en seguimiento`}</p>
    </>}
  </div>;
}

function PortfolioPreview({ refresh }: { refresh: number }) {
  const [data, setData] = useState<PortfolioOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api<PortfolioOverview>('/portfolio/analysis').then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError('No se pudo actualizar el portafolio. Consulta el detalle para reintentar.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const colors = ['bg-violet-600', 'bg-indigo-500', 'bg-violet-400', 'bg-indigo-300'];
  const assets = data?.allocation_by_asset.slice(0, 4) ?? [];
  const rest = Math.max(0, 100 - assets.reduce((total, item) => total + item.percent, 0));
  return <div className="flex-1">
    {error && <p role="status" className="px-5 pb-3 text-xs text-amber-800">{error}</p>}
    {loading && !data ? <LoadingState text="Consultando tus inversiones…" /> : !data ? <LoadingState loading={false} text="Tu portafolio estará disponible al restablecerse la conexión." /> : !data.summary.positions ?
      <EmptyState title="Todas tus inversiones, juntas" text="Agrega una inversión o importa el informe de tu broker para empezar." href="/?tab=portfolio" action="Agregar mi portafolio" /> :
      <div className="px-5 pb-5 sm:px-6">
        <p className="text-xs font-medium text-slate-500">{data.summary.estimated ? 'Valor estimado del portafolio' : 'Valor del portafolio'}</p>
        {(data.summary.estimated || data.summary.stale) && <p className="mt-1 text-xs text-amber-800">{data.summary.estimated ? 'Incluye costos de compra por falta de cotizaciones. Revisa el detalle del portafolio.' : 'Incluye datos guardados. Revisa las fechas en el portafolio.'}</p>}
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{money(data.summary.market_value)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><Change value={data.summary.estimated ? null : data.summary.pnl_percent} /><span className="text-xs text-slate-500">respecto a lo invertido</span></div>
        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-slate-100 py-4"><div><dt className="text-xs text-slate-500">Capital invertido</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{money(data.summary.invested)}</dd></div><div><dt className="text-xs text-slate-500">Ganancia / pérdida</dt><dd className={`mt-1 text-sm font-semibold tabular-nums ${data.summary.pnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{data.summary.pnl > 0 ? '+' : ''}{money(data.summary.pnl)}</dd></div></dl>
        <div className="mt-5 flex justify-between text-xs"><span className="font-medium text-slate-600">Distribución por activo</span><span className="text-slate-500">{data.summary.positions} activos</span></div>
        <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">{assets.map((asset, i) => <span key={asset.ticker} className={colors[i]} style={{ width: `${Math.max(0, asset.percent)}%` }} />)}{rest > 0 && <span className="bg-slate-300" style={{ width: `${rest}%` }} />}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600">{assets.map((asset, i) => <span className="flex items-center gap-1.5" key={asset.ticker}><span className={`h-2 w-2 rounded-full ${colors[i]}`} />{asset.ticker} <span className="tabular-nums text-slate-500">{asset.percent.toFixed(1)}%</span></span>)}{data.allocation_by_asset.length > 4 && <span>Otros {rest.toFixed(1)}%</span>}</div>
        {loading && <p className="mt-3 text-xs text-slate-500">Actualizando tu portafolio…</p>}
      </div>}
  </div>;
}

function Change({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-slate-500">Sin variación disponible</span>;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${value === 0 ? 'text-slate-500' : value > 0 ? 'text-emerald-700' : 'text-rose-700'}`}><Icon size={15} aria-hidden="true" />{value > 0 ? '+' : ''}{value.toFixed(2)}%</span>;
}
function LoadingState({ text, loading = true }: { text: string; loading?: boolean }) {
  return <div role="status" className="flex min-h-32 items-center justify-center gap-2 px-6 py-10 text-center text-sm text-slate-500">{loading && <Loader2 size={17} className="shrink-0 animate-spin" />}{text}</div>;
}
function PrivatePrompt({ label }: { label: string }) {
  return <div className="flex-1 px-6 py-8"><LockKeyhole size={21} className="text-slate-400" /><p className="mt-3 text-sm text-slate-600">{label}</p><Link href="/login" className="quiet-link mt-5">Iniciar sesión <ArrowRight size={14} /></Link></div>;
}
function EmptyState({ title, text, href, action }: { title: string; text: string; href: string; action: string }) {
  return <div className="px-6 py-8"><h3 className="font-medium text-slate-800">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p><Link href={href} className="quiet-link mt-5">{action}<ArrowRight size={14} /></Link></div>;
}
function MarketMovers({ title, items, loading }: { title: string; items: MarketStock[]; loading: boolean }) {
  return <section className="card overflow-hidden"><div className="section-heading"><div><h2>{title}</h2><p>Dentro de la selección de mercado</p></div></div>
    {!items.length ? <LoadingState loading={loading} text={loading ? 'Consultando movimientos…' : 'No hay movimientos disponibles.'} /> : <div className="divide-y divide-slate-100 border-t border-slate-100">{items.slice(0, 5).map(item => <Link key={item.ticker} href={`/research?ticker=${encodeURIComponent(item.ticker)}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-slate-50"><div className="min-w-0"><p className="text-sm font-semibold">{item.ticker}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.company}</p></div><div className="shrink-0 text-right"><Change value={item.change_percent} /><p className="mt-0.5 text-xs tabular-nums text-slate-500">{money(item.price)}</p></div></Link>)}</div>}
  </section>;
}
