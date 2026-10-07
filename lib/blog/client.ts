import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createBlogClient, isBlogSeedDataEnabled } from "./core";
export { PAGE_SIZE, MicrocmsApiError, isMicrocmsNotFoundError, isBlogSeedDataEnabled } from "./core";
export const { getPosts, getAllPosts, getPost, getCategory, getTag, getAuthor, getCategories, getTags, getAuthors, getAllCategories, getAllTags, getAllAuthors } = createBlogClient(() => getCloudflareContext().env, () => isBlogSeedDataEnabled());
