'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { NAVIGATION_EVENT } from '@/lib/api-request';
import { UserMenu } from '@/components/user-menu';

import {
  Sidebar,
  type Tab,
} from '@/components/sidebar';

import { Dashboard } from '@/components/dashboard';
import { Research } from '@/components/research';
import { Watchlist } from '@/components/watchlist';
import { Portfolio } from '@/components/portfolio';
import { Criteria } from '@/components/criteria';

const mobileTabs: {
  id: Tab;
  label: string;
}[] = [
  {
    id: 'dashboard',
    label: 'Resumen',
  },
  {
    id: 'research',
    label: 'Investigar',
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
  },
  {
    id: 'portfolio',
    label: 'Portafolio',
  },
  {
    id: 'criteria',
    label: 'Criterios',
  },
];

const validTabs = new Set<Tab>(mobileTabs.map((item) => item.id));

export default function Page() {
  return <Suspense fallback={<p className="p-8 text-slate-500">Cargando...</p>}><HomePage /></Suspense>;
}

function HomePage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = requestedTab && validTabs.has(requestedTab) ? requestedTab : 'dashboard';
  function setTab(next: Tab) {
    if (next === tab) return;
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
    // Client sections must remain navigable without a server response.
    window.history.pushState(null, '', '/?tab=' + next);
  }

  return (
    <main className="app-shell min-h-screen">
      <div className="mx-auto flex max-w-[1600px]">
        <Sidebar
          tab={tab}
          setTab={setTab}
        />

        <section className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:p-8 xl:px-10">
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-slate-200 pb-4 lg:hidden"><p className="text-sm font-semibold tracking-tight text-slate-800">Investment <span className="text-indigo-600">Research</span></p><UserMenu /></div>
          <nav aria-label="Navegación principal móvil" className="mb-7 flex gap-1 overflow-x-auto border-b border-slate-200 pb-2 lg:hidden">
            {mobileTabs.map((item) => (
              <button
                key={item.id}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() =>
                  setTab(item.id)
                }
                className={`
                  shrink-0 rounded-lg px-3 py-2.5
                  text-sm font-medium transition
                  ${
                    tab === item.id
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-600 hover:bg-white'
                  }
                `}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab === 'dashboard' && (
            <Dashboard />
          )}

          {tab === 'research' && (
            <Research key={searchParams.get('ticker') || 'research'} />
          )}

          {tab === 'watchlist' && (
            <Watchlist />
          )}

          {tab === 'portfolio' && (
            <Portfolio />
          )}

          {tab === 'criteria' && (
            <Criteria />
          )}
        </section>
      </div>
    </main>
  );
}
