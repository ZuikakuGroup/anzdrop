import { describe, expect, it } from "vitest";
import {
  getR2S3Credentials,
  isR2DirectUploadEnabled,
  resolveUploadMode,
  R2_FILES_BUCKET_NAME,
} from "@/lib/upload/r2DirectCredentials";

describe("r2DirectCredentials", () => {
  it("returns null when any secret is missing", () => {
    expect(getR2S3Credentials({})).toBeNull();
    expect(
      getR2S3Credentials({
        R2_ACCESS_KEY_ID: "a",
        R2_SECRET_ACCESS_KEY: "b",
      })
    ).toBeNull();
    expect(isR2DirectUploadEnabled({})).toBe(false);
    expect(resolveUploadMode({})).toBe("proxy");
  });

  it("returns credentials and direct mode when all secrets are set", () => {
    const credentials = getR2S3Credentials({
      R2_ACCESS_KEY_ID: " key ",
      R2_SECRET_ACCESS_KEY: " secret ",
      CLOUDFLARE_ACCOUNT_ID: " account ",
    });

    expect(credentials).toEqual({
      accessKeyId: "key",
      secretAccessKey: "secret",
      accountId: "account",
      bucketName: R2_FILES_BUCKET_NAME,
    });
    expect(resolveUploadMode({
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      CLOUDFLARE_ACCOUNT_ID: "account",
    })).toBe("direct");
  });
});
