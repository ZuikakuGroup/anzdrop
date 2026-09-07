import type { DeviceClass } from "@/lib/analytics/schema";

// 要件書30・35章。過度なフィンガープリンティングをせず、大まかな
// desktop/mobile/tablet分類とブラウザファミリー名だけを取得する。
// 完全なUser-Agent文字列そのものは送信しない。

export function classifyDevice(userAgent: string): DeviceClass {
  const ua = userAgent.toLowerCase();

  if (/ipad|tablet(?!.*mobile)/.test(ua)) {
    return "tablet";
  }

  if (/android/.test(ua) && !/mobi/.test(ua)) {
    return "tablet";
  }

  if (/mobi|iphone|android/.test(ua)) {
    return "mobile";
  }

  if (ua.length > 0) {
    return "desktop";
  }

  return "unknown";
}

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/edg\//, "Edge"],
  [/opr\//, "Opera"],
  [/chrome\//, "Chrome"],
  [/crios\//, "Chrome"],
  [/fxios\//, "Firefox"],
  [/firefox\//, "Firefox"],
  [/safari\//, "Safari"],
];

export function classifyBrowserFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  for (const [pattern, name] of BROWSER_PATTERNS) {
    if (pattern.test(ua)) {
      return name;
    }
  }

  return "unknown";
}

export function getDeviceContext(): {
  deviceClass: DeviceClass;
  browserFamily: string;
} {
  const userAgent = navigator.userAgent ?? "";

  return {
    deviceClass: classifyDevice(userAgent),
    browserFamily: classifyBrowserFamily(userAgent),
  };
}
