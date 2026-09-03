'use client';

import { useEffect, useState } from 'react';

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
  const [tab, setTab] =
    useState<Tab>('dashboard');

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (requestedTab && validTabs.has(requestedTab)) {
      setTab(requestedTab);
    }
  }, []);

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-[1600px]">
        <Sidebar
          tab={tab}
          setTab={setTab}
        />

        <section className="min-w-0 flex-1 p-5 md:p-8">
          <div className="mb-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {mobileTabs.map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  setTab(item.id)
                }
                className={`
                  shrink-0 rounded-xl px-4 py-2
                  text-sm font-bold transition
                  ${
                    tab === item.id
                      ? 'bg-slate-950 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }
                `}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'dashboard' && (
            <Dashboard />
          )}

          {tab === 'research' && (
            <Research />
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
