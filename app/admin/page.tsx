import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt } from "@/lib/access";
import AdminReportsPage from "@/components/admin/AdminReportsPage";

// Cloudflare Accessがエッジで/adminを既に保護しているが、Access側の設定ミス等で
// オリジンまで素通りした場合の多層防御。管理者と検証できない場合は、管理画面の
// 存在自体を明かさないよう(403やログイン画面ではなく)404を返す。
export default async function Page() {
  const { env } = getCloudflareContext();
  const identity = await verifyAccessJwt(await headers(), env);

  if (!identity) {
    notFound();
  }

  return <AdminReportsPage />;
}
