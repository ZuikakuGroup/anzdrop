import { isHomeRequest, isPublicRequest } from "./routing";

type ServiceBinding = {
  fetch(request: Request): Response | Promise<Response>;
};

type RouterEnv = {
  HOME: ServiceBinding;
  APP: ServiceBinding;
  PUBLIC: ServiceBinding;
};

type RouterHandler = {
  fetch(request: Request, env: RouterEnv): Response | Promise<Response>;
};

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;

    // Requestをそのまま渡し、Cookie・本文・レスポンスストリームを加工しない。
    // /api は既存APPのHonoへ、対話画面はPUBLICのAstro/Reactへ送る。
    return isHomeRequest(pathname)
      ? env.HOME.fetch(request)
      : isPublicRequest(pathname) ? env.PUBLIC.fetch(request) : env.APP.fetch(request);
  },
} satisfies RouterHandler;
