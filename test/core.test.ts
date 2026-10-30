import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { reviewRepository } from "../src/core.js";

describe("core reviewRepository", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "core-test-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tempDir });
    writeFileSync(join(tempDir, "file.txt"), "v1\n");
    execFileSync("git", ["add", "."], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("rejects free-text commands under presets-only policy", async () => {
    await expect(
      reviewRepository({
        repositoryPath: tempDir,
        baseRef: "main",
        validationCommands: ["node -e 'console.log(1)'"],
        validationPolicy: "presets-only",
      }),
    ).rejects.toThrow(/presets-only/i);
  });

  it("defaults to presets-only policy when validationPolicy is omitted and rejects free-text commands", async () => {
    await expect(
      reviewRepository({
        repositoryPath: tempDir,
        baseRef: "main",
        validationCommands: ["echo malicious"],
      }),
    ).rejects.toThrow(/presets-only/i);
  });

  it("allows free-text commands under trusted-cli policy", async () => {
    const report = await reviewRepository({
      repositoryPath: tempDir,
      baseRef: "main",
      validationCommands: ["node -e \"console.log('from-trusted')\""],
      validationPolicy: "trusted-cli",
    });
    expect(report).toContain("from-trusted");
  });

  it("returns structured JSON report when format is json", async () => {
    const report = await reviewRepository({
      repositoryPath: tempDir,
      baseRef: "main",
      validationCommands: ["node -e \"console.log('json-test')\""],
      format: "json",
      validationPolicy: "trusted-cli",
    });

    const parsed = JSON.parse(report);
    expect(parsed).toHaveProperty("repo", tempDir);
    expect(parsed).toHaveProperty("base", "main");
    expect(Array.isArray(parsed.files)).toBe(true);
    expect(Array.isArray(parsed.validations)).toBe(true);
    expect(parsed.validations[0]).toMatchObject({
      command: expect.any(String),
      status: "passed",
      exitCode: 0,
      timedOut: false,
      truncated: false,
    });
  });
});
