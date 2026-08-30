"use client";

import { useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import AdminNav from "@/components/admin/AdminNav";
import { formatDateTime } from "@/lib/admin/reportLabels";
import { PLAN_LABELS } from "@/lib/plan";
import {
  fetchAccount,
  grantPlan,
  revokePlan,
  type AdminAccountInfo,
  type GrantPlan,
} from "@/lib/admin/accountsApi";

type ExpiryMode = "date" | "indefinite";

function toErrorMessage(unknownErr: unknown): string {
  return unknownErr instanceof Error ? unknownErr.message : "不明なエラー";
}

// <input type="date"> の値(YYYY-MM-DD)を、その日の終わり(UTC)までを有効と
// するISO日時へ変換する。サーバー側は「未来の日時であること」だけを見る。
function endOfDayIso(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

function planStateLabel(account: AdminAccountInfo): string {
  const stored = PLAN_LABELS[account.storedPlan];

  if (account.effectivePlan === account.storedPlan) {
    return stored;
  }

  // DB上は有料だが期限切れ。実効プランはfree。
  return `${stored}(期限切れ・実効: ${PLAN_LABELS[account.effectivePlan]})`;
}

function expiryLabel(account: AdminAccountInfo): string {
  if (account.indefinite) {
    return "無期限";
  }

  if (!account.planExpiresAt) {
    return "なし";
  }

  return formatDateTime(account.planExpiresAt);
}

export default function AdminAccountsPage() {
  const [accountIdInput, setAccountIdInput] = useState("");
  const [searchedAccountId, setSearchedAccountId] = useState("");
  const [account, setAccount] = useState<AdminAccountInfo | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [plan, setPlan] = useState<GrantPlan>("premium");
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("date");
  const [expiryDate, setExpiryDate] = useState("");

  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmingGrant, setConfirmingGrant] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const resetActionState = () => {
    setActionError("");
    setConfirmingGrant(false);
    setConfirmingRevoke(false);
  };

  const search = async () => {
    const accountId = accountIdInput.trim();

    if (!accountId || isSearching) {
      return;
    }

    setIsSearching(true);
    setSearchError("");
    resetActionState();
    // 検索中に前回のアカウントを対象に付与・取り消しが実行されないよう、
    // 表示中のアカウント情報を先にクリアする。
    setAccount(null);
    setSearchedAccountId("");

    try {
      const info = await fetchAccount(accountId);

      setAccount(info);
      setSearchedAccountId(accountId);
    } catch (unknownErr) {
      setSearchError(toErrorMessage(unknownErr));
      setAccount(null);
    } finally {
      setIsSearching(false);
    }
  };

  const submitGrant = async () => {
    if (actionPending) {
      return;
    }

    let expiresAt: string | null;

    if (expiryMode === "indefinite") {
      expiresAt = null;
    } else if (!expiryDate) {
      setActionError("終了日を入力してください");
      return;
    } else {
      expiresAt = endOfDayIso(expiryDate);

      if (Number.isNaN(Date.parse(expiresAt))) {
        setActionError("終了日が正しくありません");
        return;
      }

      if (Date.parse(expiresAt) <= Date.now()) {
        setActionError("終了日には未来の日付を指定してください");
        return;
      }
    }

    setActionPending(true);
    setActionError("");

    try {
      const updated = await grantPlan(searchedAccountId, { plan, expiresAt });

      setAccount(updated);
      setConfirmingGrant(false);
    } catch (unknownErr) {
      setActionError(toErrorMessage(unknownErr));
    } finally {
      setActionPending(false);
    }
  };

  const submitRevoke = async () => {
    if (actionPending) {
      return;
    }

    setActionPending(true);
    setActionError("");

    try {
      const updated = await revokePlan(searchedAccountId);

      setAccount(updated);
      setConfirmingRevoke(false);
    } catch (unknownErr) {
      setActionError(toErrorMessage(unknownErr));
    } finally {
      setActionPending(false);
    }
  };

  const canRevoke =
    account !== null &&
    account.exists &&
    (account.storedPlan !== "free" || account.planExpiresAt !== null);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 justify-center p-4">
        <div className="w-full max-w-2xl space-y-6 py-8">
          <AdminNav active="accounts" />

          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              アカウントのプラン管理
            </h1>
            <p className="text-xs text-ink/50">
              アカウントIDを指定して、Standard / Premium
              プランを手動で付与・取り消しします
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-ink/10 bg-paper p-5">
            <div className="space-y-1">
              <h2 className="text-sm font-black">アカウントを検索する</h2>
              <p className="text-xs text-ink/50">
                アカウントIDを入力して現在のプランを確認します
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={accountIdInput}
                onChange={(event) => setAccountIdInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    search();
                  }
                }}
                placeholder="アカウントID"
                className="w-full min-w-0 max-w-xs rounded border-2 border-ink/20 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              />
              <button
                onClick={search}
                disabled={isSearching || !accountIdInput.trim()}
                className="rounded border-2 border-ink/20 px-3 py-2 text-xs font-bold transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
              >
                {isSearching ? "検索中..." : "検索"}
              </button>
            </div>

            {searchError && (
              <p className="text-sm font-bold text-brand">{searchError}</p>
            )}

            {account && !account.exists && (
              <p className="rounded border border-ink/10 p-3 text-sm text-ink/60">
                アカウントID「{searchedAccountId}
                」のアカウントは存在しません。
              </p>
            )}

            {account && account.exists && (
              <div className="space-y-4 rounded border border-ink/10 p-4">
                <div className="space-y-1">
                  <p className="font-mono text-xs text-ink/50">
                    アカウントID: {searchedAccountId}
                  </p>
                  <p className="text-sm text-ink/80">
                    <span className="font-bold">現在のプラン:</span>{" "}
                    {planStateLabel(account)}
                  </p>
                  <p className="text-sm text-ink/80">
                    <span className="font-bold">有効期限:</span>{" "}
                    {expiryLabel(account)}
                  </p>
                </div>

                {account.hasStripeSubscription && (
                  <p className="rounded border-2 border-amber-500/40 bg-amber-500/10 p-3 text-xs font-bold text-amber-700">
                    このアカウントにはStripeのサブスクリプションが紐づいています。
                    ここで付与・取り消しをしても、次回のStripe同期やWebhookで
                    実際の契約内容に上書きされることがあります。カード契約自体を
                    止めるにはStripe側で解約してください。
                  </p>
                )}

                <div className="space-y-3 border-t border-ink/10 pt-4">
                  <h3 className="text-sm font-black">プランを付与する</h3>

                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-ink/60">プラン</p>
                    <div className="flex gap-2">
                      {(["standard", "premium"] as GrantPlan[]).map((value) => (
                        <button
                          key={value}
                          onClick={() => {
                            setPlan(value);
                            resetActionState();
                          }}
                          className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                            plan === value
                              ? "bg-ink text-paper"
                              : "border border-ink/20 text-ink/60 hover:bg-ink/[0.06]"
                          }`}
                        >
                          {PLAN_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-ink/60">有効期限</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs font-bold text-ink/70">
                        <input
                          type="radio"
                          name="expiryMode"
                          checked={expiryMode === "date"}
                          onChange={() => {
                            setExpiryMode("date");
                            resetActionState();
                          }}
                        />
                        終了日を指定
                      </label>
                      <label className="flex items-center gap-1.5 text-xs font-bold text-ink/70">
                        <input
                          type="radio"
                          name="expiryMode"
                          checked={expiryMode === "indefinite"}
                          onChange={() => {
                            setExpiryMode("indefinite");
                            resetActionState();
                          }}
                        />
                        無期限
                      </label>
                    </div>

                    {expiryMode === "date" && (
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(event) => {
                          setExpiryDate(event.target.value);
                          resetActionState();
                        }}
                        className="rounded border-2 border-ink/20 px-3 py-1.5 text-sm outline-none focus:border-brand"
                      />
                    )}
                  </div>

                  {actionError && (
                    <p className="text-sm font-bold text-brand">{actionError}</p>
                  )}

                  {confirmingGrant ? (
                    <div className="flex flex-wrap items-center gap-2 rounded border-2 border-ink/20 px-3 py-2">
                      <span className="text-xs font-bold text-ink/70">
                        {PLAN_LABELS[plan]}を
                        {expiryMode === "indefinite"
                          ? "無期限で"
                          : `${expiryDate || "?"} まで`}
                        付与しますか？
                      </span>
                      <button
                        onClick={submitGrant}
                        disabled={actionPending}
                        className="rounded bg-ink px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-ink/90 disabled:opacity-40"
                      >
                        {actionPending ? "付与中..." : "付与する"}
                      </button>
                      <button
                        onClick={() => setConfirmingGrant(false)}
                        disabled={actionPending}
                        className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setActionError("");
                        setConfirmingRevoke(false);
                        setConfirmingGrant(true);
                      }}
                      className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-ink/[0.06]"
                    >
                      このプランを付与する
                    </button>
                  )}
                </div>

                {canRevoke && (
                  <div className="space-y-2 border-t border-ink/10 pt-4">
                    <h3 className="text-sm font-black">無料プランに戻す</h3>
                    <p className="text-xs text-ink/50">
                      プランを無料に戻し、有効期限を消去します(誤付与の取り消しなど)
                    </p>

                    {confirmingRevoke ? (
                      <div className="flex flex-wrap items-center gap-2 rounded border-2 border-brand px-3 py-2">
                        <span className="text-xs font-bold text-brand">
                          無料プランに戻しますか？
                        </span>
                        <button
                          onClick={submitRevoke}
                          disabled={actionPending}
                          className="rounded bg-brand px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-brand/90 disabled:opacity-40"
                        >
                          {actionPending ? "変更中..." : "無料プランに戻す"}
                        </button>
                        <button
                          onClick={() => setConfirmingRevoke(false)}
                          disabled={actionPending}
                          className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setActionError("");
                          setConfirmingGrant(false);
                          setConfirmingRevoke(true);
                        }}
                        className="rounded border-2 border-brand px-3 py-1.5 text-xs font-bold text-brand transition-colors hover:bg-brand/10"
                      >
                        無料プランに戻す
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
