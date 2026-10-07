import { app } from "./app";
import { runScheduledTask } from "@/lib/scheduled";

export default {
  fetch: app.fetch,
  async scheduled(event, env) { await runScheduledTask(event, env); },
} satisfies ExportedHandler<CloudflareEnv>;
