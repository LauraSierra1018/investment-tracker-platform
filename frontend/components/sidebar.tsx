'use client';

import { LayoutDashboard, Search, Star, BriefcaseBusiness, BookOpen, ChartNoAxesCombined } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { UserMenu } from '@/components/user-menu';

export type Tab = 'dashboard' | 'research' | 'watchlist' | 'portfolio' | 'criteria';
const links: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
  { id: 'research', label: 'Investigar', icon: Search },
  { id: 'watchlist', label: 'Watchlist', icon: Star },
  { id: 'portfolio', label: 'Portafolio', icon: BriefcaseBusiness },
  { id: 'criteria', label: 'Criterios', icon: BookOpen },
];

export function Sidebar({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  return <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-5 py-8 lg:flex">
    <div className="flex items-center gap-3 px-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white"><ChartNoAxesCombined size={20} /></span><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Investment</p><p className="text-lg font-semibold tracking-tight">Research</p></div></div>
    <p className="mb-3 mt-10 px-3 text-[10px] font-medium uppercase tracking-[.15em] text-slate-400">Mi espacio</p>
    <nav className="space-y-1" aria-label="Navegación principal">{links.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition ${id === 'criteria' ? 'mt-6' : ''} ${tab === id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}><Icon size={18} strokeWidth={1.7} /><span className="flex-1">{label}</span>{tab === id && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />}</button>)}</nav>
    <div className="mt-auto"><div className="mb-6 rounded-lg border border-slate-100 bg-slate-50/70 p-4"><BookOpen size={17} className="text-indigo-500" /><p className="mt-2 text-xs font-medium text-slate-700">Investiga con contexto</p><p className="mt-1 text-xs leading-5 text-slate-500">Conoce qué significa cada dato antes de decidir.</p><button onClick={() => setTab('criteria')} className="mt-3 text-xs font-medium text-indigo-700 hover:underline">Entender los criterios →</button></div><div className="border-t border-slate-100 pt-5"><UserMenu /></div></div>
  </aside>;
}
