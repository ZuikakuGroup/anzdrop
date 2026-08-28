import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt } from "@/lib/access";
import AdminReportsPage from "@/components/admin/AdminReportsPage";

// Cloudflare Accessがエッジで/adminを既に保護しているが、Access側の設定ミス等で
// オリジンまで素通りした場合の多層防御。管理者と検証できない場合は、管理画面の
// 存在自体を明かさないよう(403やログイン画面ではなく)404を返す。
export default async function Page() {
  // headers()(動的API)を先に呼ぶことで、Next.jsがこのルートを動的だと
  // 認識する前に同期版getCloudflareContext()が実行され、ビルド時の
  // 静的プリレンダリング判定で失敗するのを防ぐ。
  const requestHeaders = await headers();
  const { env } = getCloudflareContext();
  const identity = await verifyAccessJwt(requestHeaders, env);

  if (!identity) {
    notFound();
  }

  return <AdminReportsPage />;
}
