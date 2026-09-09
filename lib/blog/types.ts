export type BlogImage = { url: string; width?: number; height?: number; alt?: string };

export type BlogCategory = { id: string; name: string; description: string };
export type BlogTag = { id: string; name: string; description: string };
export type BlogAuthor = {
  id: string;
  name: string;
  bio: string;
  image: BlogImage;
  externalUrl?: string;
};

export type BlogPost = {
  id: string;
  title: string;
  excerpt: string;
  body: string;
  eyecatch: BlogImage;
  category: BlogCategory;
  tags: BlogTag[];
  author: BlogAuthor;
  publishedAt: string;
  updatedAt: string;
};

export type BlogPage<T> = { contents: T[]; totalCount: number };
