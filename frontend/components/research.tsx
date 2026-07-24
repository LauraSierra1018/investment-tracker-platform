'use client';

import { useState } from 'react';
import {
  Plus,
  Brain,
  Loader2,
  Check,
  LockKeyhole,
  LogIn,
} from 'lucide-react';

import { useRouter } from 'next/navigation';

import { api } from '@/lib/api';
import type { Stock } from '@/types';
import { StockSearch } from '@/components/stock-search';
import { createClient } from '@/lib/supabase/client';

const badge = {
  cumple: 'bg-emerald-100 text-emerald-800',
  revisar: 'bg-amber-100 text-amber-800',
  no_cumple: 'bg-rose-100 text-rose-800',
  sin_dato: 'bg-slate-100 text-slate-600',
};

export function Research() {
  const router = useRouter();

  const [q, setQ] = useState('');
  const [stock, setStock] = useState<Stock | null>(null);

  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [error, setError] = useState('');
  const [aiError, setAiError] = useState('');

  const [loginRequired, setLoginRequired] = useState(false);

  const [ai, setAi] = useState<any>(null);

  async function runTicker(ticker: string) {
    if (!ticker.trim()) return;

    setLoading(true);
    setError('');
    setAiError('');
    setAi(null);

    setSaved(false);
    setLoginRequired(false);

    try {
      const result = await api<Stock>(
        `/stocks/${encodeURIComponent(
          ticker.trim().toUpperCase()
        )}`
      );

      setStock(result);
    } catch (e: any) {
      console.error('Error buscando activo:', e);

      setError(
        e?.message ||
          'No fue posible obtener la información de este activo.'
      );

      setStock(null);
    } finally {
      setLoading(false);
    }
  }

  async function add() {
    if (!stock || saving || saved) return;

    setError('');
    setLoginRequired(false);

    /*
      Primero comprobamos si existe una sesión.
      Research sigue siendo público, pero guardar requiere cuenta.
    */

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setLoginRequired(true);
        return;
      }

      setSaving(true);

      await api('/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          ticker: stock.ticker,
        }),
      });

      setSaved(true);
    } catch (e: any) {
      console.error('Error guardando en watchlist:', e);

      setError(
        e?.message ||
          'No fue posible guardar este activo en la watchlist.'
      );
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
      const result = await api<any>('/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({
          ticker: stock.ticker,
        }),
      });

      setAi(result);
    } catch (e: any) {
      console.error('Error en análisis IA:', e);

      setAiError(
        e?.message ||
          'No fue posible generar el análisis con inteligencia artificial.'
      );
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div>
      {/* SEARCH */}

      <div className="card p-6">
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-slate-400">
            Research
          </p>

          <h1 className="mt-1 text-3xl font-black">
            Investiga acciones y ETFs
          </h1>

          <p className="mt-2 text-slate-500">
            Busca por nombre, ticker o ETF. No necesitas conocer el símbolo
            exacto.
          </p>
        </div>

        <div className="mt-6">
          <StockSearch
            onSelect={(ticker) => {
              setQ(ticker);
              runTicker(ticker);
            }}
          />
        </div>

        {loading && (
          <div className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-500">
            <Loader2
              size={17}
              className="animate-spin"
            />
            Cargando información del activo...
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}
      </div>

      {/* RESULT */}

      {stock && (
        <>
          <div className="mt-5 card p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm font-bold text-slate-500">
                  {stock.ticker} · {stock.exchange || 'Mercado'}
                </div>

                <h2 className="mt-1 text-3xl font-black">
                  {stock.company}
                </h2>

                <p className="mt-1 text-slate-500">
                  {stock.sector || 'Sector sin dato'} ·{' '}
                  {stock.industry || 'Industria sin dato'}
                </p>
              </div>

              <div className="text-left md:text-right">
                <div className="text-3xl font-black">
                  {stock.price != null
                    ? `${stock.currency} ${stock.price.toFixed(2)}`
                    : 'Sin precio'}
                </div>

                <div className="mt-1 text-sm text-slate-500">
                  Fuente: {stock.source}
                </div>
              </div>
            </div>

            {/* METRICS */}

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                [
                  'Puntaje',
                  stock.score != null
                    ? stock.score.toFixed(1)
                    : 'Sin dato',
                ],
                [
                  'Clasificación',
                  stock.classification || 'Sin dato',
                ],
                [
                  'Capitalización',
                  stock.market_cap
                    ? `USD ${(stock.market_cap / 1e9).toFixed(2)} B`
                    : 'Sin dato',
                ],
                [
                  'P/E',
                  stock.pe_ratio
                    ? `${stock.pe_ratio.toFixed(1)}x`
                    : 'Sin dato',
                ],
                [
                  'Free float',
                  stock.free_float_percent
                    ? `${stock.free_float_percent.toFixed(1)}%`
                    : 'Sin dato',
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl bg-slate-50 p-4"
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {label}
                  </div>

                  <div className="mt-1 text-lg font-black">
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* ACTIONS */}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={add}
                disabled={saving || saved}
                className={`
                  flex items-center gap-2 rounded-xl px-4 py-2 font-bold transition
                  ${
                    saved
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                  }
                  disabled:cursor-default
                `}
              >
                {saving ? (
                  <>
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                    Guardando...
                  </>
                ) : saved ? (
                  <>
                    <Check size={17} />
                    Guardado
                  </>
                ) : (
                  <>
                    <Plus size={17} />
                    Guardar en watchlist
                  </>
                )}
              </button>

              <button
                onClick={analyze}
                disabled={aiLoading}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aiLoading ? (
                  <>
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                    Analizando...
                  </>
                ) : (
                  <>
                    <Brain size={17} />
                    Análisis IA
                  </>
                )}
              </button>
            </div>

            {/* LOGIN REQUIRED */}

            {loginRequired && (
              <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white">
                      <LockKeyhole
                        size={19}
                        className="text-indigo-600"
                      />
                    </div>

                    <div>
                      <h3 className="font-black text-slate-900">
                        Inicia sesión para guardar {stock.ticker}
                      </h3>

                      <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
                        Puedes investigar cualquier activo sin una cuenta.
                        Para mantener una watchlist personal y utilizar el
                        portafolio necesitas iniciar sesión.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => router.push('/login')}
                    className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700"
                  >
                    <LogIn size={16} />
                    Iniciar sesión
                  </button>
                </div>
              </div>
            )}

            {aiError && (
              <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
                {aiError}
              </div>
            )}
          </div>

          {/* CRITERIA */}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {stock.criteria.map((criterion) => (
              <article
                key={criterion.key}
                className="card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {criterion.category}
                    </p>

                    <h3 className="mt-1 text-lg font-black">
                      {criterion.name}
                    </h3>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      badge[
                        criterion.status as keyof typeof badge
                      ] || badge.sin_dato
                    }`}
                  >
                    {criterion.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="mt-3 text-2xl font-black">
                  {criterion.formatted_value}
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {criterion.explanation}
                </p>

                <div className="mt-3 rounded-xl bg-slate-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Regla
                  </p>

                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {criterion.rule}
                  </p>
                </div>
              </article>
            ))}
          </div>

          {/* AI */}

          {ai && (
            <div className="mt-5 card p-6">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
                  <Brain
                    size={20}
                    className="text-indigo-600"
                  />
                </div>

                <div>
                  <h3 className="text-xl font-black">
                    Análisis con IA
                  </h3>

                  <p className="text-sm text-slate-500">
                    Interpretación de los datos financieros disponibles.
                  </p>
                </div>
              </div>

              {ai.available === false && (
                <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-800">
                  El módulo de IA no está disponible actualmente.
                  El análisis cuantitativo continúa funcionando.
                </div>
              )}

              {ai.summary && (
                <div className="mt-5">
                  <h4 className="font-black">
                    Resumen
                  </h4>

                  <p className="mt-2 leading-7 text-slate-700">
                    {ai.summary}
                  </p>
                </div>
              )}

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div className="rounded-xl bg-emerald-50 p-5">
                  <h4 className="font-black text-emerald-900">
                    Fortalezas
                  </h4>

                  {ai.thesis?.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-emerald-900">
                      {ai.thesis.map(
                        (item: string, index: number) => (
                          <li key={`${item}-${index}`}>
                            {item}
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-emerald-800">
                      No se identificaron fortalezas adicionales.
                    </p>
                  )}
                </div>

                <div className="rounded-xl bg-rose-50 p-5">
                  <h4 className="font-black text-rose-900">
                    Riesgos
                  </h4>

                  {ai.risks?.length > 0 ? (
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-rose-900">
                      {ai.risks.map(
                        (item: string, index: number) => (
                          <li key={`${item}-${index}`}>
                            {item}
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-rose-800">
                      No se identificaron riesgos adicionales.
                    </p>
                  )}
                </div>
              </div>

              {ai.questions?.length > 0 && (
                <div className="mt-5 rounded-xl bg-slate-50 p-5">
                  <h4 className="font-black">
                    Qué deberías investigar
                  </h4>

                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                    {ai.questions.map(
                      (item: string, index: number) => (
                        <li key={`${item}-${index}`}>
                          {item}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}