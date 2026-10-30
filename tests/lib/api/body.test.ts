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
  it.each([0, 3, 4, 5])("handles fragmented streams of %i bytes without padding or trusting Content-Length", async (size) => {
    const bytes = new Uint8Array(size).map((_, i) => i + 1);
    let offset = 0;
    const request = new Request("http://localhost", { method: "POST", headers: { "Content-Length": "1" }, body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === size) return controller.close();
        controller.enqueue(bytes.subarray(offset, ++offset));
      },
    }), duplex: "half" } as RequestInit);
    const result = await readBodyWithinLimit(request, 4);
    if (size > 4) expect(result).toBeNull();
    else {
      expect(result).toEqual(bytes);
      expect(result?.buffer.byteLength).toBe(size);
      bytes.fill(0);
      expect(result).toEqual(Uint8Array.from({ length: size }, (_, i) => i + 1));
    }
  });

});
