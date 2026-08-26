import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(
      verifyPassword("correct horse battery staple", hash)
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", hash)).resolves.toBe(
      false
    );
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");

    expect(a).not.toBe(b);
    await expect(verifyPassword("same password", a)).resolves.toBe(true);
    await expect(verifyPassword("same password", b)).resolves.toBe(true);
  });

  it("stores the argon2id parameters and rejects malformed stored hashes", async () => {
    const hash = await hashPassword("password");
    const [params] = hash.split("$");
    const [memorySize, iterations, parallelism] = params.split(":").map(Number);

    expect(memorySize).toBeGreaterThan(0);
    expect(iterations).toBeGreaterThan(0);
    expect(parallelism).toBeGreaterThan(0);

    await expect(verifyPassword("password", "not-a-valid-hash")).resolves.toBe(
      false
    );
    await expect(verifyPassword("password", "1$only-two-parts")).resolves.toBe(
      false
    );
  });

  it("rejects a stored hash with non-numeric parameters", async () => {
    await expect(
      verifyPassword("password", "abc:def:ghi$c2FsdA$aGFzaA")
    ).resolves.toBe(false);
  });

  it("rejects a legacy PBKDF2-format hash without crashing", async () => {
    // 旧PBKDF2実装が使っていた"iterations$salt$hash"形式(コロン区切りがない)。
    // ログイン/リカバリーのダミーハッシュが誤って旧形式のままだと、この形式が
    // paramParts.length!==3で即falseになりArgon2idの計算コストを払わずに
    // 抜けてしまい、タイミング差でアカウントの有無が漏れる回帰につながる。
    await expect(
      verifyPassword(
        "password",
        "210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
      )
    ).resolves.toBe(false);
  });

  it("exposes a dummy hash with the same cost parameters as a real hash", async () => {
    // login/recoverルートは、アカウント/リカバリーコードが存在しない場合に
    // このダミーハッシュでverifyPasswordを呼び、実在する場合と同じだけ
    // Argon2idの計算コストを払わせることでタイミング差での存在確認を防ぐ。
    // パラメータ部分が実際のhashPassword()と食い違うと、その保証が壊れる。
    const real = await hashPassword("whatever");
    const [realParams] = real.split("$");
    const [dummyParams] = DUMMY_PASSWORD_HASH.split("$");

    expect(dummyParams).toBe(realParams);
    await expect(
      verifyPassword("whatever", DUMMY_PASSWORD_HASH)
    ).resolves.toBe(false);
  });
});
