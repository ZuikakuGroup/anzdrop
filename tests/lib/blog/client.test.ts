import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllAuthors, getAllCategories, getAllPosts, getAllTags, getPost, isMicrocmsNotFoundError, MicrocmsApiError } from "@/lib/blog/client";
import { isAllowedExternalUrl } from "@/lib/blog/validation";

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      MICROCMS_SERVICE_DOMAIN: "example",
      MICROCMS_API_KEY: "api-key",
    },
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAllowedExternalUrl", () => {
  it("allows only HTTP(S) URLs", () => {
    expect(isAllowedExternalUrl("https://example.com/profile")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com/profile")).toBe(true);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,test")).toBe(false);
  });
});

describe("microCMS client", () => {
  const post = {
    id: "post-1",
    title: "Post",
    excerpt: "Excerpt",
    body: "Body",
    eyecatch: { url: "https://images.microcms-assets.io/assets/example/image.png" },
    category: { id: "category-1", name: "Category", description: "" },
    tags: [],
    author: { id: "author-1", name: "Author", bio: "", image: { url: "https://images.microcms-assets.io/assets/example/image.png" } },
    publishedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("preserves the HTTP status on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const error = await getPost("post-id").catch(cause => cause);

    expect(error).toBeInstanceOf(MicrocmsApiError);
    expect(error.status).toBe(503);
    expect(isMicrocmsNotFoundError(error)).toBe(false);
    expect(isMicrocmsNotFoundError(new MicrocmsApiError(404))).toBe(true);
  });

  it("fetches all pages by advancing the offset", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `category-${index}`,
      name: `Category ${index}`,
      description: "",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ contents: firstPage, totalCount: 101 }))
      .mockResolvedValueOnce(Response.json({ contents: [{ id: "category-100", name: "Category 100", description: "" }], totalCount: 101 }));
    vi.stubGlobal("fetch", fetchMock);

    const categories = await getAllCategories();

    expect(categories).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("offset")).toBe("0");
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("offset")).toBe("100");
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("orders")).toBe("id");
  });

  it.each([
    ["posts", getAllPosts, { contents: [post], totalCount: 1 }, "-publishedAt,id"],
    ["tags", getAllTags, { contents: [{ id: "tag-1", name: "Tag", description: "" }], totalCount: 1 }, "id"],
    ["authors", getAllAuthors, { contents: [{ id: "author-1", name: "Author", bio: "", image: { url: "https://images.microcms-assets.io/assets/example/image.png" } }], totalCount: 1 }, "id"],
  ])("uses a stable order when fetching all %s", async (_name, getAll, response, orders) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);

    await getAll();

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("orders")).toBe(orders);
  });
});
