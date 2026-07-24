'use client';

import {
  useState,
} from 'react';

import {
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  TrendingUp,
} from 'lucide-react';

import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();

  const supabase = createClient();

  const [mode, setMode] =
    useState<'login' | 'register'>(
      'login'
    );

  const [email, setEmail] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [confirmPassword, setConfirmPassword] =
    useState('');

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [message, setMessage] =
    useState('');

  async function handleLogin(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const { error } =
        await supabase.auth.signInWithPassword({
          email,
          password,
        });

      if (error) {
        throw error;
      }

      router.push('/');

      router.refresh();
    } catch (error: any) {
      setError(
        error?.message ||
          'No fue posible iniciar sesión.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setError('');
    setMessage('');

    if (password.length < 6) {
      setError(
        'La contraseña debe tener al menos 6 caracteres.'
      );

      return;
    }

    if (password !== confirmPassword) {
      setError(
        'Las contraseñas no coinciden.'
      );

      return;
    }

    setLoading(true);

    try {
      const { data, error } =
        await supabase.auth.signUp({
          email,
          password,
        });

      if (error) {
        throw error;
      }

      /*
        Si Supabase requiere confirmación
        de correo, no habrá sesión todavía.
      */

      if (!data.session) {
        setMessage(
          'Cuenta creada. Revisa tu correo para confirmar tu cuenta antes de iniciar sesión.'
        );

        return;
      }

      router.push('/');

      router.refresh();
    } catch (error: any) {
      setError(
        error?.message ||
          'No fue posible crear la cuenta.'
      );
    } finally {
      setLoading(false);
    }
  }

  function changeMode(
    newMode: 'login' | 'register'
  ) {
    setMode(newMode);

    setError('');
    setMessage('');

    setPassword('');
    setConfirmPassword('');
  }

  return (
    <main className="flex min-h-screen bg-slate-50">

      {/* LEFT SIDE */}

      <section className="hidden w-1/2 flex-col justify-between bg-slate-950 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600">
            <TrendingUp size={22} />
          </div>

          <div>
            <p className="font-black">
              Investment Tracker
            </p>

            <p className="text-xs text-slate-400">
              Research & Portfolio
            </p>
          </div>
        </div>

        <div className="max-w-lg">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-400">
            Tu espacio de inversión
          </p>

          <h1 className="mt-4 text-5xl font-black leading-tight">
            Investiga.
            <br />
            Compara.
            <br />
            Haz seguimiento.
          </h1>

          <p className="mt-6 max-w-md leading-7 text-slate-400">
            Guarda las empresas que estás
            investigando y administra tu
            portafolio desde una sola
            plataforma.
          </p>
        </div>

        <p className="text-xs text-slate-600">
          Investment Tracker
        </p>
      </section>

      {/* LOGIN */}

      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">

          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <TrendingUp size={20} />
              </div>

              <p className="font-black">
                Investment Tracker
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-indigo-600">
              {mode === 'login'
                ? 'Bienvenido'
                : 'Crear cuenta'}
            </p>

            <h2 className="mt-2 text-3xl font-black text-slate-950">
              {mode === 'login'
                ? 'Inicia sesión'
                : 'Crea tu cuenta'}
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              {mode === 'login'
                ? 'Accede a tu watchlist y portafolio.'
                : 'Crea una cuenta para guardar tus inversiones y empresas favoritas.'}
            </p>
          </div>

          <form
            onSubmit={
              mode === 'login'
                ? handleLogin
                : handleRegister
            }
            className="mt-8 space-y-5"
          >

            {/* EMAIL */}

            <div>
              <label className="text-sm font-bold text-slate-700">
                Correo electrónico
              </label>

              <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 focus-within:border-indigo-400">
                <Mail
                  size={18}
                  className="text-slate-400"
                />

                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value
                    )
                  }
                  placeholder="tu@email.com"
                  className="h-12 flex-1 outline-none"
                />
              </div>
            </div>

            {/* PASSWORD */}

            <div>
              <label className="text-sm font-bold text-slate-700">
                Contraseña
              </label>

              <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 focus-within:border-indigo-400">
                <LockKeyhole
                  size={18}
                  className="text-slate-400"
                />

                <input
                  type={
                    showPassword
                      ? 'text'
                      : 'password'
                  }
                  required
                  autoComplete={
                    mode === 'login'
                      ? 'current-password'
                      : 'new-password'
                  }
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                  placeholder="••••••••"
                  className="h-12 flex-1 outline-none"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      !showPassword
                    )
                  }
                  className="text-slate-400 transition hover:text-slate-700"
                >
                  {showPassword ? (
                    <EyeOff size={18} />
                  ) : (
                    <Eye size={18} />
                  )}
                </button>
              </div>
            </div>

            {/* CONFIRM PASSWORD */}

            {mode === 'register' && (
              <div>
                <label className="text-sm font-bold text-slate-700">
                  Confirmar contraseña
                </label>

                <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 focus-within:border-indigo-400">
                  <LockKeyhole
                    size={18}
                    className="text-slate-400"
                  />

                  <input
                    type={
                      showPassword
                        ? 'text'
                        : 'password'
                    }
                    required
                    autoComplete="new-password"
                    value={
                      confirmPassword
                    }
                    onChange={(event) =>
                      setConfirmPassword(
                        event.target.value
                      )
                    }
                    placeholder="••••••••"
                    className="h-12 flex-1 outline-none"
                  />
                </div>
              </div>
            )}

            {/* ERROR */}

            {error && (
              <div className="rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}

            {/* SUCCESS */}

            {message && (
              <div className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                {message}
              </div>
            )}

            {/* SUBMIT */}

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <Loader2
                  size={17}
                  className="animate-spin"
                />
              )}

              {loading
                ? 'Procesando...'
                : mode === 'login'
                ? 'Iniciar sesión'
                : 'Crear cuenta'}
            </button>
          </form>

          {/* SWITCH */}

          <div className="mt-6 text-center text-sm text-slate-500">
            {mode === 'login' ? (
              <>
                ¿No tienes cuenta?{' '}

                <button
                  onClick={() =>
                    changeMode(
                      'register'
                    )
                  }
                  className="font-black text-indigo-600 hover:text-indigo-700"
                >
                  Crear cuenta
                </button>
              </>
            ) : (
              <>
                ¿Ya tienes una cuenta?{' '}

                <button
                  onClick={() =>
                    changeMode(
                      'login'
                    )
                  }
                  className="font-black text-indigo-600 hover:text-indigo-700"
                >
                  Iniciar sesión
                </button>
              </>
            )}
          </div>

          <div className="mt-8 border-t pt-6 text-center">
            <button
              onClick={() =>
                router.push('/')
              }
              className="text-sm font-bold text-slate-500 transition hover:text-slate-900"
            >
              Continuar sin iniciar sesión
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}