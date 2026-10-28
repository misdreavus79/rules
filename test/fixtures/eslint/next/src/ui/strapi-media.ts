export function mediaBase(): string {
  return process.env.NEXT_PUBLIC_STRAPI_URL ?? '';
}
