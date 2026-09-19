import { describe, expect, it } from "vitest";
import { readBodyWithinLimit } from "@/lib/api/body";

describe("readBodyWithinLimit", () => {
  it("rejects an oversized declared or streamed body", async () => {
    const declared = new Request("http://localhost", { method: "POST", headers: { "Content-Length": "5" }, body: "x" });
    const streamed = new Request("http://localhost", { method: "POST", headers: { "Content-Length": "1" }, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("abcde")); controller.close(); } }), duplex: "half" } as RequestInit);
    await expect(readBodyWithinLimit(declared, 4)).resolves.toBeNull();
    await expect(readBodyWithinLimit(streamed, 4)).resolves.toBeNull();
  });

  it("returns a body at the byte limit", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "abcd" });
    await expect(readBodyWithinLimit(request, 4)).resolves.toEqual(new TextEncoder().encode("abcd"));
  });
});
