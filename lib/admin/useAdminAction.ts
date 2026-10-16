import { useEffect, useRef, useState } from "react";

export function useAdminAction(setError: (message: string) => void) {
  const [pendingId, setPendingId] = useState("");
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = async (id: string, request: () => Promise<unknown>, onSuccess: () => void | Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPendingId(id);
    setError("");
    try {
      await request();
      if (mounted.current) await onSuccess();
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : "不明なエラー");
    } finally {
      busy.current = false;
      if (mounted.current) setPendingId("");
    }
  };
  return { pendingId, run };
}
