import { describe, expect, it } from "vitest";
import { sanitizeReportText } from "@/lib/sanitize";

describe("sanitizeReportText", () => {
  it("removes the fragment from a share URL, dropping the decryption key", () => {
    expect(
      sanitizeReportText(
        "https://example.com/d/abc123#odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUy"
      )
    ).toBe("https://example.com/d/abc123");
  });

  it("removes fragments from multiple URLs in the same text", () => {
    const input =
      "見て https://example.com/d/aaa#odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUy と https://example.com/d/bbb#ifDLkDmWJ6UuVTAIjvFu7WICPhDeOZIiBOB_Y6sHrFH です";

    expect(sanitizeReportText(input)).toBe(
      "見て https://example.com/d/aaa と https://example.com/d/bbb です"
    );
  });

  it("leaves text without a URL fragment or key-like token unchanged", () => {
    expect(
      sanitizeReportText("https://example.com/d/abc123 を報告します")
    ).toBe("https://example.com/d/abc123 を報告します");
    expect(sanitizeReportText("普通の理由のテキストです")).toBe(
      "普通の理由のテキストです"
    );
  });

  it("removes fragments regardless of scheme case", () => {
    expect(
      sanitizeReportText(
        "HTTPS://example.com/d/abc123#odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUy"
      )
    ).toBe("HTTPS://example.com/d/abc123");
  });

  it("does not touch a '#' that is not part of a URL", () => {
    expect(sanitizeReportText("issue #123 について")).toBe(
      "issue #123 について"
    );
    expect(
      sanitizeReportText("https://example.com/d/abc123 # これは鍵ではない")
    ).toBe("https://example.com/d/abc123 # これは鍵ではない");
  });

  it("removes only the key when a sentence follows immediately with no space", () => {
    expect(
      sanitizeReportText(
        "https://example.com/d/abc123#odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUyが大変なことになっています"
      )
    ).toBe("https://example.com/d/abc123が大変なことになっています");
  });

  it("redacts a bare key-length token even without a URL around it", () => {
    expect(
      sanitizeReportText(
        "id1234の復号鍵は odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUy です"
      )
    ).toBe("id1234の復号鍵は  です");
  });

  it("redacts a bare key glued directly to surrounding Japanese text", () => {
    expect(
      sanitizeReportText(
        "鍵odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUyが大変です"
      )
    ).toBe("鍵が大変です");
  });

  it("does not redact a token one character shorter than the key length", () => {
    const shorter = "2ZUCr_lgotu2iXW7GboIRoL3u6aHwnMztVuaP-coUN"; // 42 chars

    expect(sanitizeReportText(`鍵っぽい文字列: ${shorter} です`)).toBe(
      `鍵っぽい文字列: ${shorter} です`
    );
  });

  it("redacts the whole run when a token is longer than the key length, not just an exact-length window", () => {
    const longer = "EhEkk-iqq8vH2BzNZV45pFCiRcDCajhDieQjEJ-Bq8F8"; // 44 chars

    expect(sanitizeReportText(`鍵っぽい文字列: ${longer} です`)).toBe(
      "鍵っぽい文字列:  です"
    );
  });

  it("redacts the key even when a single extra base64url character is glued to one end", () => {
    const key = "odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUy"; // 43 chars

    // 1文字多いだけで「ちょうど43文字」の完全一致から外れても、鍵を含む
    // 連続部分ごと除去できる必要がある(1文字くっついただけで鍵が
    // まるごと素通りしてしまう、というリグレッションを防ぐ)。
    expect(sanitizeReportText(`鍵は${key}Zです`)).toBe("鍵はです");
    expect(sanitizeReportText(`鍵はa${key}です`)).toBe("鍵はです");
  });

  it("redacts two keys glued back-to-back", () => {
    const keyA = "odJFCrnl2edlBDdz1C5Jau2RJtBRnlWmTSHf6pWkLUy";
    const keyB = "ifDLkDmWJ6UuVTAIjvFu7WICPhDeOZIiBOB_Y6sHrFH";

    expect(sanitizeReportText(`鍵は${keyA}${keyB}です`)).toBe("鍵はです");
  });

  it("does not redact a 10-character shareId-like token", () => {
    expect(sanitizeReportText("共有ID abc123XY_9 についての通報です")).toBe(
      "共有ID abc123XY_9 についての通報です"
    );
  });
});
