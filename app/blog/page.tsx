import type { Metadata } from "next";
import { redirect } from "next/navigation";
import BlogPagination from "./BlogPagination";
import BlogLayout from "@/components/blog/BlogLayout";
import { BlogPostGrid } from "@/components/blog/BlogCards";
import { PAGE_SIZE, getPosts } from "@/lib/blog/client";
import { parseBlogPage } from "@/lib/blog/pagination";

export const metadata: Metadata = { title: "ブログ | Anzdrop", description: "Anzdropのファイル共有、プライバシー、セキュリティに関するブログです.", alternates: { canonical: "/blog" } };
export default async function BlogIndex({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseBlogPage((await searchParams).page);
  const posts = await getPosts({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const lastPage = Math.max(1, Math.ceil(posts.totalCount / PAGE_SIZE));
  if (page > lastPage) redirect(lastPage === 1 ? "/blog" : `/blog?page=${lastPage}`);
  return <BlogLayout><div className="mx-auto max-w-6xl space-y-8"><header className="space-y-2"><p className="text-xs font-bold tracking-widest text-brand">BLOG</p><h1 className="text-3xl font-black">Anzdropブログ</h1><p className="text-sm text-ink/60">ファイル共有とプライバシーを、もっと身近に。</p></header>{posts.contents.length ? <BlogPostGrid posts={posts.contents} /> : <p className="text-sm text-ink/60">公開中の記事はまだありません。</p>}{lastPage > 1 && <BlogPagination key={page} page={page} lastPage={lastPage} />}</div></BlogLayout>;
}
