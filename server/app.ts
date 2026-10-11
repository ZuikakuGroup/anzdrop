import { Hono } from "hono";
import { verifyAccessJwt } from "@/lib/access";
import { ADMIN_ACCESS_PATH } from "@/lib/adminPageAccess";
import { withWorkerRuntime } from "./runtime";
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
// Service-binding-only authentication probe. The public router blocks /__internal.
app.get(ADMIN_ACCESS_PATH, async c => {
  const identity = await verifyAccessJwt(c.req.raw.headers, c.env);
  return new Response(null, { status: identity ? 204 : 404 });
});
app.on("POST", "/api/account/login/otp", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountLoginOtpRoute.POST(c.req.raw)));
app.on("POST", "/api/account/login", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountLoginRoute.POST(c.req.raw)));
app.on("POST", "/api/account/logout", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountLogoutRoute.POST(c.req.raw)));
app.on("GET", "/api/account/me", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountMeRoute.GET(c.req.raw)));
app.on("POST", "/api/account/passkey/options", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountPasskeyOptionsRoute.POST(c.req.raw)));
app.on("POST", "/api/account/passkey/verify", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountPasskeyVerifyRoute.POST(c.req.raw)));
app.on("POST", "/api/account/recover", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountRecoverRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/cancel", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityCancelRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/passkeys/delete", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityPasskeysDeleteRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/passkeys/options", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityPasskeysOptionsRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/passkeys/verify", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityPasskeysVerifyRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/reauth/options", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityReauthOptionsRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/reauth/password", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityReauthPasswordRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/reauth/verify", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityReauthVerifyRoute.POST(c.req.raw)));
app.on("GET", "/api/account/security", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityRoute.GET(c.req.raw)));
app.on("POST", "/api/account/security/totp/confirm", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityTotpConfirmRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/totp/disable", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityTotpDisableRoute.POST(c.req.raw)));
app.on("POST", "/api/account/security/totp/setup", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSecurityTotpSetupRoute.POST(c.req.raw)));
app.on("POST", "/api/account/signup", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => accountSignupRoute.POST(c.req.raw)));
app.on("GET", "/api/admin/accounts/:accountId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminAccountsAccountIdRoute.GET(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("POST", "/api/admin/accounts/:accountId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminAccountsAccountIdRoute.POST(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("DELETE", "/api/admin/accounts/:accountId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminAccountsAccountIdRoute.DELETE(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("GET", "/api/admin/analytics", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminAnalyticsRoute.GET(c.req.raw)));
app.on("POST", "/api/admin/contacts/:contactId/resolve", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminContactsContactIdResolveRoute.POST(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("DELETE", "/api/admin/contacts/:contactId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminContactsContactIdRoute.DELETE(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("GET", "/api/admin/contacts", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminContactsRoute.GET(c.req.raw)));
app.on("POST", "/api/admin/reports/:reportId/resolve", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminReportsReportIdResolveRoute.POST(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("DELETE", "/api/admin/reports/:reportId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminReportsReportIdRoute.DELETE(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("GET", "/api/admin/reports", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminReportsRoute.GET(c.req.raw)));
app.on("GET", "/api/admin/shares/:shareId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminSharesShareIdRoute.GET(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("DELETE", "/api/admin/shares/:shareId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminSharesShareIdRoute.DELETE(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("POST", "/api/admin/shares/:shareId/suspend", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminSharesShareIdSuspendRoute.POST(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("POST", "/api/admin/shares/:shareId/unsuspend", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => adminSharesShareIdUnsuspendRoute.POST(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("POST", "/api/analytics/events", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => analyticsEventsRoute.POST(c.req.raw)));
app.on("POST", "/api/billing/btc/charge", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => billingBtcChargeRoute.POST(c.req.raw)));
app.on("POST", "/api/billing/btc/webhook", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => billingBtcWebhookRoute.POST(c.req.raw)));
app.on("POST", "/api/billing/stripe/cancellation", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => billingStripeCancellationRoute.POST(c.req.raw)));
app.on("POST", "/api/billing/stripe/subscription", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => billingStripeSubscriptionRoute.POST(c.req.raw)));
app.on("POST", "/api/billing/stripe/sync", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => billingStripeSyncRoute.POST(c.req.raw)));
app.on("POST", "/api/billing/stripe/webhook", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, async () => {
  // Hibiki constructs Response bodies at module initialization; workerd requires
  // that initialization to happen inside a request, rather than at startup.
  const route = await import("./routes/billing/stripe/webhook/route");
  return route.POST(c.req.raw);
}));
app.on("POST", "/api/contact", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => contactRoute.POST(c.req.raw)));
app.on("GET", "/api/download/:shareId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => downloadShareIdRoute.GET(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("GET", "/api/file/:fileId", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => fileFileIdRoute.GET(c.req.raw, { params: Promise.resolve(c.req.param()) })));
app.on("POST", "/api/report", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => reportRoute.POST(c.req.raw)));
app.on("POST", "/api/revalidate/microcms", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => revalidateMicrocmsRoute.POST(c.req.raw)));
app.on("POST", "/api/upload/chunk", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => uploadChunkRoute.POST(c.req.raw)));
app.on("POST", "/api/upload/complete", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => uploadCompleteRoute.POST(c.req.raw)));
app.on("POST", "/api/upload/part-ack", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => uploadPartAckRoute.POST(c.req.raw)));
app.on("POST", "/api/upload/part-urls", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => uploadPartUrlsRoute.POST(c.req.raw)));
app.on("POST", "/api/upload/start", c => withWorkerRuntime({ env: c.env, ctx: c.executionCtx }, () => uploadStartRoute.POST(c.req.raw)));

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
