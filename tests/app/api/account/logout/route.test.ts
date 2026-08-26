import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/account/session";
import { POST } from "@/app/api/account/logout/route";

describe("POST /api/account/logout", () => {
  it("always returns success and clears the session cookie", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true });

    const setCookie = response.headers.get("Set-Cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });
});
