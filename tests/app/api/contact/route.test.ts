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

type ContactRow = {
  id: string;
  name: string | null;
  email: string;
  subject: string;
  message: string;
};

async function postContact(body: unknown) {
  const { POST } = await import("@/app/api/contact/route");

  return POST(
    new Request("http://localhost/api/contact", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

async function allContacts(): Promise<ContactRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM contacts`).all<
    ContactRow
  >();

  return results ?? [];
}

describe("POST /api/contact", () => {
  it("returns 403 and inserts no row when Turnstile verification fails", async () => {
    stubTurnstileFailure();

    const response = await postContact({
      email: "user@example.com",
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
    expect(await allContacts()).toHaveLength(0);
  });

  it("returns 403 (not 400) when Turnstile fails even if required fields are also missing", async () => {
    stubTurnstileFailure();

    const response = await postContact({
      turnstileToken: "tok",
    });

    expect(response.status).toBe(403);
    expect(await allContacts()).toHaveLength(0);
  });

  it("returns 400 when email is missing", async () => {
    stubTurnstileSuccess();

    const response = await postContact({
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allContacts()).toHaveLength(0);
  });

  it("returns 400 when subject is missing", async () => {
    stubTurnstileSuccess();

    const response = await postContact({
      email: "user@example.com",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allContacts()).toHaveLength(0);
  });

  it("returns 400 when message is missing", async () => {
    stubTurnstileSuccess();

    const response = await postContact({
      email: "user@example.com",
      subject: "質問です",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allContacts()).toHaveLength(0);
  });

  it("returns 400 when the email format is invalid", async () => {
    stubTurnstileSuccess();

    const response = await postContact({
      email: "not-an-email",
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(400);
    expect(await allContacts()).toHaveLength(0);
  });

  it("inserts a contact row with a null name when name is omitted", async () => {
    stubTurnstileSuccess();

    const response = await postContact({
      email: "user@example.com",
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const contacts = await allContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: null,
      email: "user@example.com",
      subject: "質問です",
      message: "使い方について質問があります",
    });
  });

  it("stores the name when provided", async () => {
    stubTurnstileSuccess();

    const response = await postContact({
      name: "山田太郎",
      email: "user@example.com",
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const contacts = await allContacts();
    expect(contacts[0].name).toBe("山田太郎");
  });

  it("truncates a message longer than 2000 characters when storing it", async () => {
    stubTurnstileSuccess();
    // 43文字以上"a"が連続するとE2EE鍵っぽい文字列とみなされサニタイズで
    // 除去されてしまうため、スペースを挟んで連続させないようにする。
    const longMessage = "a ".repeat(1500);

    const response = await postContact({
      email: "user@example.com",
      subject: "質問です",
      message: longMessage,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const contacts = await allContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0].message).toHaveLength(2000);
  });

  it("applies sanitizeReportText to strip an E2EE key from the URL fragment in the message", async () => {
    stubTurnstileSuccess();
    // 43文字のbase64url風の鍵っぽい文字列(サニタイズ対象)をURLフラグメントに含める。
    const fakeKey = "A".repeat(43);
    const message = `見てください https://anzdrop.example.com/d/abc12345#${fakeKey} が開けません`;

    const response = await postContact({
      email: "user@example.com",
      subject: "質問です",
      message,
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const contacts = await allContacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0].message).not.toContain(fakeKey);
  });

  it("does not store an E2EE key glued directly before the email (no whitespace, so it would otherwise pass isValidEmail's loose format check)", async () => {
    stubTurnstileSuccess();
    // isValidEmail()は「空白なし・@1つ・@の後に.」という緩いチェックのため、
    // 鍵付きURLフラグメントの直後に空白なしでメールアドレスが続くと、
    // サニタイズしなければそのまま「有効なメールアドレス」として通ってしまう。
    const fakeKey = "C".repeat(43);
    const email = `https://anzdrop.example.com/d/abc12345#${fakeKey}@gmail.com`;

    const response = await postContact({
      email,
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    // サニタイズ後にURLフラグメント(鍵を含む)が失われ、@を含まない文字列に
    // なるため、メール形式エラーとして400になる(鍵付きでDBに保存されない)。
    expect(response.status).toBe(400);

    const contacts = await allContacts();
    expect(contacts).toHaveLength(0);
  });

  it("applies sanitizeReportText to the name field as well, in case a key was pasted there by mistake", async () => {
    stubTurnstileSuccess();
    const fakeKey = "B".repeat(43);

    const response = await postContact({
      name: `山田太郎 ${fakeKey}`,
      email: "user@example.com",
      subject: "質問です",
      message: "使い方について質問があります",
      turnstileToken: "tok",
    });

    expect(response.status).toBe(200);

    const contacts = await allContacts();
    expect(contacts[0].name).not.toContain(fakeKey);
  });
});
