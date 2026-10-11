import path from "node:path";
import ts from "typescript";

export type Change = { path: string; previous?: string; status: string };
export type Snapshot = Map<string, string>;
export type Group = { paths: string[]; reasons: string[] };
export type Plan = { groups: Group[]; stop?: string };
export type ReviewSignal = {
  sha: string; state: string; description: string; trusted: boolean; date: string;
};
export type Review = { sha: string; user: string; state: string };

export function reviewState(head: string, signals: ReviewSignal[], reviews: Review[], bot: string) {
  const signal = signals.filter(s => s.sha === head && s.trusted)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (signal && /\b(review\s+skipped|review_skipped|review\s+not\s+performed)\b/i.test(signal.description)) return "省略";
  if (signal?.state === "pending" || signal?.state === "in_progress" || signal?.state === "queued") return "処理中";
  if (signal && !["success", "completed"].includes(signal.state)) return "判定不能";
  if (reviews.some(r => r.sha === head && r.user === bot && ["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(r.state))) return "完了を確認";
  // A bare success (or an unfamiliar progress message) is not proof of review.
  return "判定不能";
}

const source = /\.(?:[cm]?[jt]sx?|astro)$/;
const globalConfig = /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|wrangler[^/]*\.jsonc?|astro\.config\.[^/]+|vite(?:st)?\.config\.[^/]+|eslint\.config\.[^/]+)$/;

export function references(filename: string, text: string): { imports: string[]; dynamic: boolean } {
  const imports: string[] = [];
  let dynamic = false;
  // Astro markup is not TS syntax. Parse frontmatter and explicit script blocks separately.
  const segments = filename.endsWith(".astro")
    ? [text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "", ...Array.from(text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), m => m[1])]
    : [text];
  for (const segment of segments) {
    const node = ts.createSourceFile(filename.endsWith(".astro") ? "component.tsx" : filename, segment, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text);
      if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
        if (n.arguments.length === 1 && ts.isStringLiteralLike(n.arguments[0])) imports.push(n.arguments[0].text);
        else dynamic = true;
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["glob", "globEager"].includes(n.expression.name.text)) dynamic = true;
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL" && n.arguments?.length === 2) {
        if (ts.isStringLiteralLike(n.arguments[0])) imports.push(n.arguments[0].text);
        else dynamic = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }
  return { imports, dynamic };
}

type Aliases = Map<string, { root: string; targets: string[] }>;
function aliases(snapshot: Snapshot): Aliases {
  const result: Aliases = new Map([["@/*", { root: ".", targets: ["./*"] }]]);
  for (const [name, text] of snapshot) {
    if (!/(^|\/)tsconfig[^/]*\.json$/.test(name)) continue;
    const parsed = ts.parseConfigFileTextToJson(name, text);
    if (parsed.error) throw new Error(`tsconfig の解析に失敗: ${name}`);
    const options = parsed.config?.compilerOptions;
    if (options?.paths && typeof options.paths === "object") {
      for (const [key, targets] of Object.entries(options.paths)) {
        if (!Array.isArray(targets) || !targets.every(t => typeof t === "string")) throw new Error("パスエイリアスが不正です");
        // Scope aliases to the tsconfig's directory to avoid cross-app collisions.
        result.set(`${path.posix.dirname(name)}:${key}`, { root: path.posix.join(path.posix.dirname(name), options.baseUrl ?? "."), targets });
      }
    }
  }
  return result;
}

function resolve(filename: string, specifier: string, snapshot: Snapshot, mappings: Aliases): string | undefined {
  const candidates: string[] = [];
  if (specifier.startsWith(".")) candidates.push(path.posix.join(path.posix.dirname(filename), specifier));
  else {
    const ordered = [...mappings].sort((a, b) => b[1].root.length - a[1].root.length);
    for (const [scoped, { root, targets }] of ordered) {
      const colon = scoped.indexOf(":");
      const scope = colon >= 0 ? scoped.slice(0, colon) : ".";
      if (scope !== "." && !filename.startsWith(`${scope}/`)) continue;
      const key = colon >= 0 ? scoped.slice(colon + 1) : scoped;
      const [prefix, suffix = ""] = key.split("*");
      if (key.includes("*") ? !specifier.startsWith(prefix) || !specifier.endsWith(suffix) : specifier !== key) continue;
      const middle = key.includes("*") ? specifier.slice(prefix.length, specifier.length - suffix.length) : "";
      candidates.push(...targets.map(target => path.posix.join(root, target.replaceAll("*", () => middle))));
      break;
    }
  }
  for (const candidate of candidates) {
    const stem = candidate.replace(/\.[cm]?js$/, "");
    const variants = [candidate, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".astro", ".json", ".css"].map(ext => stem + ext), ...[".ts", ".tsx", ".js", ".astro"].map(ext => `${candidate}/index${ext}`)];
    const match = variants.find(v => snapshot.has(v));
    if (match) return match;
  }
  return undefined;
}

function localSpecifier(specifier: string, mappings: Aliases): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("#")) return true;
  return [...mappings.keys()].some(scoped => {
    const key = scoped.includes(":") ? scoped.slice(scoped.indexOf(":") + 1) : scoped;
    const [prefix, suffix = ""] = key.split("*");
    return key.includes("*") ? specifier.startsWith(prefix) && specifier.endsWith(suffix) : specifier === key;
  });
}

export function splitPlan(changes: Change[], before: Snapshot, after: Snapshot, limit: number): Plan {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("fileLimit が不正です");
  const ordered = [...changes].sort((a, b) => a.path.localeCompare(b.path, "en"));
  const byPath = new Map<string, number>();
  ordered.forEach((change, i) => { byPath.set(change.path, i); if (change.previous) byPath.set(change.previous, i); });
  const parents = ordered.map((_, i) => i);
  const reasons = new Set<string>();
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]));
  const join = (a: number, b: number, reason: string) => { if (root(a) !== root(b)) { parents[root(b)] = root(a); reasons.add(reason); } };
  const all = (i: number, reason: string) => ordered.forEach((_, j) => join(i, j, reason));
  const aliasBefore = aliases(before), aliasAfter = aliases(after);
  // Analyze both trees, including unchanged callers that bridge changed modules.
  for (const [snapshot, mappings] of [[before, aliasBefore], [after, aliasAfter]] as const) {
    for (const [filename, text] of snapshot) {
      if (!source.test(filename)) continue;
      const own = byPath.get(filename);
      const refs = references(filename, text);
      const targets = refs.imports.map(specifier => resolve(filename, specifier, snapshot, mappings));
      const touched = targets.flatMap(t => t !== undefined && byPath.has(t) ? [byPath.get(t)!] : []);
      if (own !== undefined) {
        for (const target of touched) join(own, target, "変更された参照元・参照先を同時に適用");
        if (refs.dynamic || refs.imports.some((s, i) => localSpecifier(s, mappings) && !targets[i])) all(own, "解決できないローカル依存を保守的に結合");
      } else if (touched.length > 1) {
        for (const target of touched.slice(1)) join(touched[0], target, "共通の利用側が変更モジュールを参照");
      }
    }
  }
  for (let i = 0; i < ordered.length; i++) {
    const name = ordered[i].path;
    if (globalConfig.test(name)) all(i, "設定・依存更新の影響範囲を保守的に結合");
    if (/\.md$/.test(name)) {
      const text = after.get(name) ?? before.get(name) ?? "";
      for (const match of text.matchAll(/\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (!match[1].startsWith("http")) {
          const target = byPath.get(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
          if (target !== undefined) join(i, target, "ドキュメントの参照先と同時に適用");
        }
      }
    }
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)) {
      const stem = name.replace(/^tests\//, "").replace(/\.(?:test|spec)(?=\.)/, "");
      const target = byPath.get(stem);
      if (target !== undefined) join(i, target, "対応テストと実装を同時に適用");
    }
  }
  const components = new Map<number, string[]>();
  ordered.forEach((change, i) => components.set(root(i), [...(components.get(root(i)) ?? []), change.path]));
  const units = [...components.values()].sort((a, b) => a[0].localeCompare(b[0], "en"));
  const groups: Group[] = [];
  for (const paths of units) {
    const last = groups.at(-1);
    // Rename includes two paths in a conservative file count.
    const cost = (items: string[]) => items.reduce((n, p) => n + (ordered[byPath.get(p)!].previous ? 2 : 1), 0);
    if (last && cost([...last.paths, ...paths]) <= limit) last.paths.push(...paths);
    else groups.push({ paths, reasons: [...reasons].sort() });
  }
  const oversized = groups.find(g => g.paths.reduce((n, p) => n + (ordered[byPath.get(p)!].previous ? 2 : 1), 0) > limit);
  return { groups, stop: oversized ? `依存する変更の塊が ${limit} ファイルを超えています` : groups.length < 2 ? "変更全体が1グループのため分割できません" : undefined };
}
