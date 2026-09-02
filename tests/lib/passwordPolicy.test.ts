import { describe, expect, it } from "vitest";
import {
  checkSharePasswordBeforeUpload,
  MAX_SHARE_PASSWORD_LENGTH,
  MIN_SHARE_PASSWORD_LENGTH,
  SHARE_PASSWORD_EMPTY_ERROR,
  SHARE_PASSWORD_LENGTH_ERROR,
  validateSharePassword,
} from "@/lib/passwordPolicy";
import {
  MAX_PASSWORD_LENGTH as ACCOUNT_MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH as ACCOUNT_MIN_PASSWORD_LENGTH,
} from "@/app/api/account/signup/schema";

describe("validateSharePassword", () => {
  it("rejects passwords shorter than the minimum length", () => {
    const result = validateSharePassword("a".repeat(MIN_SHARE_PASSWORD_LENGTH - 1));

    expect(result).toEqual({ ok: false, error: SHARE_PASSWORD_LENGTH_ERROR });
  });

  it("rejects an empty password", () => {
    expect(validateSharePassword("")).toEqual({
      ok: false,
      error: SHARE_PASSWORD_LENGTH_ERROR,
    });
  });

  it("counts non-BMP characters as single characters", () => {
    // "𝟙𝟚𝟛𝟜" は 4 文字だが UTF-16 では 8 コードユニット。String.length で
    // 数えていると最小長 8 を通過してしまう。
    const fourAstralChars = "𝟙𝟚𝟛𝟜";

    expect(fourAstralChars.length).toBe(MIN_SHARE_PASSWORD_LENGTH);
    expect(validateSharePassword(fourAstralChars)).toEqual({
      ok: false,
      error: SHARE_PASSWORD_LENGTH_ERROR,
    });
  });

  it("accepts non-BMP passwords that reach the minimum in code points", () => {
    // コードポイント数で数えることで短いパスワードを弾くのが目的であって、
    // 非BMP文字そのものを禁止しているわけではない。
    const eightAstralChars = "𝟙".repeat(MIN_SHARE_PASSWORD_LENGTH);

    expect(eightAstralChars.length).toBe(MIN_SHARE_PASSWORD_LENGTH * 2);
    expect(validateSharePassword(eightAstralChars)).toEqual({ ok: true });
  });

  it("does not let non-BMP characters eat into the maximum length", () => {
    // 120 コードポイント = 240 コードユニット。上限 200 を超えるのは
    // コードユニットで数えた場合だけなので、String.length 実装に戻すと落ちる。
    const withinMax = "𝟙".repeat(120);

    expect(withinMax.length).toBeGreaterThan(MAX_SHARE_PASSWORD_LENGTH);
    expect(validateSharePassword(withinMax)).toEqual({ ok: true });

    expect(
      validateSharePassword("𝟙".repeat(MAX_SHARE_PASSWORD_LENGTH + 1))
    ).toEqual({ ok: false, error: SHARE_PASSWORD_LENGTH_ERROR });
  });

  it("accepts a password exactly at the minimum length", () => {
    expect(
      validateSharePassword("a".repeat(MIN_SHARE_PASSWORD_LENGTH))
    ).toEqual({ ok: true });
  });

  it("accepts a password exactly at the maximum length", () => {
    expect(
      validateSharePassword("a".repeat(MAX_SHARE_PASSWORD_LENGTH))
    ).toEqual({ ok: true });
  });

  it("rejects a password longer than the maximum length", () => {
    expect(
      validateSharePassword("a".repeat(MAX_SHARE_PASSWORD_LENGTH + 1))
    ).toEqual({ ok: false, error: SHARE_PASSWORD_LENGTH_ERROR });
  });

  it("counts surrounding whitespace as part of the length (does not trim)", () => {
    // 7 visible chars + 1 trailing space == minimum length: still accepted,
    // matching the account-side schema which also does not trim.
    expect(validateSharePassword("1234567 ")).toEqual({ ok: true });
    // 7 chars with no padding stays rejected.
    expect(validateSharePassword("1234567")).toEqual({
      ok: false,
      error: SHARE_PASSWORD_LENGTH_ERROR,
    });
  });

  it("keeps the bounds in step with the account password policy", () => {
    // 共有パスワードの下限・上限はアカウントのパスワード
    // (app/api/account/signup/schema.ts)に揃えている。片方だけ変更したら
    // ここで落として、両者を突き合わせるきっかけにする。
    expect(MIN_SHARE_PASSWORD_LENGTH).toBe(ACCOUNT_MIN_PASSWORD_LENGTH);
    expect(MAX_SHARE_PASSWORD_LENGTH).toBe(ACCOUNT_MAX_PASSWORD_LENGTH);
  });
});

describe("checkSharePasswordBeforeUpload", () => {
  const weakPassword = "1234";
  const strongPassword = "correct-horse-battery";

  it("rejects a weak password when creating a new protected share", () => {
    expect(
      checkSharePasswordBeforeUpload({
        isNewShare: true,
        usePassword: true,
        password: weakPassword,
      })
    ).toEqual({ ok: false, error: SHARE_PASSWORD_LENGTH_ERROR });
  });

  it("accepts a password meeting the policy on a new protected share", () => {
    expect(
      checkSharePasswordBeforeUpload({
        isNewShare: true,
        usePassword: true,
        password: strongPassword,
      })
    ).toEqual({ ok: true });
  });

  it("asks for input when the password is empty or whitespace only", () => {
    // 空白だけのパスワードは長さ 8 を満たしていても未入力扱いにする。
    for (const password of ["", "   ", " ".repeat(MIN_SHARE_PASSWORD_LENGTH)]) {
      expect(
        checkSharePasswordBeforeUpload({
          isNewShare: true,
          usePassword: true,
          password,
        })
      ).toEqual({ ok: false, error: SHARE_PASSWORD_EMPTY_ERROR });
    }
  });

  it("does not re-validate the password on an existing share", () => {
    // 共有作成後は鍵が最初のパスワードでラップ済みで、入力欄が編集されていても
    // 使われない。ここで弾くと、成立済みの共有への追加アップロードや再試行が
    // 無関係なエラーで止まってしまう(CodeRabbit の指摘 / PR #83)。
    expect(
      checkSharePasswordBeforeUpload({
        isNewShare: false,
        usePassword: true,
        password: weakPassword,
      })
    ).toEqual({ ok: true });

    expect(
      checkSharePasswordBeforeUpload({
        isNewShare: false,
        usePassword: true,
        password: "",
      })
    ).toEqual({ ok: true });
  });

  it("skips validation entirely when password protection is off", () => {
    expect(
      checkSharePasswordBeforeUpload({
        isNewShare: true,
        usePassword: false,
        password: weakPassword,
      })
    ).toEqual({ ok: true });
  });
});
