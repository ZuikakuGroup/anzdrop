import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteContact,
  fetchContacts,
  resolveContact,
  type AdminContact,
} from "@/lib/admin/contactsApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchContacts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the given status and returns the contacts on success", async () => {
    const contacts: AdminContact[] = [
      {
        id: "c1",
        name: "山田太郎",
        email: "user@example.com",
        subject: "質問です",
        message: "使い方について質問があります",
        createdAt: "2026-01-01T00:00:00.000Z",
        resolvedAt: null,
      },
    ];
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("/api/admin/contacts?status=resolved");
      return jsonResponse({ success: true, contacts });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchContacts("resolved");

    expect(result).toEqual(contacts);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws the server's error message when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, error: "Unauthorized" }, 403))
    );

    await expect(fetchContacts("open")).rejects.toThrow("Unauthorized");
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(fetchContacts("open")).rejects.toThrow("読み込みに失敗しました。");
  });

  it("throws when the response is ok but contacts is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: true }))
    );

    await expect(fetchContacts("open")).rejects.toThrow("読み込みに失敗しました。");
  });
});

describe("resolveContact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the resolve endpoint and resolves on success", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/admin/contacts/c1/resolve");
      expect(init.method).toBe("POST");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(resolveContact("c1")).resolves.toBeUndefined();
  });

  it("throws the server's error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ success: false, error: "Contact not found" }, 404)
      )
    );

    await expect(resolveContact("missing")).rejects.toThrow("Contact not found");
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(resolveContact("c1")).rejects.toThrow("更新に失敗しました。");
  });
});

describe("deleteContact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs the contact endpoint and resolves on success", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/admin/contacts/c1");
      expect(init.method).toBe("DELETE");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(deleteContact("c1")).resolves.toBeUndefined();
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(deleteContact("c1")).rejects.toThrow("削除に失敗しました。");
  });
});
