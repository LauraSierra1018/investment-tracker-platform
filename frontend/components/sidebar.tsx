'use client';

import {
  LayoutDashboard,
  Search,
  Star,
  BriefcaseBusiness,
  BookOpen,
  LockKeyhole,
} from 'lucide-react';

import { UserMenu } from '@/components/user-menu';

export type Tab =
  | 'dashboard'
  | 'research'
  | 'watchlist'
  | 'portfolio'
  | 'criteria';

export function Sidebar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (x: Tab) => void;
}) {
  const links: [
    Tab,
    string,
    any,
    boolean
  ][] = [
    [
      'dashboard',
      'Resumen',
      LayoutDashboard,
      false,
    ],
    [
      'research',
      'Investigar',
      Search,
      false,
    ],
    [
      'watchlist',
      'Watchlist',
      Star,
      true,
    ],
    [
      'portfolio',
      'Portafolio',
      BriefcaseBusiness,
      true,
    ],
    [
      'criteria',
      'Criterios',
      BookOpen,
      false,
    ],
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r bg-white p-6 lg:flex">

      {/* LOGO */}

      <div>
        <div className="text-xs font-bold tracking-[.25em] text-slate-400">
          INVESTMENT
        </div>

        <div className="text-2xl font-black">
          Research AI
        </div>
      </div>

      {/* NAVIGATION */}

      <nav className="mt-10 space-y-2">
        {links.map(
          ([
            id,
            label,
            Icon,
            privateSection,
          ]) => (
            <button
              key={id}
              onClick={() =>
                setTab(id)
              }
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left font-semibold transition ${
                tab === id
                  ? 'bg-slate-950 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon size={18} />

              <span className="flex-1">
                {label}
              </span>

              {privateSection && (
                <LockKeyhole
                  size={13}
                  className={
                    tab === id
                      ? 'text-slate-400'
                      : 'text-slate-300'
                  }
                />
              )}
            </button>
          )
        )}
      </nav>

      {/* INFO */}

      <div className="mt-auto">

        <div className="mb-4 rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-700">
            Tu cuenta
          </p>

          <p className="mt-1 text-[11px] leading-4 text-slate-400">
            Inicia sesión para guardar tu
            watchlist y administrar tu
            portafolio.
          </p>
        </div>

        {/* LOGIN / USER */}

        <div className="border-t pt-4">
          <UserMenu />
        </div>
      </div>
    </aside>
  );
}