import Link from "next/link";
import BlogLayout from "./BlogLayout";
import { BlogPostGrid } from "./BlogCards";
import type { BlogPost } from "@/lib/blog/types";

export default function TaxonomyPage({ kind, name, description, posts }: { kind: "カテゴリ" | "タグ"; name: string; description: string; posts: BlogPost[] }) {
  return <BlogLayout><div className="mx-auto max-w-6xl space-y-8"><header className="space-y-2"><p className="text-xs font-bold tracking-widest text-brand">{kind.toUpperCase()}</p><h1 className="text-3xl font-black">{name}</h1>{description && <p className="text-sm text-ink/60">{description}</p>}<Link href="/blog" className="text-sm font-bold text-brand hover:underline">ブログ一覧へ</Link></header>{posts.length ? <BlogPostGrid posts={posts} /> : <p className="text-sm text-ink/60">記事はまだありません。</p>}</div></BlogLayout>;
}
