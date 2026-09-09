import Image from "next/image";
import Link from "next/link";
import type { BlogPost } from "@/lib/blog/types";
import { formatDate } from "@/lib/blog/site";

export function BlogPostCard({ post }: { post: BlogPost }) {
  return <article className="overflow-hidden rounded-lg border border-ink/10 bg-paper">
    <Link href={`/blog/${post.id}`} className="block aspect-[2/1] overflow-hidden bg-ink/[0.03]"><Image src={post.eyecatch.url} alt={post.eyecatch.alt ?? ""} width={post.eyecatch.width ?? 1200} height={post.eyecatch.height ?? 630} className="h-full w-full object-cover transition-transform hover:scale-[1.02]" /></Link>
    <div className="space-y-3 p-5"><Link href={`/blog/categories/${post.category.id}`} className="text-xs font-bold text-brand">{post.category.name}</Link><h2 className="text-lg font-black"><Link href={`/blog/${post.id}`} className="hover:underline">{post.title}</Link></h2><p className="line-clamp-2 text-sm leading-relaxed text-ink/60">{post.excerpt}</p><p className="text-xs text-ink/50">{formatDate(post.publishedAt)}</p></div>
  </article>;
}

export function BlogPostGrid({ posts }: { posts: BlogPost[] }) {
  return <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{posts.map((post) => <BlogPostCard key={post.id} post={post} />)}</div>;
}
