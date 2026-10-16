import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminStatusFilter } from "./statusFilter";

// Initial loads and mutation reloads share one sequence, including across tab changes.
export function useAdminList<T>(fetchList: (status: AdminStatusFilter) => Promise<T[]>) {
  const [status, setStatus] = useState<AdminStatusFilter>("open");
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const statusRef = useRef(status);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    const current = () => sequence.current === requestId;
    try {
      const result = await fetchList(statusRef.current);
      if (current()) { setItems(result); setError(""); }
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : "不明なエラー");
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [fetchList]);

  useEffect(() => {
    void load();
    return () => { sequence.current++; };
  }, [load, status]);

  const switchStatus = (next: AdminStatusFilter) => {
    if (next === statusRef.current) return;
    statusRef.current = next;
    sequence.current++;
    setIsLoading(true);
    setStatus(next);
  };

  return { status, items, isLoading, error, setError, switchStatus, load };
}
