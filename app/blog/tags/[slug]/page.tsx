import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TaxonomyPage from "@/components/blog/TaxonomyPage";
import { getAllPosts, getTag, isMicrocmsNotFoundError } from "@/lib/blog/client";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { try { const tag = await getTag((await params).slug); return { title: `${tag.name} | Anzdropブログ`, description: tag.description, alternates: { canonical: `/blog/tags/${tag.id}` } }; } catch (error) { if (isMicrocmsNotFoundError(error)) return {}; throw error; } }
async function tagFor(slug: string) { let tag; try { tag = await getTag(slug); } catch (error) { if (isMicrocmsNotFoundError(error)) return null; throw error; } const posts = await getAllPosts({ filters: `tags[contains]${tag.id}` }); return { tag, posts }; }
export default async function Page({ params }: Props) { const result = await tagFor((await params).slug); if (!result) notFound(); return <TaxonomyPage kind="タグ" name={result.tag.name} description={result.tag.description} posts={result.posts} />; }
