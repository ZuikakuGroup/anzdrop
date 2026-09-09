import sanitizeHtml from "sanitize-html";

const MICROCMS_IMAGE_HOST = "images.microcms-assets.io";

function isMicrocmsImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === MICROCMS_IMAGE_HOST;
  } catch {
    return false;
  }
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "em", "del", "a", "img", "figure", "figcaption", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height"], "*": ["class"] },
    allowedClasses: { "*": ["language-*"] },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { img: ["https"] },
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}) } }),
      img: (_tagName, attribs) => isMicrocmsImage(attribs.src ?? "") ? { tagName: "img", attribs } : { tagName: "span", attribs: {}, text: "" },
    },
  });
}
