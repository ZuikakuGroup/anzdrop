"use client";

import { useCallback, useEffect, useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";

type StatusFilter = "open" | "resolved" | "all";

type ShareInfo = {
  exists: boolean;
  expired: boolean;
  fileCount: number;
};

type AdminReport = {
  id: string;
  shareId: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  reportType: string;
  claimantName: string | null;
  contactEmail: string | null;
  rightType: string | null;
  category: string;
  share: ShareInfo;
};

type ReportsResponse = {
  success: boolean;
  reports?: AdminReport[];
  error?: string;
};

type ActionResponse = {
  success: boolean;
  error?: string;
};

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "未対応" },
  { value: "resolved", label: "対応済み" },
  { value: "all", label: "すべて" },
];

function formatDateTime(iso: string): string {
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

function rightTypeLabel(rightType: string | null): string {
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

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

function shareStatusLabel(share: ShareInfo): string {
  if (!share.exists) {
    return "共有は既に存在しません";
  }

  if (share.expired) {
    return `期限切れ・ファイル${share.fileCount}件`;
  }

  return `有効・ファイル${share.fileCount}件`;
}

export default function AdminReportsPage() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState("");
  const [confirmingShareId, setConfirmingShareId] = useState("");
  const [deletingShareId, setDeletingShareId] = useState("");

  const fetchReports = useCallback(
    async (targetStatus: StatusFilter): Promise<AdminReport[]> => {
      const response = await fetch(
        `/api/admin/reports?status=${targetStatus}`
      );
      const result: ReportsResponse = await response.json();

      if (!response.ok || !result.success || !result.reports) {
        throw new Error(result.error ?? "読み込みに失敗しました。");
      }

      return result.reports;
    },
    []
  );

  // クリックハンドラなどエフェクト外から呼ぶための、状態更新込みの再読み込み。
  const load = useCallback(
    async (targetStatus: StatusFilter) => {
      try {
        setReports(await fetchReports(targetStatus));
        setError("");
      } catch (unknownErr) {
        const err =
          unknownErr instanceof Error
            ? unknownErr
            : new Error("Unknown error");

        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    },
    [fetchReports]
  );

  // データ取得エフェクトは通例どおり、呼び出し(fetchReports)自体は
  // awaitより前でsetStateしない純粋な処理とし、setStateはこのエフェクト
  // 内のローカル関数(の中のawait後)でのみ行う。
  useEffect(() => {
    let cancelled = false;

    fetchReports(status)
      .then((reports) => {
        if (!cancelled) {
          setReports(reports);
          setError("");
        }
      })
      .catch((unknownErr: unknown) => {
        if (!cancelled) {
          const err =
            unknownErr instanceof Error
              ? unknownErr
              : new Error("Unknown error");

          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, fetchReports]);

  const switchStatus = (nextStatus: StatusFilter) => {
    if (nextStatus === status) {
      return;
    }

    setIsLoading(true);
    setStatus(nextStatus);
  };

  const resolveReport = async (reportId: string) => {
    if (resolvingId) {
      return;
    }

    setResolvingId(reportId);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/reports/${reportId}/resolve`,
        { method: "POST" }
      );
      const result: ActionResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "更新に失敗しました。");
      }

      await load(status);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("Unknown error");

      setError(err.message);
    } finally {
      setResolvingId("");
    }
  };

  const confirmDelete = async (shareId: string) => {
    if (deletingShareId) {
      return;
    }

    setDeletingShareId(shareId);
    setError("");

    try {
      const response = await fetch(`/api/admin/shares/${shareId}`, {
        method: "DELETE",
      });
      const result: ActionResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "削除に失敗しました。");
      }

      setConfirmingShareId("");
      await load(status);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("Unknown error");

      setError(err.message);
    } finally {
      setDeletingShareId("");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 justify-center p-4">
        <div className="w-full max-w-2xl space-y-6 py-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              通報の管理
            </h1>
            <p className="text-xs text-ink/50">
              ユーザーから報告された共有を確認し、対応します
            </p>
          </div>

          <div className="flex gap-2">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => switchStatus(tab.value)}
                className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                  status === tab.value
                    ? "bg-ink text-paper"
                    : "border border-ink/20 text-ink/60 hover:bg-ink/[0.06]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded border-2 border-brand p-3 text-sm font-bold text-brand">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex h-40 flex-col items-center justify-center gap-1 rounded border-2 border-ink p-10 text-center">
              <Spinner className="mb-1 h-6 w-6 text-brand" />
              <span className="text-xs font-bold text-ink/50">
                読み込み中...
              </span>
            </div>
          ) : reports.length === 0 ? (
            <div className="rounded border-2 border-ink/10 p-10 text-center text-sm text-ink/50">
              該当する通報はありません
            </div>
          ) : (
            <ul className="space-y-3">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className={`space-y-3 rounded-lg border bg-paper p-5 ${
                    report.category === "csam"
                      ? "border-2 border-red-600"
                      : "border-ink/10"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="font-mono text-xs text-ink/50">
                        共有ID: {report.shareId}
                      </p>
                      <p className="text-xs text-ink/40">
                        報告日時: {formatDateTime(report.createdAt)}
                      </p>
                      {report.resolvedAt && (
                        <p className="text-xs text-ink/40">
                          対応日時: {formatDateTime(report.resolvedAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {report.category === "csam" && (
                        <span className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                          緊急対応
                        </span>
                      )}
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          report.category === "csam"
                            ? "bg-red-600/10 text-red-700"
                            : "bg-brand/10 text-brand"
                        }`}
                      >
                        {categoryLabel(report.category)}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          report.share.exists
                            ? "bg-ink/10 text-ink/70"
                            : "bg-ink/5 text-ink/40"
                        }`}
                      >
                        {shareStatusLabel(report.share)}
                      </span>
                    </div>
                  </div>

                  {report.reportType === "rights_holder" && (
                    <div className="space-y-0.5 rounded border border-brand/20 bg-brand/5 p-3 text-xs text-ink/70">
                      <p>
                        <span className="font-bold">申立者:</span>{" "}
                        {report.claimantName}
                      </p>
                      <p>
                        <span className="font-bold">連絡先:</span>{" "}
                        {report.contactEmail}
                      </p>
                      <p>
                        <span className="font-bold">権利の種類:</span>{" "}
                        {rightTypeLabel(report.rightType)}
                      </p>
                    </div>
                  )}

                  <p className="whitespace-pre-wrap text-sm text-ink/80">
                    {report.reason}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {!report.resolvedAt && (
                      <button
                        onClick={() => resolveReport(report.id)}
                        disabled={resolvingId === report.id}
                        className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
                      >
                        {resolvingId === report.id
                          ? "更新中..."
                          : "対応済みにする"}
                      </button>
                    )}

                    {confirmingShareId === report.shareId ? (
                      <div className="flex items-center gap-2 rounded border-2 border-brand px-2 py-1">
                        <span className="text-xs font-bold text-brand">
                          本当に削除しますか？
                        </span>
                        <button
                          onClick={() => confirmDelete(report.shareId)}
                          disabled={deletingShareId === report.shareId}
                          className="rounded bg-brand px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-brand/90 disabled:opacity-40"
                        >
                          {deletingShareId === report.shareId
                            ? "削除中..."
                            : "削除する"}
                        </button>
                        <button
                          onClick={() => setConfirmingShareId("")}
                          disabled={deletingShareId === report.shareId}
                          className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      report.share.exists && (
                        <button
                          onClick={() =>
                            setConfirmingShareId(report.shareId)
                          }
                          className="rounded border-2 border-brand px-3 py-1.5 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
                        >
                          共有を削除する
                        </button>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
