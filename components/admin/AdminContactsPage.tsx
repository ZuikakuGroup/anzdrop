"use client";

import AdminShell from "./AdminShell";
import ConfirmDelete from "./ConfirmDelete";

import { useState } from "react";
import { useAdminList } from "@/lib/admin/useAdminList";
import { useAdminAction } from "@/lib/admin/useAdminAction";
import Spinner from "@/components/brand/Spinner";
import StatusFilterTabs from "@/components/admin/StatusFilterTabs";
import { formatDateTime } from "@/lib/admin/reportLabels";
import {
  deleteContact as deleteContactRequest,
  fetchContacts,
  resolveContact as resolveContactRequest,
} from "@/lib/admin/contactsApi";

export default function AdminContactsPage() {
  const { status, items: contacts, isLoading, error, setError, switchStatus, load } = useAdminList(fetchContacts);
  const resolveContactAction = useAdminAction(setError);
  const resolvingId = resolveContactAction.pendingId;
  const [confirmingContactId, setConfirmingContactId] = useState("");
  const confirmDeleteContactAction = useAdminAction(setError);
  const deletingContactId = confirmDeleteContactAction.pendingId;

  const resolveContact = (contactId: string) =>
    resolveContactAction.run(contactId, () => resolveContactRequest(contactId), async () => {
      await load();
    });

  const confirmDeleteContact = (contactId: string) =>
    confirmDeleteContactAction.run(contactId, () => deleteContactRequest(contactId), async () => {
      setConfirmingContactId("");
      await load();
    });

  return (
    <AdminShell active="contacts">

      <div className="space-y-1">
        <h1 className="text-2xl font-black leading-snug tracking-normal">
          お問い合わせの管理
        </h1>
        <p className="text-xs text-ink/50">
          ユーザーから届いたお問い合わせを確認し、対応します
        </p>
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
                  <ConfirmDelete pending={deletingContactId === contact.id}
                    onConfirm={() => confirmDeleteContact(contact.id)} onCancel={() => setConfirmingContactId("")}>
                    このお問い合わせを削除しますか？
                  </ConfirmDelete>
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
    </AdminShell>
  );
}
