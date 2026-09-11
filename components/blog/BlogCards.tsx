import Image from "next/image";
import Link from "next/link";
import type { BlogPost } from "@/lib/blog/types";
import { formatDate } from "@/lib/blog/site";

export function BlogPostCard({ post }: { post: BlogPost }) {
  return <article className="overflow-hidden rounded-lg border border-ink/10 bg-paper">
    <Link href={`/blog/${post.id}`} className="group block h-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">
      <div className="aspect-video overflow-hidden bg-ink/[0.03]"><Image src={post.eyecatch.url} alt={post.eyecatch.alt ?? ""} width={post.eyecatch.width ?? 1200} height={post.eyecatch.height ?? 630} className="h-full w-full object-cover motion-safe:transition-transform motion-safe:group-hover:scale-[1.05]" /></div>
      <div className="space-y-3 p-5"><p className="text-xs font-bold text-brand">{post.category.name}</p><h2 className="text-lg font-black">{post.title}</h2><p className="line-clamp-2 text-sm leading-relaxed text-ink/60">{post.excerpt}</p><p className="text-xs text-ink/50">{formatDate(post.publishedAt)}</p></div>
    </Link>
  </article>;
}

export function BlogPostGrid({ posts }: { posts: BlogPost[] }) {
  return <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{posts.map((post) => <BlogPostCard key={post.id} post={post} />)}</div>;
}
