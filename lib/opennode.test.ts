import { afterEach, describe, expect, it, vi } from "vitest";
import { createCharge, verifyOpenNodeSignature } from "./opennode";

describe("verifyOpenNodeSignature", () => {
  it("accepts a correctly computed HMAC-SHA256(apiKey, chargeId)", async () => {
    const apiKey = "test-api-key";
    const chargeId = "charge-123";

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(apiKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(chargeId)
    );
    const hex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await expect(
      verifyOpenNodeSignature(chargeId, hex, apiKey)
    ).resolves.toBe(true);
  });

  it("rejects a mismatched signature", async () => {
    await expect(
      verifyOpenNodeSignature("charge-123", "not-the-right-hash", "test-api-key")
    ).resolves.toBe(false);
  });

  it("rejects a signature computed with the wrong key", async () => {
    const chargeId = "charge-123";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("wrong-key"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(chargeId)
    );
    const hex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await expect(
      verifyOpenNodeSignature(chargeId, hex, "test-api-key")
    ).resolves.toBe(false);
  });
});

describe("createCharge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the charge id and hosted checkout url on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "charge-abc",
            hosted_checkout_url: "https://checkout.opennode.com/charge-abc",
          },
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCharge({
      amountUsd: 5,
      orderId: "order-1",
      description: "test",
      callbackUrl: "https://example.com/webhook",
      successUrl: "https://example.com/success",
      apiKey: "key",
    });

    expect(result).toEqual({
      success: true,
      chargeId: "charge-abc",
      hostedCheckoutUrl: "https://checkout.opennode.com/charge-abc",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opennode.com/v1/charges",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns a failure result on a non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 }))
    );

    const result = await createCharge({
      amountUsd: 5,
      orderId: "order-1",
      description: "test",
      callbackUrl: "https://example.com/webhook",
      successUrl: "https://example.com/success",
      apiKey: "bad-key",
    });

    expect(result.success).toBe(false);
  });

  it("returns a failure result when the response body is missing expected fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: {} }), { status: 201 })
      )
    );

    const result = await createCharge({
      amountUsd: 5,
      orderId: "order-1",
      description: "test",
      callbackUrl: "https://example.com/webhook",
      successUrl: "https://example.com/success",
      apiKey: "key",
    });

    expect(result.success).toBe(false);
  });

  it("returns a failure result when fetch itself throws (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await createCharge({
      amountUsd: 5,
      orderId: "order-1",
      description: "test",
      callbackUrl: "https://example.com/webhook",
      successUrl: "https://example.com/success",
      apiKey: "key",
    });

    expect(result.success).toBe(false);
  });
});
