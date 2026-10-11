import { isApiRequest, isInternalRequest } from "./routing";

type ServiceBinding = { fetch(request: Request): Response | Promise<Response> };
type RouterEnv = { APP: ServiceBinding; PUBLIC: ServiceBinding };

export default {
  fetch(request: Request, env: RouterEnv) {
    const pathname = new URL(request.url).pathname;
    if (isInternalRequest(pathname)) {
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    // Forward cookies, bodies and response streams without modification.
    return isApiRequest(pathname) ? env.APP.fetch(request) : env.PUBLIC.fetch(request);
  },
};
