import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { changedFiles } from "../src/git.js";

describe("git changedFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "git-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function setupRepo(defaultBranch = "main") {
    execFileSync("git", ["init", "-b", defaultBranch], { cwd: tempDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tempDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });

    writeFileSync(join(tempDir, "file.txt"), "v1\n");
    execFileSync("git", ["add", "."], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir });
  }

  it("rejects baseRef starting with dash '-' to prevent flag injection", () => {
    setupRepo("main");
    expect(() => changedFiles(tempDir, "--output=pwned.txt")).toThrow(
      /cannot start with ["'-]/i,
    );
  });

  it("verifies baseRef with git rev-parse and rejects invalid ref", () => {
    setupRepo("main");
    expect(() => changedFiles(tempDir, "non-existent-branch")).toThrow(
      /invalid base/i,
    );
  });

  it("detects default base branch: main when origin/HEAD is absent", () => {
    setupRepo("main");
    // Make a change on a feature branch
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: tempDir });
    writeFileSync(join(tempDir, "file.txt"), "v2\n");
    writeFileSync(join(tempDir, "new-file.txt"), "new\n");
    execFileSync("git", ["add", "."], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "feature update"], { cwd: tempDir });

    const changes = changedFiles(tempDir);
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "file.txt", status: "modified" },
        { path: "new-file.txt", status: "added" },
      ]),
    );
  });

  it("detects default base branch: master when main does not exist", () => {
    setupRepo("master");
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: tempDir });
    writeFileSync(join(tempDir, "master-change.txt"), "hello\n");
    execFileSync("git", ["add", "."], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "master feature"], { cwd: tempDir });

    const changes = changedFiles(tempDir);
    expect(changes).toEqual([
      { path: "master-change.txt", status: "added" },
    ]);
  });

  it("detects origin/HEAD when present as top priority", () => {
    setupRepo("main");
    // Simulate origin/HEAD pointing to main commit
    const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["update-ref", "refs/remotes/origin/HEAD", headCommit], {
      cwd: tempDir,
    });

    execFileSync("git", ["checkout", "-b", "feature2"], { cwd: tempDir });
    writeFileSync(join(tempDir, "file.txt"), "v3\n");
    execFileSync("git", ["add", "."], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "feature 2 update"], { cwd: tempDir });

    const changes = changedFiles(tempDir);
    expect(changes).toEqual([
      { path: "file.txt", status: "modified" },
    ]);
  });

  it("works with explicit valid baseRef using --end-of-options", () => {
    setupRepo("main");
    execFileSync("git", ["checkout", "-b", "my-feature"], { cwd: tempDir });
    writeFileSync(join(tempDir, "added.txt"), "content\n");
    unlinkSync(join(tempDir, "file.txt"));
    execFileSync("git", ["add", "-A"], { cwd: tempDir });
    execFileSync("git", ["commit", "-m", "changes"], { cwd: tempDir });

    const changes = changedFiles(tempDir, "main");
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "added.txt", status: "added" },
        { path: "file.txt", status: "deleted" },
      ]),
    );
  });
});
