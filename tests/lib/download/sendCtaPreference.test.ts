// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  isSendCtaDisabled,
  SEND_CTA_DISABLED_STORAGE_KEY,
  setSendCtaDisabled,
} from "@/lib/download/sendCtaPreference";

describe("送信CTAの表示設定", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("既定ではCTAを表示する", () => {
    expect(isSendCtaDisabled()).toBe(false);
  });

  it("次から表示しない設定をブラウザ内に保存する", () => {
    setSendCtaDisabled(true);

    expect(window.localStorage.getItem(SEND_CTA_DISABLED_STORAGE_KEY)).toBe(
      "true"
    );
    expect(isSendCtaDisabled()).toBe(true);
  });

  it("設定を解除するとCTAを再表示できる", () => {
    setSendCtaDisabled(true);
    setSendCtaDisabled(false);

    expect(isSendCtaDisabled()).toBe(false);
  });
});
