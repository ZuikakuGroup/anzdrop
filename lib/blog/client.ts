import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import type { BlogAuthor, BlogCategory, BlogPage, BlogPost, BlogTag } from "./types";
import { isAllowedExternalUrl, isMicrocmsImageUrl } from "./validation";

export const PAGE_SIZE = 12;
const API_PAGE_SIZE = 100;

const imageUrlSchema = z.string().url().refine(isMicrocmsImageUrl, "microCMS image URL is required");
const externalUrlSchema = z.string().url().refine(isAllowedExternalUrl, "HTTP(S) URL is required");
const imageSchema = z.object({ url: imageUrlSchema, width: z.number().optional(), height: z.number().optional(), alt: z.string().optional() });
const categorySchema = z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().default("") });
const tagSchema = categorySchema;
const authorSchema = z.object({ id: z.string().min(1), name: z.string().min(1), bio: z.string().default(""), image: imageSchema, externalUrl: externalUrlSchema.optional() });
const postSchema = z.object({ id: z.string().min(1), title: z.string().min(1), excerpt: z.string().min(1), body: z.string(), eyecatch: imageSchema, category: categorySchema, tags: z.array(tagSchema), author: authorSchema, publishedAt: z.string().datetime(), updatedAt: z.string().datetime() });
const listSchema = <T extends z.ZodType>(item: T) => z.object({ contents: z.array(item), totalCount: z.number().int().nonnegative() });

type Query = Record<string, string | number | undefined>;

export class MicrocmsApiError extends Error {
  constructor(public readonly status: number) {
    super(`microCMS request failed: ${status}`);
    this.name = "MicrocmsApiError";
  }
}

export function isMicrocmsNotFoundError(error: unknown): boolean {
  return error instanceof MicrocmsApiError && error.status === 404;
}

async function get<T>(endpoint: string, schema: z.ZodType<T>, query: Query = {}): Promise<T> {
  const { env: cloudflareEnv } = getCloudflareContext();
  const env = cloudflareEnv as CloudflareEnv & { MICROCMS_API_KEY?: string };
  if (!env.MICROCMS_SERVICE_DOMAIN || !env.MICROCMS_API_KEY) throw new Error("microCMS is not configured");
  const url = new URL(`/api/v1/${endpoint}`, `https://${env.MICROCMS_SERVICE_DOMAIN}`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
  // OpenNextの共有Tag Cacheを追加するとD1/R2/DOへ永続データを追加するため、
  // 現時点では保存を伴わないno-storeでmicroCMSの公開内容を直接返す。
  const response = await fetch(url, { headers: { "X-MICROCMS-API-KEY": env.MICROCMS_API_KEY }, cache: "no-store" });
  if (!response.ok) throw new MicrocmsApiError(response.status);
  return schema.parse(await response.json());
}

async function getAll<T>(endpoint: string, schema: z.ZodType<T>, query: Query = {}): Promise<T[]> {
  const contents: T[] = [];
  let offset = 0;

  while (true) {
    const page = await get<BlogPage<T>>(endpoint, listSchema(schema), { ...query, limit: API_PAGE_SIZE, offset });
    contents.push(...page.contents);
    offset += page.contents.length;
    if (offset >= page.totalCount || page.contents.length === 0) return contents;
  }
}

export const getPosts = (query: Query = {}) => get<BlogPage<BlogPost>>("blog-posts", listSchema(postSchema), { orders: "-publishedAt", depth: 2, ...query });
export const getAllPosts = (query: Query = {}) => getAll<BlogPost>("blog-posts", postSchema, { orders: "-publishedAt", depth: 2, ...query });
export const getPost = async (id: string) => get<BlogPost>(`blog-posts/${encodeURIComponent(id)}`, postSchema, { depth: 2 });
export const getCategory = async (id: string) => get<BlogCategory>(`blog-categories/${encodeURIComponent(id)}`, categorySchema);
export const getTag = async (id: string) => get<BlogTag>(`blog-tags/${encodeURIComponent(id)}`, tagSchema);
export const getAuthor = async (id: string) => get<BlogAuthor>(`blog-authors/${encodeURIComponent(id)}`, authorSchema);
export const getCategories = () => get<BlogPage<BlogCategory>>("blog-categories", listSchema(categorySchema));
export const getTags = () => get<BlogPage<BlogTag>>("blog-tags", listSchema(tagSchema));
export const getAuthors = () => get<BlogPage<BlogAuthor>>("blog-authors", listSchema(authorSchema));
export const getAllCategories = () => getAll<BlogCategory>("blog-categories", categorySchema);
export const getAllTags = () => getAll<BlogTag>("blog-tags", tagSchema);
export const getAllAuthors = () => getAll<BlogAuthor>("blog-authors", authorSchema);
