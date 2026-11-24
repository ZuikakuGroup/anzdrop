import { pathToFileURL } from 'node:url';

// No response bodies, URLs, credentials or customer identifiers reach output/webhooks.
export async function monitor(env, { fetcher = fetch, notify = false, now = new Date() } = {}) {
  const target = new URL(env.MONITOR_BASE_URL);
  if (target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
      (target.protocol !== 'https:' && !(target.protocol === 'http:' && target.hostname === 'localhost'))) {
    throw new Error('Invalid monitor origin');
  }
  let webhook;
  if (notify) {
    webhook = new URL(env.MONITOR_WEBHOOK_URL);
    if (webhook.protocol !== 'https:' || webhook.username || webhook.password) throw new Error('Webhook requires HTTPS without credentials');
  }
  const headers = env.MONITOR_ACCESS_JWT ? { Cookie: `CF_Authorization=${env.MONITOR_ACCESS_JWT}` } : {};
  const alerts = [];
  async function read(path) {
    try {
      const response = await fetcher(new URL(path, target), { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      return await response.json();
    } catch { return null; }
  }
  const started = performance.now();
  const health = await read('/api/admin/health');
  if (health?.success !== true || health?.checks?.d1 !== 'ok' || health?.checks?.r2 !== 'ok') alerts.push('readiness_failed');
  if (performance.now() - started >= 5_000) alerts.push('readiness_slow');
  try {
    // PUBLIC is a separate Worker. Never send the admin cookie to this probe.
    const page = await fetcher(new URL('/', target), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!page.ok || !page.headers.get('Content-Type')?.includes('text/html') || !page.body) throw new Error('Invalid public response');
    const reader = page.body.getReader();
    let html = '';
    const decoder = new TextDecoder();
    try {
      let bytes = 0;
      while (bytes < 65_536 && !/<title>[^<]*Anzdrop/i.test(html)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        html += decoder.decode(chunk.value.subarray(0, 65_536 - bytes), { stream: true });
        bytes += chunk.value.byteLength;
      }
    } finally { await reader.cancel(); }
    if (!/<title>[^<]*Anzdrop/i.test(html)) throw new Error('Missing public marker');
  } catch { alerts.push('public_unavailable'); }
  const date = now.toISOString().slice(0, 10);
  const report = await read(`/api/admin/analytics?view=reliability&from=${date}&to=${date}`);
  if (report?.success !== true || !report.data) alerts.push('analytics_unavailable');
  else {
    for (const kind of ['upload', 'download']) {
      const rate = report.data[`${kind}SuccessRate`];
      const errors = report.data[`${kind}ErrorsByCode`];
      if (!Array.isArray(errors) || !(rate === null || (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0))) {
        alerts.push('analytics_invalid');
        continue;
      }
      const count = errors.reduce((sum, row) => sum + (Number.isSafeInteger(row.count) && row.count > 0 ? row.count : 0), 0);
      if (rate !== null && rate < 0.9 && count >= 10) alerts.push(`${kind}_failure_rate`);
    }
  }
  if (notify && alerts.length) {
    const response = await fetcher(webhook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Anzdrop: ${alerts.join(', ')}` }) });
    if (!response.ok) throw new Error('Notification failed');
  }
  return { success: alerts.length === 0, alerts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await monitor(process.env, { notify: process.argv.includes('--notify') });
    console.log(JSON.stringify(result));
    process.exitCode = result.success ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ success: false, alerts: ['monitor_failed'] }));
    process.exitCode = 2;
  }
}
