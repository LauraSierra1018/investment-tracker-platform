'use client';

import {
  useEffect,
  useState,
} from 'react';

import {
  Loader2,
  LockKeyhole,
} from 'lucide-react';

import { useRouter } from 'next/navigation';

import type {
  User,
} from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

export function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [user, setUser] =
    useState<User | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    const supabase =
      createClient();

    async function check() {
      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      setUser(user);
      setLoading(false);
    }

    check();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="card max-w-md p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
            <LockKeyhole className="text-indigo-600" />
          </div>

          <h2 className="mt-5 text-2xl font-black">
            Inicia sesión
          </h2>

          <p className="mt-2 leading-6 text-slate-500">
            Necesitas una cuenta para
            acceder a tu watchlist y
            administrar tu portafolio.
          </p>

          <button
            onClick={() =>
              router.push('/login')
            }
            className="mt-6 w-full rounded-xl bg-slate-950 px-5 py-3 font-black text-white"
          >
            Iniciar sesión
          </button>

          <p className="mt-3 text-xs text-slate-400">
            Dashboard e Investigación
            siguen disponibles sin cuenta.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}