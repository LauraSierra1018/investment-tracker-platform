import { createClient } from '@/lib/supabase/client';
import { createApiClient } from '@/lib/api-request';

export const api = createApiClient(() => createClient().auth.getSession());
