import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(
  request: NextRequest
) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // FastAPI verifies private API JWTs; public prices need no Supabase refresh here.
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
