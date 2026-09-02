'use client';

import { useState } from 'react';
import { FileUp, Loader2, ShieldCheck, UploadCloud, X } from 'lucide-react';

import { api } from '@/lib/api';
import { RequireAuth } from '@/components/require-auth';

type ImportPosition = {
  ticker: string;
  quantity: number;
  average_cost: number;
  currency: string;
  company?: string | null;
  asset_type?: string | null;
  last_price?: number | null;
  confidence?: number;
};

type ImportPreview = {
  broker: string;
  source_filename: string;
  currency: string;
  positions: ImportPosition[];
  warnings: string[];
  read_only: boolean;
};

type BrokerImportPanelProps = {
  onImported?: () => void | Promise<void>;
  onClose?: () => void;
  embedded?: boolean;
};

export function BrokerImport() {
  return (
    <RequireAuth>
      <BrokerImportPanel />
    </RequireAuth>
  );
}

export function BrokerImportPanel({
  onImported,
  onClose,
  embedded = false,
}: BrokerImportPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [broker, setBroker] = useState('');
  const [accountName, setAccountName] = useState('Main account');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function analyze() {
    if (!file) {
      setError('Selecciona un estado de cuenta primero.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const form = new FormData();
      form.append('file', file);

      const result = await api<ImportPreview>('/portfolio/import/preview', {
        method: 'POST',
        body: form,
      });

      setPreview(result);
      setBroker(result.broker === 'generic' ? '' : result.broker);
    } catch (e: any) {
      setError(e?.message || 'No fue posible analizar el archivo.');
    } finally {
      setLoading(false);
    }
  }

  function updatePosition(index: number, patch: Partial<ImportPosition>) {
    setPreview((current) => {
      if (!current) return current;
      const positions = [...current.positions];
      positions[index] = { ...positions[index], ...patch };
      return { ...current, positions };
    });
  }

  async function confirmImport() {
    if (!preview || preview.positions.length === 0) return;
    if (!broker.trim()) {
      setError('Indica el nombre del broker.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const result = await api<{ imported: number; account_id: string }>(
        '/portfolio/import/confirm',
        {
          method: 'POST',
          body: JSON.stringify({
            broker: broker.trim(),
            account_name: accountName.trim() || 'Main account',
            positions: preview.positions.map((position) => ({
              ticker: position.ticker,
              quantity: Number(position.quantity),
              average_cost: Number(position.average_cost || 0),
              currency: position.currency || preview.currency || 'USD',
              company: position.company || position.ticker,
              asset_type: position.asset_type || null,
              last_price: position.last_price ?? null,
            })),
          }),
        }
      );

      setSuccess(`${result.imported} posiciones importadas correctamente.`);
      setPreview(null);
      setFile(null);
      await onImported?.();
    } catch (e: any) {
      setError(e?.message || 'No fue posible importar el portafolio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={embedded ? 'rounded-2xl border bg-slate-50 p-5' : 'space-y-6'}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-50 p-3">
            <UploadCloud className="text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-black">Importar estado de cuenta</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Para Hapi, Trii, Tyba y otros brokers sin conexión automática. PDF, CSV, XLSX o XLS, máximo 10 MB.
            </p>
          </div>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700"
            aria-label="Cerrar importador"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          {success}
        </div>
      )}

      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white px-6 py-8 text-center hover:border-indigo-300">
        <FileUp size={28} className="text-slate-400" />
        <span className="mt-3 font-black">{file ? file.name : 'Seleccionar PDF, CSV o Excel'}</span>
        <span className="mt-1 text-xs text-slate-400">
          Solo se extraen posiciones; nunca se ejecutan órdenes.
        </span>
        <input
          type="file"
          accept=".pdf,.csv,.xlsx,.xls"
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setPreview(null);
            setSuccess('');
          }}
        />
      </label>

      <button
        onClick={analyze}
        disabled={!file || loading}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
        {loading ? 'Analizando...' : 'Analizar archivo'}
      </button>

      {preview && (
        <div className="mt-6 border-t pt-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-3">
              <ShieldCheck className="text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-black">Revisar antes de importar</h3>
              <p className="mt-1 text-sm text-slate-500">
                Confirma que cantidades y costos correspondan al estado de cuenta.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">
              Broker
              <input
                value={broker}
                onChange={(e) => setBroker(e.target.value)}
                placeholder="Hapi, Trii, Tyba..."
                className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-medium"
              />
            </label>
            <label className="text-sm font-bold">
              Nombre de la cuenta
              <input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-medium"
              />
            </label>
          </div>

          {preview.warnings.length > 0 && (
            <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              {preview.warnings.map((warning) => (
                <p key={warning}>• {warning}</p>
              ))}
            </div>
          )}

          <div className="mt-5 overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-3">Ticker</th>
                  <th className="px-3 py-3">Cantidad</th>
                  <th className="px-3 py-3">Costo promedio</th>
                  <th className="px-3 py-3">Moneda</th>
                  <th className="px-3 py-3">Precio actual</th>
                </tr>
              </thead>
              <tbody>
                {preview.positions.map((position, index) => (
                  <tr key={`${position.ticker}-${index}`} className="border-t">
                    <td className="p-2">
                      <input
                        className="w-28 rounded-lg border px-2 py-2 font-bold"
                        value={position.ticker}
                        onChange={(e) => updatePosition(index, { ticker: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        className="w-28 rounded-lg border px-2 py-2"
                        value={position.quantity}
                        onChange={(e) => updatePosition(index, { quantity: Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        className="w-32 rounded-lg border px-2 py-2"
                        value={position.average_cost}
                        onChange={(e) => updatePosition(index, { average_cost: Number(e.target.value) })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        className="w-24 rounded-lg border px-2 py-2"
                        value={position.currency}
                        onChange={(e) => updatePosition(index, { currency: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        className="w-32 rounded-lg border px-2 py-2"
                        value={position.last_price ?? ''}
                        onChange={(e) =>
                          updatePosition(index, {
                            last_price: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.positions.length === 0 ? (
            <p className="mt-5 text-sm text-slate-500">
              No se detectaron posiciones. Para este documento conviene exportar CSV/XLSX desde el broker.
            </p>
          ) : (
            <button
              onClick={confirmImport}
              disabled={saving}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? 'Importando...' : `Importar ${preview.positions.length} posiciones`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
