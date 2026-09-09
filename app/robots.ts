import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/blog/site";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: "/", disallow: ["/mypage", "/admin", "/api"] }, sitemap: absoluteUrl("/sitemap.xml") }; }
