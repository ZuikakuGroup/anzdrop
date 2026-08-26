import { describe, expect, it, vi } from "vitest";
import { withApiHandler } from "@/lib/api/handler";

describe("withApiHandler", () => {
  it("passes through the wrapped handler's response and arguments unchanged", async () => {
    const handler = vi.fn(async (request: Request, extra: string) => {
      expect(extra).toBe("context-value");

      return Response.json({ success: true, request: request.url });
    });
    const wrapped = withApiHandler("GET /api/example", handler);

    const response = await wrapped(
      new Request("http://localhost/api/example"),
      "context-value"
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      request: "http://localhost/api/example",
    });
  });

  it("catches a thrown error and returns a generic 500 without leaking the error message", async () => {
    const wrapped = withApiHandler("POST /api/example", async (request: Request) => {
      expect(request).toBeInstanceOf(Request);

      throw new Error("some secret internal detail");
    });

    const response = await wrapped(new Request("http://localhost/api/example"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: "Internal server error" });
  });

  it("logs the routeLabel and the original error via console.error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalError = new Error("boom");
    const wrapped = withApiHandler("POST /api/example", async (request: Request) => {
      expect(request).toBeInstanceOf(Request);

      throw originalError;
    });

    await wrapped(new Request("http://localhost/api/example"));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "POST /api/example failed:",
      originalError
    );
    consoleErrorSpy.mockRestore();
  });
});
