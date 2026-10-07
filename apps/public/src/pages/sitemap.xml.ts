import type { APIRoute } from 'astro';
import { blog } from '../lib/blog';
const escapeXml = (value: string) => value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);
export const GET: APIRoute = async ({ site }) => {
  const [posts, categories, tags, authors] = await Promise.all([blog.getAllPosts(), blog.getAllCategories(), blog.getAllTags(), blog.getAllAuthors()]);
  const entries = [
    ...['/', '/about', '/pricing', '/blog', '/lp/secure-file-sharing', '/contact', '/legal/terms', '/legal/privacy', '/legal/tokushoho'].map(path => ({ path, updatedAt: '' })),
    ...posts.map(post => ({ path: `/blog/${encodeURIComponent(post.id)}`, updatedAt: post.updatedAt })),
    ...categories.map(item => ({ path: `/blog/categories/${encodeURIComponent(item.id)}`, updatedAt: '' })),
    ...tags.map(item => ({ path: `/blog/tags/${encodeURIComponent(item.id)}`, updatedAt: '' })),
    ...authors.map(item => ({ path: `/blog/authors/${encodeURIComponent(item.id)}`, updatedAt: '' })),
  ];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map(item => `<url><loc>${escapeXml(new URL(item.path, site).href)}</loc>${item.updatedAt ? `<lastmod>${escapeXml(item.updatedAt)}</lastmod>` : ''}</url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
