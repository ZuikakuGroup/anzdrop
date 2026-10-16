// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountHook } from "@/test/react";
import { useSharedFiles } from "@/lib/download/useSharedFiles";
import { useDownloadActions } from "@/lib/download/useDownloadActions";
import { FileGoneError, FILE_GONE_ERROR } from "@/lib/download/errors";
import { decryptFileList, fetchAndDecrypt, unwrapKeyWithPassword, type DecryptedFile } from "@/lib/download/decrypt";
import { saveDecryptedFile } from "@/lib/download/saveFile";
import { downloadAllFiles } from "@/lib/download/downloadAll";
import { track } from "@/lib/analytics/client";

vi.mock("@/lib/crypto", () => ({ importKey: vi.fn().mockResolvedValue({}), decodeBase64Url: vi.fn().mockReturnValue(new Uint8Array(32)) }));
vi.mock("@/lib/download/decrypt", () => ({ decryptFileList: vi.fn(), unwrapKeyWithPassword: vi.fn(), fetchAndDecrypt: vi.fn() }));
vi.mock("@/lib/download/saveFile", () => ({ getShowSaveFilePicker: () => undefined, saveDecryptedFile: vi.fn() }));
vi.mock("@/lib/download/downloadAll", () => ({ downloadAllFiles: vi.fn() }));
vi.mock("@/lib/download/streamDownloadSaver", () => ({ registerDownloadServiceWorker: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

const file: DecryptedFile = { id: "f1", name: "photo.png", size: 16, isOneTime: false };
const response = (protectedShare = false) => Response.json({ success: true,
  share: { id: "s", expires_at: "2027-01-01", previewAllowed: true,
    wrappedKey: protectedShare ? "wrapped" : null, keySalt: protectedShare ? "salt" : null },
  files: [{ ...file, name: "encrypted-name" }], analyticsTransferId: "opaque-transfer",
});
let unmount: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "synthetic-key";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  vi.mocked(decryptFileList).mockReset().mockResolvedValue([file]);
  vi.mocked(unwrapKeyWithPassword).mockReset().mockResolvedValue({} as CryptoKey);
  vi.mocked(saveDecryptedFile).mockReset().mockResolvedValue({ saved: false });
});
afterEach(async () => { if (unmount) await unmount(); unmount = undefined; vi.unstubAllGlobals(); });
async function mountDownload() {
  const hook = await mountHook(() => {
    const shared = useSharedFiles("s");
    return { ...shared, ...useDownloadActions(shared) };
  });
  unmount = hook.unmount;
  return hook;
}

describe("download workflow", () => {
  it("shows a friendly error for missing fragment keys without decrypting", async () => {
    window.location.hash = "";
    const hook = await mountDownload();
    expect(hook.current.error).toContain("復号鍵が含まれていません");
    expect(decryptFileList).not.toHaveBeenCalled();
  });
  it("retains the password gate after a wrong password and allows retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(true)));
    vi.mocked(unwrapKeyWithPassword).mockRejectedValueOnce(new Error("bad tag"));
    const hook = await mountDownload();
    expect(hook.current.passwordProtection).not.toBeNull();
    await act(async () => hook.current.setPasswordInput("wrong"));
    await act(async () => hook.current.unlockWithPassword());
    expect(hook.current.passwordError).toBe("パスワードが違います。");
    expect(hook.current.passwordProtection).not.toBeNull();
    await act(async () => hook.current.setPasswordInput("correct"));
    await act(async () => hook.current.unlockWithPassword());
    expect(hook.current.passwordProtection).toBeNull();
    expect(hook.current.files).toEqual([file]);
  });
  it("resets the unlock lock on share changes and ignores the old unlock result", async () => {
    const old = Promise.withResolvers<CryptoKey>();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response(true))));
    vi.mocked(unwrapKeyWithPassword).mockReturnValueOnce(old.promise).mockResolvedValueOnce({} as CryptoKey);
    let shareId = "first";
    const hook = await mountHook(() => useSharedFiles(shareId));
    unmount = hook.unmount;
    await act(async () => hook.current.setPasswordInput("first-password"));
    let operation: Promise<void>;
    act(() => { operation = hook.current.unlockWithPassword(); });
    expect(hook.current.isUnlocking).toBe(true);
    shareId = "second";
    await hook.rerender();
    expect(hook.current.isUnlocking).toBe(false);
    expect(hook.current.passwordInput).toBe("");
    await act(async () => { old.resolve({} as CryptoKey); await operation; });
    expect(hook.current.key).toBeNull();
    expect(hook.current.passwordProtection).not.toBeNull();
    expect(decryptFileList).not.toHaveBeenCalled();
    await act(async () => hook.current.setPasswordInput("second-password"));
    await act(async () => hook.current.unlockWithPassword());
    expect(hook.current.passwordProtection).toBeNull();
    expect(hook.current.files).toEqual([file]);
  });
  it("does not decrypt an API response received after unmount", async () => {
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const hook = await mountDownload();
    await hook.unmount(); unmount = undefined;
    await act(async () => pending.resolve(response()));
    expect(decryptFileList).not.toHaveBeenCalled();
  });
  it("blocks overlapping saves and previews, and does not count a cancelled save as success", async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof saveDecryptedFile>>>();
    vi.mocked(saveDecryptedFile).mockReturnValue(pending.promise);
    const hook = await mountDownload();
    let operation: Promise<void>;
    act(() => {
      operation = hook.current.downloadFile(file);
      void hook.current.downloadFile(file);
      void hook.current.downloadAll();
      void hook.current.openPreview(file);
    });
    expect(saveDecryptedFile).toHaveBeenCalledTimes(1);
    expect(downloadAllFiles).not.toHaveBeenCalled();
    expect(fetchAndDecrypt).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ saved: false }); await operation; });
    expect(hook.current.downloadingId).toBe("");
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === "download_success")).toHaveLength(0);
  });
  it("refuses previews for one-time files before fetching any bytes", async () => {
    const hook = await mountDownload();
    await act(async () => hook.current.openPreview({ ...file, isOneTime: true }));
    expect(fetchAndDecrypt).not.toHaveBeenCalled();
  });
  it("removes expired files and makes the error dismissible", async () => {
    vi.mocked(saveDecryptedFile).mockRejectedValue(new FileGoneError(FILE_GONE_ERROR));
    const hook = await mountDownload();
    await act(async () => hook.current.downloadFile(file));
    expect(hook.current.files).toEqual([]);
    expect(hook.current.error).not.toBe("");
    await act(async () => hook.current.setError(""));
    expect(hook.current.error).toBe("");
  });
  it("revokes a preview URL if its bytes arrive after unmount", async () => {
    const pending = Promise.withResolvers<Uint8Array>();
    vi.mocked(fetchAndDecrypt).mockReturnValue(pending.promise);
    const create = vi.fn().mockReturnValue("blob:synthetic");
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const hook = await mountDownload();
    let operation: Promise<void>;
    act(() => { operation = hook.current.openPreview(file); });
    await hook.unmount(); unmount = undefined;
    await act(async () => { pending.resolve(new Uint8Array([1])); await operation; });
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:synthetic");
  });
});
