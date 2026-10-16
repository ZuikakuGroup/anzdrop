const QUERIES = {
  contacts: {
    select: "SELECT id, resolved_at FROM contacts WHERE id = ?",
    update: "UPDATE contacts SET resolved_at = ? WHERE id = ?",
    missing: "お問い合わせが見つかりません",
  },
  reports: {
    select: "SELECT id, resolved_at FROM reports WHERE id = ?",
    update: "UPDATE reports SET resolved_at = ? WHERE id = ?",
    missing: "通報が見つかりません",
  },
} as const;

export async function resolveRecord(db: D1Database, kind: keyof typeof QUERIES, id: string): Promise<Response> {
  const query = QUERIES[kind];
  const row = await db.prepare(query.select).bind(id).first<{ id: string; resolved_at: string | null }>();
  if (!row) return Response.json({ success: false, error: query.missing }, { status: 404 });
  if (!row.resolved_at) await db.prepare(query.update).bind(new Date().toISOString(), id).run();
  return Response.json({ success: true });
}
