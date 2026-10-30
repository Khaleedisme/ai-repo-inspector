import { describe, expect, it } from "vitest";
import { runValidation, runValidations, VALIDATION_PRESETS } from "../src/validation.js";

describe("validation runner", () => {
  it("defines fixed preset commands for test, typecheck, build", () => {
    expect(VALIDATION_PRESETS).toBeDefined();
    expect(VALIDATION_PRESETS.test).toBeDefined();
    expect(VALIDATION_PRESETS.typecheck).toBeDefined();
    expect(VALIDATION_PRESETS.build).toBeDefined();
  });

  it("never rejects on non-zero exit: returns status failed with exitCode, stdout and stderr", async () => {
    const cmd = `node -e "process.stdout.write('standard output\\n'); process.stderr.write('error output\\n'); process.exit(42);"`;
    
    // In original code, runValidation rejects the promise on non-zero exit
    const result = await runValidation(cmd, process.cwd());

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(42);
    expect(result.stdout).toContain("standard output");
    expect(result.stderr).toContain("error output");
    expect(result.output).toContain("standard output");
    expect(result.output).toContain("error output");
  });

  it("returns status passed with exitCode 0 on successful command", async () => {
    const cmd = `node -e "console.log('all good');"`;
    const result = await runValidation(cmd, process.cwd());

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("all good");
  });

  it("times out long-running commands and marks 'timed out'", async () => {
    const cmd = `node -e "setTimeout(() => {}, 5000);"`;
    const result = await runValidation(cmd, process.cwd(), { timeout: 150 });

    expect(result.status).toBe("failed");
    expect(result.timedOut).toBe(true);
    expect(result.output).toMatch(/timed out/i);
  });

  it("handles maxBuffer exceeded and marks 'truncated'", async () => {
    const cmd = `node -e "process.stdout.write('A'.repeat(5000));"`;
    const result = await runValidation(cmd, process.cwd(), { maxBuffer: 100 });

    expect(result.status).toBe("failed");
    expect(result.truncated).toBe(true);
    expect(result.output).toMatch(/truncated/i);
  });

  it("does not execute shell operators by default (no shell injection)", async () => {
    // In a shell, && would execute the second command creating a file.
    // Without a shell, '&&' and subsequent arguments are passed directly to node -e, which ignores them.
    const cmd = `node -e "console.log('first')" && node -e "console.log('second')"`;
    const result = await runValidation(cmd, process.cwd());

    // Without a shell, node only executes the first script and prints 'first'
    expect(result.output).toContain("first");
    expect(result.output).not.toContain("second");
  });
});
