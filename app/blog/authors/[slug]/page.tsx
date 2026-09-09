import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import BlogLayout from "@/components/blog/BlogLayout";
import { BlogPostGrid } from "@/components/blog/BlogCards";
import { getAuthor, getPosts } from "@/lib/blog/client";
import { isAllowedExternalUrl } from "@/lib/blog/validation";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { try { const author = await getAuthor((await params).slug); return { title: `${author.name} | Anzdropブログ`, description: author.bio, alternates: { canonical: `/blog/authors/${author.id}` } }; } catch { return {}; } }
async function authorFor(slug: string) { try { const author = await getAuthor(slug); const posts = await getPosts({ filters: `author[equals]${author.id}`, limit: 100 }); return { author, posts }; } catch { return null; } }
export default async function Page({ params }: Props) { const result = await authorFor((await params).slug); if (!result) notFound(); const { author, posts } = result; const externalUrl = author.externalUrl && isAllowedExternalUrl(author.externalUrl) ? author.externalUrl : undefined; return <BlogLayout><div className="mx-auto max-w-6xl space-y-8"><header className="flex items-start gap-5 rounded-lg border border-ink/10 p-6"><Image src={author.image.url} alt="" width={96} height={96} className="h-24 w-24 rounded-full object-cover" /><div className="space-y-2"><h1 className="text-3xl font-black">{author.name}</h1><p className="text-sm leading-relaxed text-ink/60">{author.bio}</p>{externalUrl && <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-brand hover:underline">プロフィールを見る</a>}</div></header>{posts.contents.length ? <BlogPostGrid posts={posts.contents} /> : <p className="text-sm text-ink/60">公開中の記事はまだありません。</p>}</div></BlogLayout>; }
