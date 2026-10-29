// Local CPU/copy microbenchmark; no network, Workers or storage calls.
import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import { resourceUsage, memoryUsage } from 'node:process';
const server = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { unpackChunk } = await server.ssrLoadModule('/lib/crypto/packet.ts');
  const sizes = [1, 10, 100, 500, 1024];
  const packet = new Uint8Array(8 * 1024 * 1024 + 28);
  packet.fill(127);
  for (let warm = 0; warm < 10; warm++) unpackChunk(packet);
  for (const sizeMiB of sizes) {
    globalThis.gc?.();
    const cpu = resourceUsage();
    const start = performance.now();
    let checksum = 0; let peakExternalBytes = memoryUsage().external;
    const bytes = sizeMiB * 1024 * 1024;
    for (let offset = 0; offset < bytes; offset += 8 * 1024 * 1024) {
      const size = Math.min(8 * 1024 * 1024, bytes - offset);
      const result = unpackChunk(packet.subarray(0, size + 28));
      checksum += new Uint8Array(result.ciphertext).at(-1);
      peakExternalBytes = Math.max(peakExternalBytes, memoryUsage().external);
    }
    const seconds = (performance.now() - start) / 1000;
    const end = resourceUsage();
    console.log(JSON.stringify({ sizeMiB, seconds, mibPerSecond: sizeMiB / seconds, cpuSeconds: (end.userCPUTime + end.systemCPUTime - cpu.userCPUTime - cpu.systemCPUTime) / 1e6, maxRssKiB: end.maxRSS, peakExternalBytes, externalBytesAtEnd: memoryUsage().external, checksum }));
  }
} finally { await server.close(); }
