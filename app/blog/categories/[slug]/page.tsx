import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TaxonomyPage from "@/components/blog/TaxonomyPage";
import { getAllPosts, getCategory, isMicrocmsNotFoundError } from "@/lib/blog/client";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { try { const category = await getCategory((await params).slug); return { title: `${category.name} | Anzdropブログ`, description: category.description, alternates: { canonical: `/blog/categories/${category.id}` } }; } catch (error) { if (isMicrocmsNotFoundError(error)) return {}; throw error; } }
async function categoryFor(slug: string) { let category; try { category = await getCategory(slug); } catch (error) { if (isMicrocmsNotFoundError(error)) return null; throw error; } const posts = await getAllPosts({ filters: `category[equals]${category.id}` }); return { category, posts }; }
export default async function Page({ params }: Props) { const result = await categoryFor((await params).slug); if (!result) notFound(); return <TaxonomyPage kind="カテゴリ" name={result.category.name} description={result.category.description} posts={result.posts} />; }
