type DismissShareResultParams = {
  shareUrl: string;
  isUploading: boolean;
  /** サイズ検査などを通過し、実際にキューへ載せるファイル数 */
  acceptedFileCount: number;
};

/**
 * 共有結果パネル表示中にファイルを追加したときの UI 遷移。
 * 同じ共有への相乗りのため shareId / uploadToken / 鍵は呼び出し側で保持する。
 * 追加できるファイルが 1 件以上あるときだけ true(失敗 DnD で結果パネルを消さない)。
 */
export function shouldDismissShareResultForAdditionalUpload({
  shareUrl,
  isUploading,
  acceptedFileCount,
}: DismissShareResultParams): boolean {
  return !isUploading && shareUrl.length > 0 && acceptedFileCount > 0;
}
