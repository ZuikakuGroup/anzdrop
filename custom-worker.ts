// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` does not exist before build, so @ts-expect-error would itself error out post-build
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { app } from "./server/app";
import { runScheduledTask } from "./lib/scheduled";

export default {
  fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    return pathname === "/api" || pathname.startsWith("/api/")
      ? app.fetch(request, env, ctx)
      : handler.fetch(request, env, ctx);
  },

  async scheduled(event, env) {
    await runScheduledTask(event, env);
  },
} satisfies ExportedHandler<CloudflareEnv>;
