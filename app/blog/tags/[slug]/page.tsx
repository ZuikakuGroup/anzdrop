import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TaxonomyPage from "@/components/blog/TaxonomyPage";
import { getPosts, getTag } from "@/lib/blog/client";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { try { const tag = await getTag((await params).slug); return { title: `${tag.name} | Anzdropブログ`, description: tag.description, alternates: { canonical: `/blog/tags/${tag.id}` } }; } catch { return {}; } }
async function tagFor(slug: string) { try { const tag = await getTag(slug); const posts = await getPosts({ filters: `tags[contains]${tag.id}`, limit: 100 }); return { tag, posts }; } catch { return null; } }
export default async function Page({ params }: Props) { const result = await tagFor((await params).slug); if (!result) notFound(); return <TaxonomyPage kind="タグ" name={result.tag.name} description={result.tag.description} posts={result.posts.contents} />; }
