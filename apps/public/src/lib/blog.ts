import { env } from 'cloudflare:workers';
import { createBlogClient, isBlogSeedDataEnabled } from '@/lib/blog/core';

export const blog = createBlogClient(
  () => ({ MICROCMS_SERVICE_DOMAIN: env.MICROCMS_SERVICE_DOMAIN as string | undefined, MICROCMS_API_KEY: env.MICROCMS_API_KEY as string | undefined }),
  () => env.DEPLOYMENT_ENV !== 'production' && isBlogSeedDataEnabled(env.BLOG_USE_SEED_DATA as string | undefined, import.meta.env.DEV ? 'development' : 'production', env.WEB_AUDIT as string | undefined),
);
export { isMicrocmsNotFoundError, PAGE_SIZE } from '@/lib/blog/core';
