import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseCliArgs } from "../src/cli.js";

const CLI_PATH = resolve("src/cli.ts");

function runCli(args: string[]) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", CLI_PATH, ...args],
    {
      encoding: "utf8",
      env: { ...process.env },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("CLI argument parsing and error reporting", () => {
  it("shows help and exits 0 when --help or -h is passed", () => {
    const resHelp = runCli(["--help"]);
    expect(resHelp.status).toBe(0);
    expect(resHelp.stdout).toMatch(/Usage: inspector/i);
    expect(resHelp.stdout).toContain("--repo");
    expect(resHelp.stdout).toContain("--help");

    const resH = runCli(["-h"]);
    expect(resH.status).toBe(0);
    expect(resH.stdout).toMatch(/Usage: inspector/i);
  });

  it("does not truncate --repo argument containing spaces", () => {
    const parsed = parseCliArgs(["review", "--repo", "my repo with spaces/sub"]);
    expect(parsed.values.repo).toBe("my repo with spaces/sub");
  });

  it("successfully reviews repository when path contains spaces", () => {
    const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const spaceDir = mkdtempSync(join(tmpdir(), "space repo-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: spaceDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: spaceDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: spaceDir });
      writeFileSync(join(spaceDir, "file.txt"), "hello");
      execFileSync("git", ["add", "."], { cwd: spaceDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: spaceDir });

      const res = runCli(["review", "--repo", spaceDir, "--base-ref", "main"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Review report written to");
    } finally {
      try {
        rmSync(spaceDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("errors cleanly on unknown flags with exit code 1 and no stack trace", () => {
    const res = runCli(["review", "--repo", ".", "--unknown-flag"]);
    expect(res.status).toBe(1);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
    expect(res.stderr).toMatch(/unknown/i);
    expect(res.stderr).not.toContain("    at ");
  });

  it("errors cleanly on missing option value with exit code 1 and no stack trace", () => {
    const res = runCli(["review", "--repo"]);
    expect(res.status).toBe(1);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
    expect(res.stderr).toMatch(/missing/i);
    expect(res.stderr).not.toContain("    at ");
  });

  it("validates --format and rejects invalid formats with clean one-line error", () => {
    const res = runCli(["review", "--repo", ".", "--format", "yaml"]);
    expect(res.status).toBe(1);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
    expect(res.stderr).toMatch(/format.*(markdown|json)/i);
    expect(res.stderr).not.toContain("    at ");
  });

  it("prints clean one-line error without stack trace when tool encounters an error", () => {
    const res = runCli(["review", "--repo", ".", "--base-ref", "--invalid-base"]);
    expect(res.status).toBe(1);
    const lines = res.stderr.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(res.stderr).not.toContain("    at ");
  });
});
