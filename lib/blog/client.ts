import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { getAllLocalSeedPosts, getLocalSeedPosts, LOCAL_SEED_AUTHOR, LOCAL_SEED_CATEGORY, LOCAL_SEED_POSTS, LOCAL_SEED_TAG } from "./seed";
import type { BlogAuthor, BlogCategory, BlogPage, BlogPost, BlogTag } from "./types";
import { isAllowedExternalUrl, isMicrocmsImageUrl } from "./validation";

export { PAGE_SIZE } from "./pagination";
const API_PAGE_SIZE = 100;

const imageUrlSchema = z.string().url().refine(isMicrocmsImageUrl, "microCMS image URL is required");
const externalUrlSchema = z.string().url().refine(isAllowedExternalUrl, "HTTP(S) URL is required");
const imageSchema = z.object({ url: imageUrlSchema, width: z.number().optional(), height: z.number().optional(), alt: z.string().optional() });
const categorySchema = z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().default("") });
const tagSchema = categorySchema;
const authorSchema = z.object({ id: z.string().min(1), name: z.string().min(1), bio: z.string().default(""), image: imageSchema, externalUrl: externalUrlSchema.optional() });
const postSchema = z.object({ id: z.string().min(1), title: z.string().min(1), excerpt: z.string().min(1), body: z.string(), eyecatch: imageSchema, category: categorySchema, tags: z.array(tagSchema), author: authorSchema, publishedAt: z.string().datetime(), updatedAt: z.string().datetime() });
const publishedStatusSchema = z.object({ publishedAt: z.string().datetime().nullable().optional() }).passthrough();
const listSchema = <T extends z.ZodType>(item: T) => z.object({ contents: z.array(item), totalCount: z.number().int().nonnegative() });

type Query = Record<string, string | number | undefined>;
type BlogEnv = CloudflareEnv & { MICROCMS_API_KEY?: string };

function publishedPostQuery(query: Query): Query {
  const filters = query.filters;
  return { ...query, filters: typeof filters === "string" && filters ? `publishedAt[exists][and]${filters}` : "publishedAt[exists]" };
}

export class MicrocmsApiError extends Error {
  constructor(public readonly status: number) {
    super(`microCMS request failed: ${status}`);
    this.name = "MicrocmsApiError";
  }
}

export function isMicrocmsNotFoundError(error: unknown): boolean {
  return error instanceof MicrocmsApiError && error.status === 404;
}

export function isBlogSeedDataEnabled(seedDataValue = process.env.BLOG_USE_SEED_DATA, nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === "development" && seedDataValue === "true";
}

function shouldUseBlogSeedData(): boolean {
  return isBlogSeedDataEnabled();
}

async function get<T>(endpoint: string, schema: z.ZodType<T>, query: Query = {}): Promise<T> {
  const { env: cloudflareEnv } = getCloudflareContext();
  const env = cloudflareEnv as BlogEnv;
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

export const getPosts = (query: Query = {}) => shouldUseBlogSeedData() ? Promise.resolve(getLocalSeedPosts(query)) : get<BlogPage<BlogPost>>("blog-posts", listSchema(postSchema), { ...publishedPostQuery(query), orders: "-publishedAt", depth: 2 });
export const getAllPosts = (query: Query = {}) => shouldUseBlogSeedData() ? Promise.resolve(getAllLocalSeedPosts(query)) : getAll<BlogPost>("blog-posts", postSchema, { ...publishedPostQuery(query), orders: "-publishedAt,id", depth: 2 });
export const getPost = async (id: string): Promise<BlogPost> => {
  if (shouldUseBlogSeedData()) {
    const post = LOCAL_SEED_POSTS.find((candidate) => candidate.id === id);
    if (!post) throw new MicrocmsApiError(404);
    return post;
  }
  const post = await get(`blog-posts/${encodeURIComponent(id)}`, publishedStatusSchema, { depth: 2 });
  if (!post.publishedAt) throw new MicrocmsApiError(404);
  return postSchema.parse(post);
};
export const getCategory = async (id: string) => { if (shouldUseBlogSeedData()) { if (id === LOCAL_SEED_CATEGORY.id) return LOCAL_SEED_CATEGORY; throw new MicrocmsApiError(404); } return get<BlogCategory>(`blog-categories/${encodeURIComponent(id)}`, categorySchema); };
export const getTag = async (id: string) => { if (shouldUseBlogSeedData()) { if (id === LOCAL_SEED_TAG.id) return LOCAL_SEED_TAG; throw new MicrocmsApiError(404); } return get<BlogTag>(`blog-tags/${encodeURIComponent(id)}`, tagSchema); };
export const getAuthor = async (id: string) => { if (shouldUseBlogSeedData()) { if (id === LOCAL_SEED_AUTHOR.id) return LOCAL_SEED_AUTHOR; throw new MicrocmsApiError(404); } return get<BlogAuthor>(`blog-authors/${encodeURIComponent(id)}`, authorSchema); };
export const getCategories = () => shouldUseBlogSeedData() ? Promise.resolve({ contents: [LOCAL_SEED_CATEGORY], totalCount: 1 }) : get<BlogPage<BlogCategory>>("blog-categories", listSchema(categorySchema));
export const getTags = () => shouldUseBlogSeedData() ? Promise.resolve({ contents: [LOCAL_SEED_TAG], totalCount: 1 }) : get<BlogPage<BlogTag>>("blog-tags", listSchema(tagSchema));
export const getAuthors = () => shouldUseBlogSeedData() ? Promise.resolve({ contents: [LOCAL_SEED_AUTHOR], totalCount: 1 }) : get<BlogPage<BlogAuthor>>("blog-authors", listSchema(authorSchema));
export const getAllCategories = () => shouldUseBlogSeedData() ? Promise.resolve([LOCAL_SEED_CATEGORY]) : getAll<BlogCategory>("blog-categories", categorySchema, { orders: "id" });
export const getAllTags = () => shouldUseBlogSeedData() ? Promise.resolve([LOCAL_SEED_TAG]) : getAll<BlogTag>("blog-tags", tagSchema, { orders: "id" });
export const getAllAuthors = () => shouldUseBlogSeedData() ? Promise.resolve([LOCAL_SEED_AUTHOR]) : getAll<BlogAuthor>("blog-authors", authorSchema, { orders: "id" });
