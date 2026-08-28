import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestEnv,
  clearAllTables,
  stubTurnstileSuccess,
  stubTurnstileFailure,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

beforeAll(async () => {
  const handle = await createTestEnv();
  env = handle.env;
  dispose = handle.dispose;
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await clearAllTables(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type ReportRow = {
  id: string;
  share_id: string;
  reason: string;
  report_type: string;
  category: string;
  claimant_name: string | null;
  contact_email: string | null;
  right_type: string | null;
};

async function postReport(body: unknown) {
  const { POST } = await import("@/app/api/report/route");

  return POST(
    new Request("http://localhost/api/report", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

async function allReports(): Promise<ReportRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM reports`).all<
    ReportRow
  >();

  return results ?? [];
}

describe("POST /api/report", () => {
  it("returns 403 and inserts no row when Turnstile verification fails", async () => {
    stubTurnstileFailure();

    const response = await postReport({
      shareId: "abc12345",
      reason: "spam content",
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
    expect(await allReports()).toHaveLength(0);
  });

  it("returns 403 (not 400) when Turnstile fails even if shareId/reason are also missing (Turnstile is checked first)", async () => {
    stubTurnstileFailure();

    const response = await postReport({
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
    expect(await allReports()).toHaveLength(0);
  });

  it("returns 400 when shareId is missing", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      reason: "spam content",
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allReports()).toHaveLength(0);
  });

  it("returns 400 when reason is missing", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      shareId: "abc12345",
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allReports()).toHaveLength(0);
  });

  it("returns 400 for a general report with a missing category", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      shareId: "abc12345",
      reason: "spam content",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allReports()).toHaveLength(0);
  });

  it("returns 400 for a general report with an invalid category", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      shareId: "abc12345",
      reason: "spam content",
      category: "not-a-real-category",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allReports()).toHaveLength(0);
  });

  it("inserts a general report row with the claimant/contact/right fields NULL", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      shareId: "abc12345",
      reason: "this is spam",
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      share_id: "abc12345",
      report_type: "general",
      category: "spam",
      claimant_name: null,
      contact_email: null,
      right_type: null,
    });
  });

  it("returns 400 for a rights_holder report missing claimantName/contactEmail/rightType", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      reportType: "rights_holder",
      shareId: "abc12345",
      reason: "this infringes my copyright",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allReports()).toHaveLength(0);
  });

  it("returns 400 for a rights_holder report with an invalid contactEmail format", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      reportType: "rights_holder",
      shareId: "abc12345",
      reason: "this infringes my copyright",
      claimantName: "Jane Doe",
      contactEmail: "not-an-email",
      rightType: "copyright",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allReports()).toHaveLength(0);
  });

  it("inserts a rights_holder report and forces category to rights_infringement even when the client sends a different category", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      reportType: "rights_holder",
      shareId: "abc12345",
      reason: "this infringes my copyright",
      claimantName: "Jane Doe",
      contactEmail: "jane@example.com",
      rightType: "copyright",
      // クライアントが送ってきても無視され、サーバー側で固定されることを確認する。
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      report_type: "rights_holder",
      category: "rights_infringement",
      claimant_name: "Jane Doe",
      contact_email: "jane@example.com",
      right_type: "copyright",
    });
  });

  it("normalizes a full share URL down to just the shareId", async () => {
    stubTurnstileSuccess();

    const response = await postReport({
      shareId: "https://anzdrop.example.com/d/abc12345",
      reason: "spam content",
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].share_id).toBe("abc12345");
  });

  it("strips the URL fragment (decryption key) from the shareId field before storing it", async () => {
    stubTurnstileSuccess();
    // ダウンロードURLはE2EE鍵をフラグメント(#以降)に含む。共有URLをそのまま
    // shareIdフィールドに貼り付けても、鍵がDBに保存されてはならない。
    const fakeKey = "A".repeat(43);

    const response = await postReport({
      shareId: `https://anzdrop.example.com/d/abc12345#${fakeKey}`,
      reason: "spam content",
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].share_id).toBe("abc12345");
    expect(reports[0].share_id).not.toContain(fakeKey);
  });

  it("truncates a reason longer than 1000 characters when storing it", async () => {
    stubTurnstileSuccess();
    // 43文字以上"a"が連続するとE2EE鍵っぽい文字列とみなされサニタイズで
    // 除去されてしまうため、スペースを挟んで連続させないようにする。
    const longReason = "a ".repeat(750);

    const response = await postReport({
      shareId: "abc12345",
      reason: longReason,
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toHaveLength(1000);
  });

  it("applies sanitizeReportText to strip an E2EE key from the URL fragment in the reason", async () => {
    stubTurnstileSuccess();
    // 43文字のbase64url風の鍵っぽい文字列(サニタイズ対象)をURLフラグメントに含める。
    const fakeKey = "A".repeat(43);
    const reason = `見てください https://anzdrop.example.com/d/abc12345#${fakeKey} が問題です`;

    const response = await postReport({
      shareId: "abc12345",
      reason,
      category: "spam",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).not.toContain(fakeKey);
  });

  it("applies sanitizeReportText to claimantName as well, in case a key was pasted there by mistake", async () => {
    stubTurnstileSuccess();
    // 43文字のbase64url風の鍵っぽい文字列(サニタイズ対象)を氏名欄に誤って貼り付けたケース。
    const fakeKey = "B".repeat(43);

    const response = await postReport({
      reportType: "rights_holder",
      shareId: "abc12345",
      reason: "this infringes my copyright",
      claimantName: `Jane Doe ${fakeKey}`,
      contactEmail: "jane@example.com",
      rightType: "copyright",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const reports = await allReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].claimant_name).not.toContain(fakeKey);
  });
});
