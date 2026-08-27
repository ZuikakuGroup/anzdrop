import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  formatDateTime,
  rightTypeLabel,
  shareStatusLabel,
  type ShareInfo,
} from "@/lib/admin/reportLabels";

describe("formatDateTime", () => {
  it("formats a valid ISO date string using the ja-JP short date/time style", () => {
    const iso = "2026-03-15T09:30:00.000Z";
    const expected = new Date(iso).toLocaleString("ja-JP", {
      dateStyle: "short",
      timeStyle: "short",
    });

    expect(formatDateTime(iso)).toBe(expected);
  });

  it("does not throw for an unparseable date string", () => {
    expect(() => formatDateTime("not-a-date")).not.toThrow();
  });
});

describe("rightTypeLabel", () => {
  it("translates known right types to Japanese labels", () => {
    expect(rightTypeLabel("copyright")).toBe("著作権");
    expect(rightTypeLabel("trademark")).toBe("商標権");
    expect(rightTypeLabel("portrait")).toBe("肖像権・パブリシティ権");
    expect(rightTypeLabel("other")).toBe("その他");
  });

  it("returns an empty string for null", () => {
    expect(rightTypeLabel(null)).toBe("");
  });

  it("falls back to the raw value for an unknown right type", () => {
    expect(rightTypeLabel("something_new")).toBe("something_new");
  });
});

describe("categoryLabel", () => {
  it("translates known categories to Japanese labels", () => {
    expect(categoryLabel("csam")).toBe("児童ポルノ等の違法コンテンツ");
    expect(categoryLabel("malware")).toBe("マルウェア・危険なファイル");
    expect(categoryLabel("privacy")).toBe("個人情報の無断掲載・晒し");
    expect(categoryLabel("spam")).toBe("スパム・迷惑行為");
    expect(categoryLabel("other")).toBe("その他");
    expect(categoryLabel("rights_infringement")).toBe("権利侵害の申し立て");
  });

  it("falls back to the raw value for an unknown category", () => {
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("shareStatusLabel", () => {
  it("reports a non-existent share regardless of other flags", () => {
    const share: ShareInfo = {
      exists: false,
      expired: true,
      suspended: true,
      fileCount: 3,
    };

    expect(shareStatusLabel(share)).toBe("共有は既に存在しません");
  });

  it("prioritizes suspended over expired", () => {
    const share: ShareInfo = {
      exists: true,
      expired: true,
      suspended: true,
      fileCount: 2,
    };

    expect(shareStatusLabel(share)).toBe("一時停止中・ファイル2件");
  });

  it("reports expired when not suspended", () => {
    const share: ShareInfo = {
      exists: true,
      expired: true,
      suspended: false,
      fileCount: 5,
    };

    expect(shareStatusLabel(share)).toBe("期限切れ・ファイル5件");
  });

  it("reports active when neither expired nor suspended", () => {
    const share: ShareInfo = {
      exists: true,
      expired: false,
      suspended: false,
      fileCount: 0,
    };

    expect(shareStatusLabel(share)).toBe("有効・ファイル0件");
  });
});
