"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import AdminNav from "@/components/admin/AdminNav";
import { formatDateTime } from "@/lib/admin/reportLabels";
import {
  deleteContact as deleteContactRequest,
  fetchContacts,
  resolveContact as resolveContactRequest,
  type AdminContact,
  type StatusFilter,
} from "@/lib/admin/contactsApi";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "open", label: "未対応" },
  { value: "resolved", label: "対応済み" },
  { value: "all", label: "すべて" },
];

export default function AdminContactsPage() {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [contacts, setContacts] = useState<AdminContact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState("");
  const [confirmingContactId, setConfirmingContactId] = useState("");
  const [deletingContactId, setDeletingContactId] = useState("");

  // ステータスタブの切り替えと、対応済み・削除操作後の再読み込み(load)は
  // どちらも非同期にfetchContactsを呼び出す。これらが重なって発行される
  // と、古いリクエストの応答が新しいリクエストの応答より後に返ってくる
  // ことがあり、その場合は新しい結果を古い結果で上書きしてしまう(例:
  // 削除したはずの項目が再表示される、対応済みにしたはずが未対応に戻る)。
  // requestIdRefでリクエストごとに発行するIDを管理し、応答が届いた時点で
  // 自分が最後に発行された(＝最新の)リクエストかどうかを確認してから
  // 状態に反映する。
  const statusRef = useRef(status);
  const requestIdRef = useRef(0);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const targetStatus = statusRef.current;

    try {
      const contacts = await fetchContacts(targetStatus);

      if (requestIdRef.current !== requestId) {
        return;
      }

      setContacts(contacts);
      setError("");
    } catch (unknownErr) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;

    fetchContacts(status)
      .then((contacts) => {
        if (!cancelled && requestIdRef.current === requestId) {
          setContacts(contacts);
          setError("");
        }
      })
      .catch((unknownErr: unknown) => {
        if (!cancelled && requestIdRef.current === requestId) {
          const err =
            unknownErr instanceof Error
              ? unknownErr
              : new Error("不明なエラー");

          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === requestId) {
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

  const resolveContact = async (contactId: string) => {
    if (resolvingId) {
      return;
    }

    setResolvingId(contactId);
    setError("");

    try {
      await resolveContactRequest(contactId);
      await load();
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setResolvingId("");
    }
  };

  const confirmDeleteContact = async (contactId: string) => {
    if (deletingContactId) {
      return;
    }

    setDeletingContactId(contactId);
    setError("");

    try {
      await deleteContactRequest(contactId);

      setConfirmingContactId("");
      await load();
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setDeletingContactId("");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 justify-center p-4">
        <div className="w-full max-w-2xl space-y-6 py-8">
          <AdminNav active="contacts" />

          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              お問い合わせの管理
            </h1>
            <p className="text-xs text-ink/50">
              ユーザーから届いたお問い合わせを確認し、対応します
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
          ) : contacts.length === 0 ? (
            <div className="rounded border-2 border-ink/10 p-10 text-center text-sm text-ink/50">
              該当するお問い合わせはありません
            </div>
          ) : (
            <ul className="space-y-3">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className="space-y-3 rounded-lg border border-ink/10 bg-paper p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-ink">
                        {contact.subject}
                      </p>
                      <p className="text-xs text-ink/50">
                        {contact.name ? `${contact.name} · ` : ""}
                        {contact.email}
                      </p>
                      <p className="text-xs text-ink/40">
                        受信日時: {formatDateTime(contact.createdAt)}
                      </p>
                      {contact.resolvedAt && (
                        <p className="text-xs text-ink/40">
                          対応日時: {formatDateTime(contact.resolvedAt)}
                        </p>
                      )}
                    </div>
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-ink/80">
                    {contact.message}
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {!contact.resolvedAt && (
                      <button
                        onClick={() => resolveContact(contact.id)}
                        disabled={resolvingId === contact.id}
                        className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold transition-colors hover:bg-ink/[0.06] disabled:opacity-40"
                      >
                        {resolvingId === contact.id
                          ? "更新中..."
                          : "対応済みにする"}
                      </button>
                    )}

                    {confirmingContactId === contact.id ? (
                      <div className="flex items-center gap-2 rounded border-2 border-ink/20 px-2 py-1">
                        <span className="text-xs font-bold text-ink/70">
                          このお問い合わせを削除しますか？
                        </span>
                        <button
                          onClick={() => confirmDeleteContact(contact.id)}
                          disabled={deletingContactId === contact.id}
                          className="rounded bg-ink px-2 py-1 text-xs font-bold text-paper transition-colors hover:bg-ink/90 disabled:opacity-40"
                        >
                          {deletingContactId === contact.id
                            ? "削除中..."
                            : "削除する"}
                        </button>
                        <button
                          onClick={() => setConfirmingContactId("")}
                          disabled={deletingContactId === contact.id}
                          className="rounded px-2 py-1 text-xs font-bold text-ink/50 transition-colors hover:bg-ink/[0.06]"
                        >
                          キャンセル
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingContactId(contact.id)}
                        className="rounded border-2 border-ink/20 px-3 py-1.5 text-xs font-bold text-ink/60 transition-colors hover:bg-ink/[0.06]"
                      >
                        このお問い合わせを削除する
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
