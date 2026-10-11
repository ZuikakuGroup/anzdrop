import { readFile, writeFile } from "node:fs/promises";

const pagePath = "components/landing/SecureFileSharingLandingPage.tsx";
const headerPath = "components/brand/SiteHeader.tsx";
const footerPath = "components/brand/SiteFooter.tsx";
const cssPath = "apps/public/src/globals.css";
const fontPath = "public/fonts/noto-sans-jp-lp/noto-sans-jp-lp.woff2";

const sourceText = (await Promise.all([
  readFile(pagePath, "utf8"),
  readFile(headerPath, "utf8"),
  readFile(footerPath, "utf8"),
])).join("");
const codePoints = new Set(
  [...sourceText].filter((character) => character.codePointAt(0) > 0x7f).map((character) => character.codePointAt(0)),
);
for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) {
  codePoints.add(codePoint);
}

const sortedCodePoints = [...codePoints].sort((a, b) => a - b);
const ranges = [];
let rangeStart = sortedCodePoints[0];
let rangeEnd = rangeStart;
for (const codePoint of sortedCodePoints.slice(1)) {
  if (codePoint === rangeEnd + 1) {
    rangeEnd = codePoint;
  } else {
    ranges.push([rangeStart, rangeEnd]);
    rangeStart = codePoint;
    rangeEnd = codePoint;
  }
}
ranges.push([rangeStart, rangeEnd]);

const toHex = (value) => value.toString(16).toUpperCase().padStart(4, "0");
const unicodeRanges = ranges.map(([start, end]) =>
  start === end ? `U+${toHex(start)}` : `U+${toHex(start)}-${toHex(end)}`,
);
const formattedRanges = [];
for (let index = 0; index < unicodeRanges.length; index += 8) {
  formattedRanges.push(`    ${unicodeRanges.slice(index, index + 8).join(", ")}`);
}

const query = new URLSearchParams({
  family: "Noto Sans JP:wght@400..800",
  text: String.fromCodePoint(...sortedCodePoints),
});
const cssResponse = await fetch(`https://fonts.googleapis.com/css2?${query}`, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
});
if (!cssResponse.ok) throw new Error(`Google Fonts CSS request failed: ${cssResponse.status}`);
const fontCss = await cssResponse.text();
const fontUrl = fontCss.match(/font-weight:\s*400 800;[\s\S]*?src:\s*url\((https:\/\/[^)]+)\)/)?.[1];
if (!fontUrl) throw new Error("Variable WOFF2 URL was not found in the Google Fonts response.");

const fontResponse = await fetch(fontUrl);
if (!fontResponse.ok) throw new Error(`Google Fonts file request failed: ${fontResponse.status}`);
const font = Buffer.from(await fontResponse.arrayBuffer());
if (font.subarray(0, 4).toString() !== "wOF2") {
  throw new Error("The downloaded font is not a WOFF2 file.");
}
await writeFile(fontPath, font);

const globals = await readFile(cssPath, "utf8");
const rangePattern = /(font-family: "Anzdrop Noto Sans JP LP";[\s\S]*?unicode-range:)\s*[^;]+;/;
if (!rangePattern.test(globals)) throw new Error("LP font unicode-range declaration was not found.");
await writeFile(
  cssPath,
  globals.replace(rangePattern, `$1\n${formattedRanges.join(",\n")};`),
);

console.log(`Wrote ${fontPath} (${font.length} bytes) for ${sortedCodePoints.length} code points.`);
