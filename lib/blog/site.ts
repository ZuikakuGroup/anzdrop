export function siteUrl(): URL {
  return new URL(process.env.SITE_URL ?? "http://localhost:3000");
}

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, siteUrl()).toString();
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}
