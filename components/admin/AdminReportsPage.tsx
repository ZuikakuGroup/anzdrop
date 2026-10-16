"use client";

import AdminShell from "./AdminShell";
import ConfirmDelete from "./ConfirmDelete";

import { useState } from "react";
import { useAdminList } from "@/lib/admin/useAdminList";
import { useAdminAction } from "@/lib/admin/useAdminAction";
import Spinner from "@/components/brand/Spinner";
import StatusFilterTabs from "@/components/admin/StatusFilterTabs";
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
} from "@/lib/admin/reportsApi";

export default function AdminReportsPage() {
  const { status, items: reports, isLoading, error, setError, switchStatus, load } = useAdminList(fetchReports);
  const resolveReportAction = useAdminAction(setError);
  const resolvingId = resolveReportAction.pendingId;
  const [confirmingShareId, setConfirmingShareId] = useState("");
  const confirmDeleteAction = useAdminAction(setError);
  const deletingShareId = confirmDeleteAction.pendingId;
  const toggleSuspendAction = useAdminAction(setError);
  const togglingShareId = toggleSuspendAction.pendingId;
  const [confirmingReportId, setConfirmingReportId] = useState("");
  const confirmDeleteReportAction = useAdminAction(setError);
  const deletingReportId = confirmDeleteReportAction.pendingId;

  const [lookupShareId, setLookupShareId] = useState("");
  const [lookedUpShareId, setLookedUpShareId] = useState("");
  const [lookupResult, setLookupResult] = useState<ShareInfo | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [lookupConfirmingDelete, setLookupConfirmingDelete] = useState(false);
  const [lookupActionPending, setLookupActionPending] = useState(false);

  const resolveReport = (reportId: string) =>
    resolveReportAction.run(reportId, () => resolveReportRequest(reportId), async () => {
      await load();
    });

  const confirmDelete = (shareId: string) =>
    confirmDeleteAction.run(shareId, () => deleteShareRequest(shareId), async () => {
      setConfirmingShareId("");
      await load();
    });

  const toggleSuspend = (shareId: string, suspend: boolean) =>
    toggleSuspendAction.run(shareId, () => toggleShareSuspendRequest(shareId, suspend), async () => {
      await load();
    });

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

  const confirmDeleteReport = (reportId: string) =>
    confirmDeleteReportAction.run(reportId, () => deleteReportRequest(reportId), async () => {
      setConfirmingReportId("");
      await load();
    });

  return (
    <AdminShell active="reports">

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

      <StatusFilterTabs status={status} onChange={switchStatus} />

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
                  <ConfirmDelete pending={deletingReportId === report.id}
                    onConfirm={() => confirmDeleteReport(report.id)} onCancel={() => setConfirmingReportId("")}>
                    この通報を削除しますか？
                  </ConfirmDelete>
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
    </AdminShell>
  );
}
