'use client';

import { useState } from 'react';

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

export default function Page() {
  const [tab, setTab] =
    useState<Tab>('dashboard');

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-[1600px]">
        {/* DESKTOP SIDEBAR */}

        <Sidebar
          tab={tab}
          setTab={setTab}
        />

        {/* MAIN CONTENT */}

        <section className="min-w-0 flex-1 p-5 md:p-8">
          {/* MOBILE NAVIGATION */}

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

          {/* TAB CONTENT */}

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