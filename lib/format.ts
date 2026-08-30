// 単位はスペースを空けずに付ける("50GB" / "1.5MB")。/pricing のスペック表記や
// アップロード上限の案内文と表記を揃えるため。ちょうど割り切れる場合は末尾の
// ".0" も落とす("5.0GB" ではなく "5GB")。
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const fixed = value.toFixed(value < 10 ? 1 : 0);
  const trimmed = fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;

  return `${trimmed}${units[unitIndex]}`;
}
