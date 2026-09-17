import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// トップページはSSRのみを担い、サーバー側のデータキャッシュを持たない。
export default defineCloudflareConfig({});
