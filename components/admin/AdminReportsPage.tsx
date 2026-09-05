"use client";

import { useCallback, useEffect, useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import AdminNav from "@/components/admin/AdminNav";
import {
  categoryLabel,
  formatDateTime,
  rightTypeLabel,
  shareStatusLabel,
  type ShareInfo,
} from "@/lib/admin/reportLabels";
import {
  deleteReport as deleteReportRequest,
  deleteShare as deleteShareRequest,
  fetchReports,
  fetchShareInfo,
  resolveReport as resolveReportRequest,
  toggleShareSuspend as toggleShareSuspendRequest,
  type AdminReport,
  type StatusFilter,
} from "@/lib/admin/reportsApi";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "未対応" },
  { value: "resolved", label: "対応済み" },
  { value: "all", label: "すべて" },
];

export default function AdminReportsPage() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState("");
  const [confirmingShareId, setConfirmingShareId] = useState("");
  const [deletingShareId, setDeletingShareId] = useState("");
  const [togglingShareId, setTogglingShareId] = useState("");
  const [confirmingReportId, setConfirmingReportId] = useState("");
  const [deletingReportId, setDeletingReportId] = useState("");

  const [lookupShareId, setLookupShareId] = useState("");
  const [lookedUpShareId, setLookedUpShareId] = useState("");
  const [lookupResult, setLookupResult] = useState<ShareInfo | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupConfirmingDelete, setLookupConfirmingDelete] = useState(false);
  const [lookupActionPending, setLookupActionPending] = useState(false);

  // クリックハンドラなどエフェクト外から呼ぶための、状態更新込みの再読み込み。
  const load = useCallback(async (targetStatus: StatusFilter) => {
    try {
      setReports(await fetchReports(targetStatus));
      setError("");
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
              : new Error("不明なエラー");

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
  }, [status]);

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
      await resolveReportRequest(reportId);
      await load(status);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("不明なエラー");

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
      await deleteShareRequest(shareId);

      setConfirmingShareId("");
      await load(status);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setDeletingShareId("");
    }
  };

  const toggleSuspend = async (shareId: string, suspend: boolean) => {
    if (togglingShareId) {
      return;
    }

    setTogglingShareId(shareId);
    setError("");

    try {
      await toggleShareSuspendRequest(shareId, suspend);
      await load(status);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setTogglingShareId("");
    }
  };

  const searchShare = async () => {
    const shareId = lookupShareId.trim();

    if (!shareId || isLookingUp) {
      return;
    }

    setIsLookingUp(true);
    setLookupError("");
    setLookupConfirmingDelete(false);

    try {
      const info = await fetchShareInfo(shareId);

      setLookupResult(info);
      setLookedUpShareId(shareId);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setLookupError(err.message);
      setLookupResult(null);
    } finally {
      setIsLookingUp(false);
    }
  };

  const lookupToggleSuspend = async (suspend: boolean) => {
    if (lookupActionPending) {
      return;
    }

    setLookupActionPending(true);
    setLookupError("");

    try {
      await toggleShareSuspendRequest(lookedUpShareId, suspend);
      setLookupResult(await fetchShareInfo(lookedUpShareId));
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setLookupError(err.message);
    } finally {
      setLookupActionPending(false);
    }
  };

  const lookupDeleteShare = async () => {
    if (lookupActionPending) {
      return;
    }

    setLookupActionPending(true);
    setLookupError("");

    try {
      await deleteShareRequest(lookedUpShareId);
      setLookupConfirmingDelete(false);
      setLookupResult(await fetchShareInfo(lookedUpShareId));
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setLookupError(err.message);
    } finally {
      setLookupActionPending(false);
    }
  };

  const confirmDeleteReport = async (reportId: string) => {
    if (deletingReportId) {
      return;
    }

    setDeletingReportId(reportId);
    setError("");

    try {
      await deleteReportRequest(reportId);

      setConfirmingReportId("");
      await load(status);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setDeletingReportId("");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 justify-center p-4">
        <div className="w-full max-w-2xl space-y-6 py-8">
          <AdminNav active="reports" />

          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              通報の管理
            </h1>
            <p className="text-xs text-ink/50">
              ユーザーから報告された共有を確認し、対応します
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-ink/10 bg-paper p-5">
            <div className="space-y-1">
              <h2 className="text-sm font-black">共有IDを直接操作する</h2>
              <p className="text-xs text-ink/50">
                通報の有無にかかわらず、共有IDを指定して一時停止・削除ができます
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={lookupShareId}
                onChange={(event) => setLookupShareId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    searchShare();
                  }
                }}
                placeholder="共有ID"
                className="w-full min-w-0 max-w-xs rounded border-2 border-ink/20 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              />
              <button
                onClick={searchShare}
                disabled={isLookingUp || !lookupShareId.trim()}
                className="rounded border-2 border-ink/20 px-3 py-2 text-xs font-bold transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
              >
                {isLookingUp ? "検索中..." : "検索"}
              </button>
            </div>

            {lookupError && (
              <p className="text-sm font-bold text-brand">{lookupError}</p>
            )}

            {lookupResult && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-ink/10 p-3">
                <div className="space-y-0.5">
                  <p className="font-mono text-xs text-ink/50">
                    共有ID: {lookedUpShareId}
                  </p>
                  <p className="text-xs text-ink/70">
                    {shareStatusLabel(lookupResult)}
                  </p>
                </div>

                {lookupResult.exists && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        lookupToggleSuspend(!lookupResult.suspended)
                      }
                      disabled={lookupActionPending}
                      className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
                    >
                      {lookupResult.suspended
                        ? "一時停止を解除する"
                        : "一時停止する"}
                    </button>

                    {lookupConfirmingDelete ? (
                      <div className="flex items-center gap-2 rounded border-2 border-brand px-2 py-1">
                        <span className="text-xs font-bold text-brand">
                          本当に削除しますか？
                        </span>
                        <button
                          onClick={lookupDeleteShare}
                          disabled={lookupActionPending}
                          className="rounded bg-brand px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-brand/90 disabled:opacity-40"
                        >
                          削除する
                        </button>
                        <button
                          onClick={() => setLookupConfirmingDelete(false)}
                          disabled={lookupActionPending}
                          className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setLookupConfirmingDelete(true)}
                        className="rounded border-2 border-brand px-3 py-1.5 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
                      >
                        共有を削除する
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
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
                          report.share.exists && report.share.suspended
                            ? "bg-amber-500/10 text-amber-700"
                            : report.share.exists
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

                    {report.share.exists && (
                      <button
                        onClick={() =>
                          toggleSuspend(report.shareId, !report.share.suspended)
                        }
                        disabled={togglingShareId === report.shareId}
                        className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
                      >
                        {togglingShareId === report.shareId
                          ? "更新中..."
                          : report.share.suspended
                            ? "一時停止を解除する"
                            : "一時停止する"}
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

                    {confirmingReportId === report.id ? (
                      <div className="flex items-center gap-2 rounded border-2 border-ink/20 px-2 py-1">
                        <span className="text-xs font-bold text-ink/70">
                          この通報を削除しますか？
                        </span>
                        <button
                          onClick={() => confirmDeleteReport(report.id)}
                          disabled={deletingReportId === report.id}
                          className="rounded bg-ink px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-ink/90 disabled:opacity-40"
                        >
                          {deletingReportId === report.id
                            ? "削除中..."
                            : "削除する"}
                        </button>
                        <button
                          onClick={() => setConfirmingReportId("")}
                          disabled={deletingReportId === report.id}
                          className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingReportId(report.id)}
                        className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold text-ink/60 transition-colors hover:bg-ink/[0.06]"
                      >
                        この通報を削除する
                      </button>
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
