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
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "em", "del", "a", "img", "figure", "figcaption", "hr", "table", "thead", "tbody", "tr", "th", "td"],
    allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height", "data-zoomable-image", "tabindex", "role", "aria-haspopup", "aria-label"], "*": ["class"] },
    allowedClasses: { "*": ["language-*"] },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { img: ["https"] },
    transformTags: {
      a: (_tagName, attribs) => ({ tagName: "a", attribs: { ...attribs, ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}) } }),
      img: (_tagName, attribs) => isMicrocmsImage(attribs.src ?? "") ? { tagName: "img", attribs: { ...attribs, "data-zoomable-image": "", tabindex: "0", role: "button", "aria-haspopup": "dialog", "aria-label": attribs.alt ? `${attribs.alt}を拡大表示` : "画像を拡大表示" } } : { tagName: "span", attribs: {}, text: "" },
    },
  });
}
