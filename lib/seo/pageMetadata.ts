import type { Metadata } from "next";

const DEFAULT_OG_IMAGE = {
  url: "/apple-icon.png",
  width: 180,
  height: 180,
  alt: "Anzdrop",
} as const;

type PageMetadataInput = {
  title: string;
  description: string;
  path: `/${string}` | "/";
};

/**
 * 公開ページ向けの共通 Metadata。
 * 動的 OG 画像(`next/og` / opengraph-image)は Worker バンドルサイズ制約のため使わず、
 * 静的アイコンを og:image に指す。
 */
export function pageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "ja_JP",
      siteName: "Anzdrop",
      title,
      description,
      url: path,
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [DEFAULT_OG_IMAGE.url],
    },
  };
}
