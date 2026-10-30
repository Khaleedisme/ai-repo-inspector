import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "../src/cli.js";

const CLI_PATH = resolve("src/cli.ts");
const TSX_LOADER_URL = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;

function runCli(args: string[], cwd?: string) {
  const result = spawnSync(
    process.execPath,
    ["--import", TSX_LOADER_URL, CLI_PATH, ...args],
    {
      encoding: "utf8",
      cwd: cwd ?? process.cwd(),
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
    expect(resHelp.stdout).toMatch(/Exit codes:/i);
    expect(resHelp.stdout).toMatch(/0\s+.*all passed/i);
    expect(resHelp.stdout).toMatch(/1\s+.*tool.*error/i);
    expect(resHelp.stdout).toMatch(/2\s+.*validation failed/i);

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

  it("writes review-report.json when --format json is specified", () => {
    const { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const repoDir = mkdtempSync(join(tmpdir(), "cli-json-test-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "hello");
      execFileSync("git", ["add", "."], { cwd: repoDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

      const res = runCli(["review", "--repo", repoDir, "--base-ref", "main", "--format", "json"], repoDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Review report written to review-report.json");
      expect(existsSync(join(repoDir, "review-report.json"))).toBe(true);
    } finally {
      try {
        rmSync(repoDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("does not run main() or pollute stderr when imported as a module", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--import",
        TSX_LOADER_URL,
        "-e",
        'import("./src/cli.js").then(() => { process.exit(process.exitCode ?? 0); });',
      ],
      {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env },
      },
    );
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });

  it("exits with code 0 when review succeeds and all validations pass", () => {
    const { mkdtempSync, rmSync, writeFileSync, existsSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const repoDir = mkdtempSync(join(tmpdir(), "cli-exit-0-test-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "hello");
      execFileSync("git", ["add", "."], { cwd: repoDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

      const res = runCli(
        [
          "review",
          "--repo",
          repoDir,
          "--base-ref",
          "main",
          "--validate",
          "node -e process.exit(0)",
        ],
        repoDir,
      );
      expect(res.status).toBe(0);
      expect(existsSync(join(repoDir, "review-report.md"))).toBe(true);
    } finally {
      try {
        rmSync(repoDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("exits with code 2 when review is produced but at least one validation failed", () => {
    const { mkdtempSync, rmSync, writeFileSync, existsSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const repoDir = mkdtempSync(join(tmpdir(), "cli-exit-2-test-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "hello");
      execFileSync("git", ["add", "."], { cwd: repoDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

      const res = runCli(
        [
          "review",
          "--repo",
          repoDir,
          "--base-ref",
          "main",
          "--validate",
          "node -e process.exit(1)",
        ],
        repoDir,
      );
      expect(res.status).toBe(2);
      expect(existsSync(join(repoDir, "review-report.md"))).toBe(true);
    } finally {
      try {
        rmSync(repoDir, { recursive: true, force: true });
      } catch {}
    }
  });
});

