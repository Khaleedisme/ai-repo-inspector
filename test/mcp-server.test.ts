import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  handleReviewRepository,
  reviewRepositorySchema,
} from "../src/mcp-server.js";

describe("MCP Server review_repository", () => {
  let tempDir: string;
  const originalRoots = process.env.REPO_INSPECTOR_ROOTS;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  });

  afterEach(() => {
    process.env.REPO_INSPECTOR_ROOTS = originalRoots;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("shared schema defines repo_path and validates preset names", () => {
    const valid = reviewRepositorySchema.safeParse({
      repo_path: tempDir,
      validationCommands: ["test", "typecheck"],
    });
    expect(valid.success).toBe(true);

    const invalidCommand = reviewRepositorySchema.safeParse({
      repo_path: tempDir,
      validationCommands: ["rm -rf /"],
    });
    expect(invalidCommand.success).toBe(false);
  });

  it("returns MCP error when repo path does not exist", async () => {
    process.env.REPO_INSPECTOR_ROOTS = tempDir;
    const nonExistent = join(tempDir, "does-not-exist");

    const result = await handleReviewRepository({
      repo_path: nonExistent,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not exist/i);
  });

  it("returns MCP error when path is outside allowed roots", async () => {
    const allowedRoot = join(tempDir, "allowed");
    const outsideRepo = join(tempDir, "outside");
    mkdirSync(allowedRoot);
    mkdirSync(outsideRepo);
    execFileSync("git", ["init"], { cwd: outsideRepo });

    process.env.REPO_INSPECTOR_ROOTS = allowedRoot;

    const result = await handleReviewRepository({
      repo_path: outsideRepo,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/allowed root/i);
  });

  it("returns MCP error when path is not a git repository", async () => {
    process.env.REPO_INSPECTOR_ROOTS = tempDir;
    const notGit = join(tempDir, "not-git");
    mkdirSync(notGit);

    const result = await handleReviewRepository({
      repo_path: notGit,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/git/i);
  });

  it("returns MCP error when path contains a dummy .git directory that is not a real git repository", async () => {
    process.env.REPO_INSPECTOR_ROOTS = tempDir;
    const fakeGitDir = join(tempDir, "fake-git");
    mkdirSync(fakeGitDir);
    mkdirSync(join(fakeGitDir, ".git"));

    const result = await handleReviewRepository({
      repo_path: fakeGitDir,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/git/i);
  });

  it("returns MCP error when handleReviewRepository is passed invalid input schema", async () => {
    process.env.REPO_INSPECTOR_ROOTS = tempDir;
    // Pass invalid validationCommand preset
    const result = await handleReviewRepository({
      repo_path: tempDir,
      validationCommands: ["malicious; command"] as any,
    });

    expect(result.isError).toBe(true);
  });

  it("handles valid git repo using repo_path without undefined in title", async () => {
    const repo = join(tempDir, "valid-repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });

    writeFileSync(join(repo, "README.md"), "hello");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repo });

    // create change
    writeFileSync(join(repo, "README.md"), "hello world");

    process.env.REPO_INSPECTOR_ROOTS = tempDir;

    const result = await handleReviewRepository({
      repo_path: repo,
      baseRef: "main",
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).not.toContain("undefined");
    expect(result.content[0].text).toContain(repo);
  });
});

