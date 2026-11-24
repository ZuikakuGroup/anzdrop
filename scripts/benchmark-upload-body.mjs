// Node stream/copy microbenchmark. Does not contact a Worker or R2.
import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
import { resourceUsage, memoryUsage } from 'node:process';
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { readBodyWithinLimit } = await server.ssrLoadModule('/lib/api/body.ts');
  const fragment = new Uint8Array(64 * 1024).fill(127);
  const partSize = 8 * 1024 * 1024;
  const read = size => {
    let offset = 0;
    const body = new ReadableStream({ pull(controller) {
      if (offset === size) return controller.close();
      const length = Math.min(fragment.length, size - offset);
      controller.enqueue(fragment.subarray(0, length)); offset += length;
    } });
    return readBodyWithinLimit(new Request('http://localhost/benchmark', { method: 'POST', body, duplex: 'half' }), partSize);
  };
  for (let warm = 0; warm < 10; warm++) await read(partSize);
  for (const sizeMiB of [1, 10, 100, 500, 1024]) {
    globalThis.gc?.();
    const cpu = resourceUsage(); const start = performance.now(); let checksum = 0; let peakExternalBytes = memoryUsage().external;
    for (let offset = 0; offset < sizeMiB * 1024 * 1024; offset += partSize) {
      const size = Math.min(partSize, sizeMiB * 1024 * 1024 - offset);
      const result = await read(size);
      if (result.length !== size) throw new Error('Invalid body length');
      checksum += result.at(-1);
      peakExternalBytes = Math.max(peakExternalBytes, memoryUsage().external);
    }
    const seconds = (performance.now() - start) / 1000; const end = resourceUsage();
    console.log(JSON.stringify({ sizeMiB, seconds, mibPerSecond: sizeMiB / seconds, cpuSeconds: (end.userCPUTime + end.systemCPUTime - cpu.userCPUTime - cpu.systemCPUTime) / 1e6, maxRssKiB: end.maxRSS, peakExternalBytes, externalBytesAtEnd: memoryUsage().external, checksum }));
  }
} finally { await server.close(); }
