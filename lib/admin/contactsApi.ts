import { requestJson } from "@/lib/api/client";
import type { AdminStatusFilter } from "@/lib/admin/statusFilter";

export type StatusFilter = AdminStatusFilter;

export type AdminContact = {
  id: string;
  name: string | null;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
};

type ContactsResponse = {
  success: boolean;
  contacts?: AdminContact[];
  error?: string;
};

type ActionResponse = {
  success: boolean;
  error?: string;
};

export async function fetchContacts(status: StatusFilter): Promise<AdminContact[]> {
  const result = await requestJson<ContactsResponse>(`/api/admin/contacts?status=${status}`, undefined, "読み込みに失敗しました。");
  if (!result.contacts) throw new Error(result.error ?? "読み込みに失敗しました。");
  return result.contacts;
}

export async function resolveContact(contactId: string): Promise<void> {
  await requestJson<ActionResponse>(`/api/admin/contacts/${contactId}/resolve`, { method: "POST" }, "更新に失敗しました。");
}

export async function deleteContact(contactId: string): Promise<void> {
  await requestJson<ActionResponse>(`/api/admin/contacts/${contactId}`, { method: "DELETE" }, "削除に失敗しました。");
}
