export type ShareInfo = {
  exists: boolean;
  expired: boolean;
  suspended: boolean;
  fileCount: number;
};

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const RIGHT_TYPE_LABELS: Record<string, string> = {
  copyright: "著作権",
  trademark: "商標権",
  portrait: "肖像権・パブリシティ権",
  other: "その他",
};

export function rightTypeLabel(rightType: string | null): string {
  if (!rightType) {
    return "";
  }

  return RIGHT_TYPE_LABELS[rightType] ?? rightType;
}

const CATEGORY_LABELS: Record<string, string> = {
  csam: "児童ポルノ等の違法コンテンツ",
  malware: "マルウェア・危険なファイル",
  privacy: "個人情報の無断掲載・晒し",
  spam: "スパム・迷惑行為",
  other: "その他",
  rights_infringement: "権利侵害の申し立て",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function shareStatusLabel(share: ShareInfo): string {
  if (!share.exists) {
    return "共有は既に存在しません";
  }

  if (share.suspended) {
    return `一時停止中・ファイル${share.fileCount}件`;
  }

  if (share.expired) {
    return `期限切れ・ファイル${share.fileCount}件`;
  }

  return `有効・ファイル${share.fileCount}件`;
}
