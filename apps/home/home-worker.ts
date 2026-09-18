// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` はビルド時に生成される。
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { dispatchHomeRequest } from "./home-worker-routing";

type HomeWorkerEnv = CloudflareEnv & {
  ASSETS: Fetcher;
};

export default {
  fetch(request: Request, env: HomeWorkerEnv, ctx: ExecutionContext) {
    return dispatchHomeRequest(request, env, ctx, handler);
  },
} satisfies ExportedHandler<HomeWorkerEnv>;
