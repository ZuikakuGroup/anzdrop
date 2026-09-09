import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TaxonomyPage from "@/components/blog/TaxonomyPage";
import { getCategory, getPosts } from "@/lib/blog/client";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { try { const category = await getCategory((await params).slug); return { title: `${category.name} | Anzdropブログ`, description: category.description, alternates: { canonical: `/blog/categories/${category.id}` } }; } catch { return {}; } }
async function categoryFor(slug: string) { try { const category = await getCategory(slug); const posts = await getPosts({ filters: `category[equals]${category.id}`, limit: 100 }); return { category, posts }; } catch { return null; } }
export default async function Page({ params }: Props) { const result = await categoryFor((await params).slug); if (!result) notFound(); return <TaxonomyPage kind="カテゴリ" name={result.category.name} description={result.category.description} posts={result.posts.contents} />; }
