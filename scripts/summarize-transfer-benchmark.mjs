import { readFile } from 'node:fs/promises';
const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('Usage: node scripts/summarize-transfer-benchmark.mjs before.jsonl after.jsonl');
const read = async filename => (await readFile(filename, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const [before, after] = await Promise.all([read(beforePath), read(afterPath)]);
if ([...before, ...after].some(row => row.environment !== 'local-workerd-proxy')) throw new Error('Only local-workerd-proxy results can be compared');
const identities = new Set([...before, ...after].map(row => JSON.stringify([row.browser, row.platform, row.arch])));
if (identities.size > 1) throw new Error('Browser and host platform must match');
for (const rows of [before, after]) {
  const trials = rows.map(row => `${row.sizeMiB}:${row.trial}`);
  if (new Set(trials).size !== trials.length) throw new Error('Duplicate trials: use distinct result labels');
}
const routes = new Set([...before, ...after].flatMap(row => row.saveRoute ? [row.saveRoute] : []));
if (routes.size > 1) throw new Error('Save routes must match');
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const stats = rows => ({
  attempts: rows.length,
  failures: rows.filter(r => !r.success).length,
  uploadSeconds: average(rows.flatMap(r => r.upload ? [r.upload.seconds] : [])),
  downloadSeconds: average(rows.flatMap(r => r.download ? [r.download.seconds] : [])),
  uploadBackingMiB: rows.some(r => r.upload) ? Math.max(...rows.flatMap(r => r.upload ? [r.upload.peakBackingStorageBytes] : [])) / 1024 ** 2 : null,
  downloadBackingMiB: rows.some(r => r.download) ? Math.max(...rows.flatMap(r => r.download ? [r.download.peakBackingStorageBytes] : [])) / 1024 ** 2 : null,
});
for (const sizeMiB of [...new Set([...before, ...after].map(r => r.sizeMiB))].sort((a, b) => a - b)) {
  const b = stats(before.filter(r => r.sizeMiB === sizeMiB));
  const a = stats(after.filter(r => r.sizeMiB === sizeMiB));
  const change = key => b[key] !== null && a[key] !== null ? (a[key] / b[key] - 1) * 100 : null;
  console.log(JSON.stringify({ sizeMiB, before: b, after: a, changePercent: Object.fromEntries(['uploadSeconds', 'downloadSeconds', 'uploadBackingMiB', 'downloadBackingMiB'].map(key => [key, change(key)])) }));
}
