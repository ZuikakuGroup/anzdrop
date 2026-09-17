import { isHomeRequest } from "./routing";

type ServiceBinding = {
  fetch(request: Request): Response | Promise<Response>;
};

type RouterEnv = {
  HOME: ServiceBinding;
  APP: ServiceBinding;
};

type RouterHandler = {
  fetch(request: Request, env: RouterEnv): Response | Promise<Response>;
};

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    // Requestをそのまま渡し、Cookie・本文・レスポンスストリームを加工しない。
    // /api を含む既存の全経路は従来Workerへ送るため、認証とE2EEの境界は変わらない。
    return isHomeRequest(pathname)
      ? env.HOME.fetch(request)
      : env.APP.fetch(request);
  },
} satisfies RouterHandler;
