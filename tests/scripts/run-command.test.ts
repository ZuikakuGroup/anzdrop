import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const helper = new URL("../../scripts/run-command.mjs", import.meta.url).href;
function run(code: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `import { runCommand } from ${JSON.stringify(helper)}; ${code}`], { encoding: "utf8", timeout: 10_000 });
}

describe("local command lifecycle", () => {
  it("preserves a child process exit code", () => {
    const result = run('runCommand(process.execPath, ["-e", "process.exit(7)"]);');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(7);
  });
  it("reports spawn failures", () => {
    const result = run('runCommand("/nonexistent/anzdrop-command", []);');
    expect(result.status).toBe(1);
  });
  it("forwards SIGTERM to a ready child", () => {
    const result = run(`const child = runCommand(process.execPath, ["-e", "process.on('SIGTERM', () => process.exit(23)); process.send('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); child.once('message', () => process.kill(process.pid, 'SIGTERM'));`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(23);
  });
  it.each([false, true])("restores default termination after repeated child closes (spawn failure: %s)", (spawnFailure) => {
    const command = spawnFailure
      ? 'runCommand("/nonexistent/anzdrop-command", [])'
      : 'runCommand(process.execPath, ["-e", "process.exit(0)"])';
    const result = run(`
      for (let index = 0; index < 3; index++) {
        await new Promise(resolve => ${command}.once('close', resolve));
      }
      setTimeout(() => process.exit(31), 1000);
      process.kill(process.pid, 'SIGTERM');
    `);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBe("SIGTERM");
    expect(result.status).toBeNull();
  });
  it("preserves a caller's signal handler when a child closes", () => {
    const result = run(`
      const caller = () => process.stdout.write('caller-signal\\n');
      process.on('SIGTERM', caller);
      await new Promise(resolve => runCommand(process.execPath, ['-e', 'process.exit(0)']).once('close', resolve));
      process.emit('SIGTERM');
      process.off('SIGTERM', caller);
    `);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("caller-signal\n");
  });
});
