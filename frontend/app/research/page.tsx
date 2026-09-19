import { redirect } from 'next/navigation';

export default async function ResearchRoute({ searchParams }: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  redirect('/?tab=research' + (ticker ? '&ticker=' + encodeURIComponent(ticker) : ''));
}
