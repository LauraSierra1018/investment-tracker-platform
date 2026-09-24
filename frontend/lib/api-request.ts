type SessionResult = { data: { session: { access_token?: string } | null } };
export const NAVIGATION_EVENT = 'investment:navigation';

export function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  external?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  const cancelled = () => controller.abort(external?.reason ?? new DOMException('Consulta cancelada', 'AbortError'));
  if (external?.aborted) cancelled();
  else external?.addEventListener('abort', cancelled, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(
    'La consulta está tardando demasiado. Puedes seguir navegando e intentarlo de nuevo.', 'TimeoutError',
  )), milliseconds);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', aborted, { once: true });
    if (controller.signal.aborted) aborted();
    else Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    }).then(resolve, reject);
  }).finally(() => {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancelled);
  });
}

export const authFetch: typeof fetch = (input, init) =>
  withDeadline(signal => fetch(input, { ...init, signal }), 8000, init?.signal);

export function isPublicMarketRequest(path: string, method = 'GET') {
  if (method.toUpperCase() !== 'GET') return false;
  const pathname = path.split('?')[0];
  return pathname === '/health' || pathname === '/search'
    || /^\/market\/(overview|status)$/.test(pathname)
    || /^\/stocks\/[^/]+(?:\/(history|risk|statements))?$/.test(pathname);
}

export function createApiClient(
  getSession: () => Promise<SessionResult>,
  fetcher: typeof fetch = fetch,
  timeoutOverride?: number,
) {
  return async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const method = (options?.method || 'GET').toUpperCase();
    const timeout = timeoutOverride ?? (
      path === '/portfolio/import/preview' ? 150000 :
      path === '/ai/analyze' || path === '/portfolio/assistant' ? 120000 :
      path === '/portfolio/broker/sync' ? 90000 : 20000
    );
    const navigation = new AbortController();
    const cancel = () => navigation.abort(new DOMException('Consulta cancelada al cambiar de sección', 'AbortError'));
    const external = () => navigation.abort(options?.signal?.reason);
    if (options?.signal?.aborted) external();
    else options?.signal?.addEventListener('abort', external, { once: true });
    // Navigation cancels reads only; writes are never automatically retried.
    if (method === 'GET' && typeof window !== 'undefined') {
      window.addEventListener(NAVIGATION_EVENT, cancel);
      window.addEventListener('popstate', cancel);
    }
    try {
      return await withDeadline(async signal => {
        const headers = new Headers(options?.headers);
        if (!(options?.body instanceof FormData)) headers.set('Content-Type', 'application/json');
        // Public data does not wait for session refresh or an authentication lock.
        if (!isPublicMarketRequest(path, method)) {
          const { data: { session } } = await getSession();
          signal.throwIfAborted();
          if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
        }
        const response = await fetcher(`/api${path}`, { ...options, headers, signal, cache: 'no-store' });
        if (!response.ok) {
          let message = `Error ${response.status}`;
          try {
            const data = await response.json();
            if (typeof data.detail === 'string') message = data.detail;
            else if (typeof data.message === 'string') message = data.message;
          } catch { /* Non-JSON gateway error. */ }
          throw new Error(message);
        }
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      }, timeout, navigation.signal);
    } finally {
      options?.signal?.removeEventListener('abort', external);
      if (typeof window !== 'undefined') {
        window.removeEventListener(NAVIGATION_EVENT, cancel);
        window.removeEventListener('popstate', cancel);
      }
    }
  };
}
