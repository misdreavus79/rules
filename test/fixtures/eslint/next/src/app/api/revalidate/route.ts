import { revalidateTag } from 'next/cache';

export function POST(): Response {
  revalidateTag('catalog', 'max');
  revalidateTag('catalog', { expire: 0 });
  return new Response(null, { status: 204 });
}
