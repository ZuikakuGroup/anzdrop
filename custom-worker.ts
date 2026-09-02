// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` does not exist before build, so @ts-expect-error would itself error out post-build
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { runScheduledCleanup } from "./lib/cleanup";

export default {
  fetch: handler.fetch,

  async scheduled(_event, env) {
    await runScheduledCleanup(env);
  },
} satisfies ExportedHandler<CloudflareEnv>;
