export const PAGE_SIZE = 12;

export function parseBlogPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return 1;

  const page = Number(value);
  const offset = (page - 1) * PAGE_SIZE;
  return Number.isSafeInteger(page) && page >= 1 && Number.isSafeInteger(offset) ? page : 1;
}
