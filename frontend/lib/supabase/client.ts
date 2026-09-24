import { createBrowserClient } from '@supabase/ssr';
import { authFetch, withDeadline } from '@/lib/api-request';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: authFetch } },
  );
}

export function getCurrentUser() {
  return withDeadline(() => createClient().auth.getUser(), 8000);
}
