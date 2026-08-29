export type StatusFilter = "open" | "resolved" | "all";

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

export async function fetchContacts(
  status: StatusFilter
): Promise<AdminContact[]> {
  const response = await fetch(`/api/admin/contacts?status=${status}`);
  const result: ContactsResponse = await response.json();

  if (!response.ok || !result.success || !result.contacts) {
    throw new Error(result.error ?? "読み込みに失敗しました。");
  }

  return result.contacts;
}

export async function resolveContact(contactId: string): Promise<void> {
  const response = await fetch(`/api/admin/contacts/${contactId}/resolve`, {
    method: "POST",
  });
  const result: ActionResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "更新に失敗しました。");
  }
}

export async function deleteContact(contactId: string): Promise<void> {
  const response = await fetch(`/api/admin/contacts/${contactId}`, {
    method: "DELETE",
  });
  const result: ActionResponse = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error ?? "削除に失敗しました。");
  }
}
