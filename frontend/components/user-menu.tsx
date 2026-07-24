'use client';

import {
  useEffect,
  useState,
} from 'react';

import {
  LogIn,
  LogOut,
  User,
} from 'lucide-react';

import { useRouter } from 'next/navigation';

import type {
  User as SupabaseUser,
} from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

export function UserMenu() {
  const router = useRouter();

  const [user, setUser] =
    useState<SupabaseUser | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    const supabase =
      createClient();

    async function loadUser() {
      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      setUser(user);
      setLoading(false);
    }

    loadUser();

    const {
      data: {
        subscription,
      },
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {
          setUser(
            session?.user ?? null
          );
        }
      );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    const supabase =
      createClient();

    await supabase.auth.signOut();

    setUser(null);

    router.push('/');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="h-10 w-24 animate-pulse rounded-xl bg-slate-100" />
    );
  }

  if (!user) {
    return (
      <button
        onClick={() =>
          router.push('/login')
        }
        className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"
      >
        <LogIn size={16} />

        Iniciar sesión
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-xs text-slate-400">
          Sesión iniciada
        </p>

        <p className="max-w-[180px] truncate text-sm font-bold">
          {user.email}
        </p>
      </div>

      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100">
        <User
          size={17}
          className="text-indigo-600"
        />
      </div>

      <button
        onClick={logout}
        title="Cerrar sesión"
        className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
      >
        <LogOut size={17} />
      </button>
    </div>
  );
}