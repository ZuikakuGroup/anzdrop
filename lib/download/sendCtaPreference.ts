export const SEND_CTA_DISABLED_STORAGE_KEY = "anzdrop_recipient_send_cta_disabled";

// 受け取り後の送信CTAをこのブラウザで今後表示しない設定。サーバーには送らない。
export function isSendCtaDisabled(): boolean {
  try {
    return window.localStorage.getItem(SEND_CTA_DISABLED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setSendCtaDisabled(disabled: boolean): void {
  try {
    if (disabled) {
      window.localStorage.setItem(SEND_CTA_DISABLED_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(SEND_CTA_DISABLED_STORAGE_KEY);
    }
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は、現在の表示だけ抑制する。
  }
}
