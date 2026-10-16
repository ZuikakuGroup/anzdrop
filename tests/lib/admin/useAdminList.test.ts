// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { mountHook } from "@/test/react";
import { useAdminList } from "@/lib/admin/useAdminList";
import { useAdminAction } from "@/lib/admin/useAdminAction";

describe("admin list concurrency", () => {
  it("keeps the newest reload when an older response arrives later", async () => {
    const old = Promise.withResolvers<string[]>();
    const latest = Promise.withResolvers<string[]>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const hook = await mountHook(() => useAdminList<string>(fetch));
    try {
      let reload: Promise<void>;
      act(() => { reload = hook.current.load(); });
      await act(async () => { latest.resolve(["new"]); await reload; });
      await act(async () => old.resolve(["old"]));
      expect(hook.current.items).toEqual(["new"]);
      expect(hook.current.isLoading).toBe(false);
    } finally { await hook.unmount(); }
  });
  it("invalidates old success and failure responses immediately on tab changes", async () => {
    const old = Promise.withResolvers<string[]>();
    const next = Promise.withResolvers<string[]>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const hook = await mountHook(() => useAdminList<string>(fetch));
    try {
      await act(async () => hook.current.switchStatus("resolved"));
      expect(fetch.mock.calls.map(call => call[0])).toEqual(["open", "resolved"]);
      await act(async () => old.reject(new Error("stale error")));
      expect(hook.current.error).toBe("");
      expect(hook.current.isLoading).toBe(true);
      await act(async () => next.resolve(["resolved"]));
      expect(hook.current.items).toEqual(["resolved"]);
      await act(async () => hook.current.switchStatus("resolved"));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { await hook.unmount(); }
  });
  it("reloads the current filter after a mutation started on another tab", async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    const hook = await mountHook(() => useAdminList<string>(fetch));
    try {
      const reloadFromOldRender = hook.current.load;
      await act(async () => hook.current.switchStatus("all"));
      await act(async () => reloadFromOldRender());
      expect(fetch.mock.calls.map(call => call[0])).toEqual(["open", "all", "all"]);
    } finally { await hook.unmount(); }
  });

});

describe("admin mutations", () => {
  it("blocks synchronous duplicate calls and reloads only after success", async () => {
    const pending = Promise.withResolvers<void>();
    const request = vi.fn(() => pending.promise);
    const success = vi.fn();
    const errors = vi.fn();
    const hook = await mountHook(() => useAdminAction(errors));
    try {
      let operation: Promise<void>;
      act(() => { operation = hook.current.run("id", request, success); void hook.current.run("id", request, success); });
      expect(request).toHaveBeenCalledTimes(1);
      expect(success).not.toHaveBeenCalled();
      expect(hook.current.pendingId).toBe("id");
      await act(async () => { pending.resolve(); await operation; });
      expect(success).toHaveBeenCalledTimes(1);
      expect(hook.current.pendingId).toBe("");
    } finally { await hook.unmount(); }
  });
  it("reports a failure and permits retry without calling success", async () => {
    const errors = vi.fn();
    const success = vi.fn();
    const request = vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce(undefined);
    const hook = await mountHook(() => useAdminAction(errors));
    try {
      await act(async () => hook.current.run("id", request, success));
      expect(errors).toHaveBeenLastCalledWith("failed");
      expect(success).not.toHaveBeenCalled();
      expect(hook.current.pendingId).toBe("");
      await act(async () => hook.current.run("id", request, success));
      expect(success).toHaveBeenCalledTimes(1);
    } finally { await hook.unmount(); }
  });
  it("does not reload or report errors after unmount", async () => {
    const pending = Promise.withResolvers<void>();
    const errors = vi.fn();
    const success = vi.fn();
    const hook = await mountHook(() => useAdminAction(errors));
    let operation: Promise<void>;
    act(() => { operation = hook.current.run("id", () => pending.promise, success); });
    await hook.unmount();
    errors.mockClear();
    await act(async () => { pending.resolve(); await operation; });
    expect(success).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});
