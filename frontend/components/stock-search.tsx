'use client';

import {
  Search,
  TrendingUp,
  Landmark,
  Loader2,
} from 'lucide-react';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import { api } from '@/lib/api';

type SearchResult = {
  ticker: string;
  name: string;
  type: 'Stock' | 'ETF';
  exchange?: string;
  logo_url?: string | null;
};

type Props = {
  onSelect: (ticker: string) => void;
};

export function StockSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const timeoutRef = useRef<number | null>(null);

  async function search(value: string) {
    try {
      setLoading(true);

      const data = await api<SearchResult[]>(
        `/search?q=${encodeURIComponent(value)}`
      );

      setResults(data);
    } catch (error) {
      console.error('Error buscando activos:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      search(query);
    }, 250);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [query, open]);

  function select(result: SearchResult) {
    setQuery(result.ticker);
    setOpen(false);

    onSelect(result.ticker);
  }

  return (
    <div className="relative w-full">
      <div
        className={`
          flex items-center gap-3 rounded-2xl border bg-white px-4
          shadow-sm transition
          ${
            open
              ? 'border-indigo-400 ring-4 ring-indigo-100'
              : 'border-slate-200'
          }
        `}
      >
        <Search
          size={20}
          className="text-slate-400"
        />

        <input
          value={query}
          onFocus={() => {
            setOpen(true);

            if (results.length === 0) {
              search('');
            }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              query.trim()
            ) {
              setOpen(false);
              onSelect(query.trim().toUpperCase());
            }

            if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder="Busca Apple, AAPL, S&P 500 ETF..."
          className="h-14 flex-1 bg-transparent text-base outline-none"
        />

        {loading && (
          <Loader2
            size={18}
            className="animate-spin text-slate-400"
          />
        )}
      </div>

      {open && (
        <div
          className="
            absolute left-0 right-0 z-50 mt-2
            overflow-hidden rounded-2xl border
            border-slate-200 bg-white shadow-xl
          "
        >
          <div className="border-b px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {query.trim()
                ? 'Resultados'
                : 'Sugerencias'}
            </p>
          </div>

          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
              <Loader2
                size={17}
                className="animate-spin"
              />
              Buscando...
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No encontramos resultados.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {results.map((result) => (
                <button
                  key={`${result.ticker}-${result.exchange}`}
                  onClick={() => select(result)}
                  className="
                    flex w-full items-center gap-3
                    border-b border-slate-100
                    px-4 py-3 text-left
                    transition last:border-b-0
                    hover:bg-slate-50
                  "
                >
                  <AssetLogo result={result} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-black">
                        {result.ticker}
                      </span>

                      <span
                        className="
                          rounded-md bg-slate-100
                          px-2 py-0.5 text-[10px]
                          font-bold uppercase
                          text-slate-500
                        "
                      >
                        {result.type}
                      </span>
                    </div>

                    <p className="truncate text-sm text-slate-500">
                      {result.name}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-slate-400">
                      {result.exchange || 'Mercado'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetLogo({
  result,
}: {
  result: SearchResult;
}) {
  const [failed, setFailed] = useState(false);

  if (
    result.logo_url &&
    !failed
  ) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white">
        <img
          src={result.logo_url}
          alt={result.name}
          onError={() => setFailed(true)}
          className="h-7 w-7 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className="
        flex h-11 w-11 shrink-0
        items-center justify-center
        rounded-xl bg-slate-100
      "
    >
      {result.type === 'ETF' ? (
        <Landmark
          size={19}
          className="text-indigo-500"
        />
      ) : (
        <TrendingUp
          size={19}
          className="text-emerald-500"
        />
      )}
    </div>
  );
}