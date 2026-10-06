import { describe, expect, it } from "vitest";
import { pageMetadata } from "@/lib/seo/pageMetadata";

describe("pageMetadata", () => {
  it("sets canonical, Open Graph, and Twitter Card fields for a public page", () => {
    const metadata = pageMetadata({
      title: "料金プラン | Anzdrop",
      description: "Anzdropの料金プラン",
      path: "/pricing",
    });

    expect(metadata.alternates).toEqual({ canonical: "/pricing" });
    expect(metadata.openGraph).toMatchObject({
      title: "料金プラン | Anzdrop",
      description: "Anzdropの料金プラン",
      url: "/pricing",
    });
    expect(metadata.openGraph?.images).toEqual([
      { url: "/apple-icon.png", width: 180, height: 180, alt: "Anzdrop" },
    ]);
    expect(metadata.twitter).toMatchObject({
      card: "summary",
      title: "料金プラン | Anzdrop",
      images: ["/apple-icon.png"],
    });
  });
});
