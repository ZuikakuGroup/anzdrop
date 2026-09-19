import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";

const schema = z.object({
  name: z.string({ error: "Missing name" }).min(1, { error: "Missing name" }),
});

describe("parseJsonBody", () => {
  it("returns ok:true with the parsed data when the body matches the schema", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: JSON.stringify({ name: "anzdrop" }),
    });

    const result = await parseJsonBody(request, schema);

    expect(result).toEqual({ ok: true, data: { name: "anzdrop" } });
  });

  it("returns a 400 response with the schema's custom error message when validation fails", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const result = await parseJsonBody(request, schema);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected ok:false");
    }
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body).toEqual({ success: false, error: "Missing name" });
  });

  it("treats an empty string as a validation failure, not as a present value", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });

    const result = await parseJsonBody(request, schema);

    expect(result.ok).toBe(false);
  });

  it("propagates a JSON syntax error to the caller instead of returning a 400 (preserves the existing 500 behavior for malformed JSON)", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: "not valid json",
    });

    await expect(parseJsonBody(request, schema)).rejects.toThrow();
  });

  it("rejects an oversized declared body before reading it", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      headers: { "Content-Length": "65" },
      // 本文が不正JSONでも、Content-Lengthだけで413にできることを確認する。
      body: "not valid json",
    });

    const result = await parseJsonBody(request, schema, 64);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected ok:false");
    }
    expect(result.response.status).toBe(413);
  });

  it("rejects an oversized streamed body when Content-Length understates it", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"name":"'));
          controller.enqueue(new TextEncoder().encode("a".repeat(64)));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
      // Node's Request implementation requires this when a stream is used.
      duplex: "half",
    } as RequestInit);

    const result = await parseJsonBody(request, schema, 64);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected ok:false");
    }
    expect(result.response.status).toBe(413);
  });

  it("rejects a streamed body that exceeds the limit when Content-Length is absent", async () => {
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"name":"'));
          controller.enqueue(new TextEncoder().encode("a".repeat(64)));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
      // Node's Request implementation requires this when a stream is used.
      duplex: "half",
    } as RequestInit);

    const result = await parseJsonBody(request, schema, 64);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected ok:false");
    }
    expect(result.response.status).toBe(413);
  });

  it("accepts a body exactly at the configured byte limit", async () => {
    const emptyJson = JSON.stringify({ name: "" });
    const name = "a".repeat(64 - new TextEncoder().encode(emptyJson).byteLength);
    const body = JSON.stringify({ name });

    expect(new TextEncoder().encode(body).byteLength).toBe(64);

    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body,
    });

    await expect(parseJsonBody(request, schema, 64)).resolves.toEqual({
      ok: true,
      data: { name },
    });
  });
});
