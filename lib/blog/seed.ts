import { PAGE_SIZE } from "./pagination";
import type { BlogAuthor, BlogCategory, BlogPage, BlogPost, BlogTag } from "./types";

export const LOCAL_SEED_CATEGORY: BlogCategory = {
  id: "local-seed-category",
  name: "ローカル確認用",
  description: "開発環境でブログ表示を確認するためのカテゴリです。",
};

export const LOCAL_SEED_TAG: BlogTag = {
  id: "local-seed-tag",
  name: "テストデータ",
  description: "開発環境用のテスト記事です。",
};

export const LOCAL_SEED_AUTHOR: BlogAuthor = {
  id: "local-seed-author",
  name: "Anzdrop 開発用",
  bio: "ローカル環境での表示確認用アカウントです。",
  image: { url: "/file.svg", alt: "Anzdrop 開発用" },
};

export const LOCAL_SEED_POSTS: BlogPost[] = Array.from(
  { length: PAGE_SIZE + 3 },
  (_, index) => {
    const number = index + 1;
    const timestamp = new Date(Date.UTC(2026, 8, 11, 12 - index)).toISOString();

    return {
      id: `local-seed-post-${number}`,
      title: `ローカル確認用の記事 ${number}`,
      excerpt: `ページネーションとブログカードの表示を確認するためのローカル記事 ${number} です。`,
      body: `<p>これはローカル開発環境だけで表示されるテスト記事 ${number} です。</p><h2>ページネーションの確認</h2><p>一覧の2ページ目、記事詳細、関連記事を確認できます。</p>`,
      eyecatch: { url: "/file.svg", alt: `ローカル確認用の記事 ${number}` },
      category: LOCAL_SEED_CATEGORY,
      tags: [LOCAL_SEED_TAG],
      author: LOCAL_SEED_AUTHOR,
      publishedAt: timestamp,
      updatedAt: timestamp,
    };
  }
);

type Query = Record<string, string | number | undefined>;

function matchingPosts(query: Query): BlogPost[] {
  const filters = typeof query.filters === "string" ? query.filters : "";
  const categoryId = filters.match(/category\[equals]([^[]+)/)?.[1];
  const tagId = filters.match(/tags\[contains]([^[]+)/)?.[1];
  const authorId = filters.match(/author\[equals]([^[]+)/)?.[1];
  const excludedId = filters.match(/id\[not_equals]([^[]+)/)?.[1];

  return LOCAL_SEED_POSTS.filter((post) => (
    (!categoryId || post.category.id === categoryId)
    && (!tagId || post.tags.some((tag) => tag.id === tagId))
    && (!authorId || post.author.id === authorId)
    && (!excludedId || post.id !== excludedId)
  ));
}

export function getLocalSeedPosts(query: Query = {}): BlogPage<BlogPost> {
  const posts = matchingPosts(query);
  const offset = typeof query.offset === "number" ? query.offset : 0;
  const limit = typeof query.limit === "number" ? query.limit : PAGE_SIZE;

  return { contents: posts.slice(offset, offset + limit), totalCount: posts.length };
}

export function getAllLocalSeedPosts(query: Query = {}): BlogPost[] {
  return matchingPosts(query);
}
