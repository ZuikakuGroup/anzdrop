import { Hono } from "hono";
import { verifyAccessJwt } from "@/lib/access";
import { ADMIN_ACCESS_PATH } from "@/lib/adminPageAccess";
import { withWorkerRuntime } from "./runtime";
import type { RouteContext } from "@/lib/api/types";
import { buildStaticSecurityHeaders } from "@/lib/securityHeaders";
import * as accountLoginOtpRoute from "./routes/account/login/otp/route";
import * as accountLoginRoute from "./routes/account/login/route";
import * as accountLogoutRoute from "./routes/account/logout/route";
import * as accountMeRoute from "./routes/account/me/route";
import * as accountPasskeyOptionsRoute from "./routes/account/passkey/options/route";
import * as accountPasskeyVerifyRoute from "./routes/account/passkey/verify/route";
import * as accountRecoverRoute from "./routes/account/recover/route";
import * as accountSecurityCancelRoute from "./routes/account/security/cancel/route";
import * as accountSecurityPasskeysDeleteRoute from "./routes/account/security/passkeys/delete/route";
import * as accountSecurityPasskeysOptionsRoute from "./routes/account/security/passkeys/options/route";
import * as accountSecurityPasskeysVerifyRoute from "./routes/account/security/passkeys/verify/route";
import * as accountSecurityReauthOptionsRoute from "./routes/account/security/reauth/options/route";
import * as accountSecurityReauthPasswordRoute from "./routes/account/security/reauth/password/route";
import * as accountSecurityReauthVerifyRoute from "./routes/account/security/reauth/verify/route";
import * as accountSecurityRoute from "./routes/account/security/route";
import * as accountSecurityTotpConfirmRoute from "./routes/account/security/totp/confirm/route";
import * as accountSecurityTotpDisableRoute from "./routes/account/security/totp/disable/route";
import * as accountSecurityTotpSetupRoute from "./routes/account/security/totp/setup/route";
import * as accountSignupRoute from "./routes/account/signup/route";
import * as adminAccountsAccountIdRoute from "./routes/admin/accounts/[accountId]/route";
import * as adminStorageRoute from "./routes/admin/storage/route";
import * as adminAnalyticsRoute from "./routes/admin/analytics/route";
import * as adminContactsContactIdResolveRoute from "./routes/admin/contacts/[contactId]/resolve/route";
import * as adminContactsContactIdRoute from "./routes/admin/contacts/[contactId]/route";
import * as adminContactsRoute from "./routes/admin/contacts/route";
import * as adminReportsReportIdResolveRoute from "./routes/admin/reports/[reportId]/resolve/route";
import * as adminReportsReportIdRoute from "./routes/admin/reports/[reportId]/route";
import * as adminReportsRoute from "./routes/admin/reports/route";
import * as adminSharesShareIdRoute from "./routes/admin/shares/[shareId]/route";
import * as adminSharesShareIdSuspendRoute from "./routes/admin/shares/[shareId]/suspend/route";
import * as adminSharesShareIdUnsuspendRoute from "./routes/admin/shares/[shareId]/unsuspend/route";
import * as analyticsEventsRoute from "./routes/analytics/events/route";
import * as billingBtcChargeRoute from "./routes/billing/btc/charge/route";
import * as billingBtcWebhookRoute from "./routes/billing/btc/webhook/route";
import * as billingStripeCancellationRoute from "./routes/billing/stripe/cancellation/route";
import * as billingStripeSubscriptionRoute from "./routes/billing/stripe/subscription/route";
import * as billingStripeSyncRoute from "./routes/billing/stripe/sync/route";
import * as contactRoute from "./routes/contact/route";
import * as downloadShareIdRoute from "./routes/download/[shareId]/route";
import * as fileFileIdRoute from "./routes/file/[fileId]/route";
import * as reportRoute from "./routes/report/route";
import * as revalidateMicrocmsRoute from "./routes/revalidate/microcms/route";
import * as uploadChunkRoute from "./routes/upload/chunk/route";
import * as uploadCompleteRoute from "./routes/upload/complete/route";
import * as uploadPartAckRoute from "./routes/upload/part-ack/route";
import * as uploadPartUrlsRoute from "./routes/upload/part-urls/route";
import * as uploadStartRoute from "./routes/upload/start/route";

export const app = new Hono<{ Bindings: CloudflareEnv & { DEPLOYMENT_ENV?: string } }>({ strict: false });
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(buildStaticSecurityHeaders(c.env.DEPLOYMENT_ENV === "production"))) c.header(name, value);
});
app.onError(() => Response.json({ success: false, error: "サーバー内部でエラーが発生しました" }, { status: 500, headers: { "Cache-Control": "no-store" } }));
// The path supplies the parameter names; handlers keep their Request/Response interface.
type PathParams<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}` ? Name | PathParams<Rest> :
  Path extends `${string}:${infer Name}` ? Name : never;

function registerRoute<Path extends string>(
  method: "GET" | "POST" | "DELETE",
  path: Path,
  handler: (request: Request, context: RouteContext<Record<PathParams<Path>, string>>) => Promise<Response>,
) {
  app.on(method, path, c => {
    const params = c.req.param() as Record<string, string>;
    return withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () =>
      handler(c.req.raw, { params: Promise.resolve(params as Record<PathParams<Path>, string>) })
    );
  });
}

// Service-binding-only authentication probe. The public router blocks /__internal.
app.get(ADMIN_ACCESS_PATH, async c => {
  const identity = await verifyAccessJwt(c.req.raw.headers, c.env);
  return new Response(null, { status: identity ? 204 : 404 });
});
registerRoute("POST", "/api/account/login/otp", accountLoginOtpRoute.POST);
registerRoute("POST", "/api/account/login", accountLoginRoute.POST);
registerRoute("POST", "/api/account/logout", accountLogoutRoute.POST);
registerRoute("GET", "/api/account/me", accountMeRoute.GET);
registerRoute("POST", "/api/account/passkey/options", accountPasskeyOptionsRoute.POST);
registerRoute("POST", "/api/account/passkey/verify", accountPasskeyVerifyRoute.POST);
registerRoute("POST", "/api/account/recover", accountRecoverRoute.POST);
registerRoute("POST", "/api/account/security/cancel", accountSecurityCancelRoute.POST);
registerRoute("POST", "/api/account/security/passkeys/delete", accountSecurityPasskeysDeleteRoute.POST);
registerRoute("POST", "/api/account/security/passkeys/options", accountSecurityPasskeysOptionsRoute.POST);
registerRoute("POST", "/api/account/security/passkeys/verify", accountSecurityPasskeysVerifyRoute.POST);
registerRoute("POST", "/api/account/security/reauth/options", accountSecurityReauthOptionsRoute.POST);
registerRoute("POST", "/api/account/security/reauth/password", accountSecurityReauthPasswordRoute.POST);
registerRoute("POST", "/api/account/security/reauth/verify", accountSecurityReauthVerifyRoute.POST);
registerRoute("GET", "/api/account/security", accountSecurityRoute.GET);
registerRoute("POST", "/api/account/security/totp/confirm", accountSecurityTotpConfirmRoute.POST);
registerRoute("POST", "/api/account/security/totp/disable", accountSecurityTotpDisableRoute.POST);
registerRoute("POST", "/api/account/security/totp/setup", accountSecurityTotpSetupRoute.POST);
registerRoute("POST", "/api/account/signup", accountSignupRoute.POST);
registerRoute("GET", "/api/admin/accounts/:accountId", adminAccountsAccountIdRoute.GET);
registerRoute("POST", "/api/admin/accounts/:accountId", adminAccountsAccountIdRoute.POST);
registerRoute("DELETE", "/api/admin/accounts/:accountId", adminAccountsAccountIdRoute.DELETE);
registerRoute("GET", "/api/admin/analytics", adminAnalyticsRoute.GET);
registerRoute("GET", "/api/admin/storage", adminStorageRoute.GET);
registerRoute("POST", "/api/admin/contacts/:contactId/resolve", adminContactsContactIdResolveRoute.POST);
registerRoute("DELETE", "/api/admin/contacts/:contactId", adminContactsContactIdRoute.DELETE);
registerRoute("GET", "/api/admin/contacts", adminContactsRoute.GET);
registerRoute("POST", "/api/admin/reports/:reportId/resolve", adminReportsReportIdResolveRoute.POST);
registerRoute("DELETE", "/api/admin/reports/:reportId", adminReportsReportIdRoute.DELETE);
registerRoute("GET", "/api/admin/reports", adminReportsRoute.GET);
registerRoute("GET", "/api/admin/shares/:shareId", adminSharesShareIdRoute.GET);
registerRoute("DELETE", "/api/admin/shares/:shareId", adminSharesShareIdRoute.DELETE);
registerRoute("POST", "/api/admin/shares/:shareId/suspend", adminSharesShareIdSuspendRoute.POST);
registerRoute("POST", "/api/admin/shares/:shareId/unsuspend", adminSharesShareIdUnsuspendRoute.POST);
registerRoute("POST", "/api/analytics/events", analyticsEventsRoute.POST);
registerRoute("POST", "/api/billing/btc/charge", billingBtcChargeRoute.POST);
registerRoute("POST", "/api/billing/btc/webhook", billingBtcWebhookRoute.POST);
registerRoute("POST", "/api/billing/stripe/cancellation", billingStripeCancellationRoute.POST);
registerRoute("POST", "/api/billing/stripe/subscription", billingStripeSubscriptionRoute.POST);
registerRoute("POST", "/api/billing/stripe/sync", billingStripeSyncRoute.POST);
registerRoute("POST", "/api/billing/stripe/webhook", async request => {
  // Hibiki constructs Response bodies at module initialization; workerd requires
  // that initialization to happen inside a request, rather than at startup.
  const route = await import("./routes/billing/stripe/webhook/route");
  return route.POST(request);
});
registerRoute("POST", "/api/contact", contactRoute.POST);
registerRoute("GET", "/api/download/:shareId", downloadShareIdRoute.GET);
registerRoute("GET", "/api/file/:fileId", fileFileIdRoute.GET);
registerRoute("POST", "/api/report", reportRoute.POST);
registerRoute("POST", "/api/revalidate/microcms", revalidateMicrocmsRoute.POST);
registerRoute("POST", "/api/upload/chunk", uploadChunkRoute.POST);
registerRoute("POST", "/api/upload/complete", uploadCompleteRoute.POST);
registerRoute("POST", "/api/upload/part-ack", uploadPartAckRoute.POST);
registerRoute("POST", "/api/upload/part-urls", uploadPartUrlsRoute.POST);
registerRoute("POST", "/api/upload/start", uploadStartRoute.POST);

// Keep the previous HTTP contract: OPTIONS advertises allowed methods; wrong
// methods return 405 without running authentication or consuming request bodies.
const methodsByPath = new Map<string, Set<string>>();
for (const route of app.routes) {
  if (route.method === "ALL") continue;
  const methods = methodsByPath.get(route.path) ?? new Set<string>();
  methods.add(route.method);
  if (route.method === "GET") methods.add("HEAD");
  methods.add("OPTIONS");
  methodsByPath.set(route.path, methods);
}
for (const [path, methods] of methodsByPath) {
  const allow = [...methods].sort().join(", ");
  app.all(path, c => new Response(null, { status: c.req.method === "OPTIONS" ? 204 : 405, headers: { Allow: allow } }));
}

// Never redirect unknown API paths to HTML or log authentication payloads.
app.notFound(c => c.json({ success: false, error: "APIが見つかりません" }, 404));
