import { createClient } from '@/lib/supabase/client';

const API = '/api';

export async function api<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(options?.headers);

  if (!(options?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  /*
   * Si hay usuario autenticado enviamos su JWT
   * automáticamente a FastAPI.
   */
  if (session?.access_token) {
    headers.set(
      'Authorization',
      `Bearer ${session.access_token}`
    );
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = `Error ${response.status}`;

    try {
      const data = await response.json();

      message =
        data.detail ||
        data.message ||
        message;
    } catch {
      // respuesta sin JSON
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}