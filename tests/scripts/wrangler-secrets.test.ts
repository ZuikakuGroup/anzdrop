import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unstable_getVarsForDev, unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vitest";

const config = unstable_readConfig({ config: path.resolve(__dirname, "../../wrangler.jsonc") });

describe("Workers optional secrets", () => {
  it("loads optional R2 and microCMS secrets from the local development file", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "anzdrop-secret-test-"));
    const names = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLOUDFLARE_ACCOUNT_ID", "MICROCMS_API_KEY", "MICROCMS_WEBHOOK_SECRET", "ACCOUNT_AUTH_ENCRYPTION_KEY"];
    try {
      writeFileSync(path.join(directory, ".dev.vars"), names.map((name) => `${name}=test-fixture`).join("\n"));
      const bindings = unstable_getVarsForDev(path.join(directory, "wrangler.jsonc"), undefined, {}, undefined, true, config.secrets);
      for (const name of names) expect(bindings[name]).toEqual({ type: "secret_text", value: "test-fixture" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("does not require optional media, direct-upload, payment and analytics secrets", () => {
    const required = config.secrets?.required ?? [];
    for (const name of ["MICROCMS_API_KEY", "MICROCMS_WEBHOOK_SECRET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLOUDFLARE_ACCOUNT_ID", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OPENNODE_API_KEY", "ANALYTICS_SECRET"]) {
      expect(required).not.toContain(name);
    }
  });
});
