import { describe, expect, it } from "vitest";
import { markdownReport, jsonReport, MAX_OUTPUT_SIZE } from "../src/report.js";

describe("markdownReport", () => {
  it("lists changed files and validation output", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      validationResults: [{ command: "npm test", status: "passed", output: "ok" }],
    });

    expect(report).toContain("src/index.ts (modified)");
    expect(report).toContain("npm test");
    expect(report).toContain("ok");
  });

  it("shows empty sections as 'No changes' and 'No validations run' and ends with newline", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [],
    });

    expect(report).toContain("No changes");
    expect(report).toContain("No validations run");
    expect(report.endsWith("\n")).toBe(true);
  });

  it("shows 'old -> new (renamed)' for renames", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [
        { path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" },
      ],
      validationResults: [],
    });

    expect(report).toContain("src/old.ts -> src/new.ts (renamed)");
  });

  it("shows status, exitCode, and flags timedOut/truncated in validation heading line", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          output: "all tests passed",
        },
        {
          command: "npm run build",
          status: "failed",
          exitCode: 1,
          timedOut: true,
          truncated: true,
          output: "build failed",
        },
      ],
    });

    expect(report).toMatch(/^### npm test - PASSED \(exitCode: 0\)$/m);
    expect(report).toMatch(/^### npm run build - FAILED \(exitCode: 1, timedOut, truncated\)$/m);
  });

  it("uses fence longer than longest backtick run in output containing ``` and # heading", () => {
    const outputWithTicksAndHeading = "```\n# heading\nsome content\n```";
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          output: outputWithTicksAndHeading,
        },
      ],
    });

    expect(report).toContain("````\n```\n# heading\nsome content\n```\n````");
  });
});

describe("jsonReport", () => {
  it("generates structured JSON report with repo, base, files, and validations", () => {
    const jsonStr = jsonReport({
      repositoryPath: "/work/sample",
      baseRef: "main",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      validationResults: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          output: "ok",
          timedOut: false,
          truncated: false,
        },
      ],
    });

    const parsed = JSON.parse(jsonStr);
    expect(parsed).toEqual({
      repo: "/work/sample",
      base: "main",
      files: [{ path: "src/index.ts", status: "modified" }],
      validations: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          timedOut: false,
          truncated: false,
          output: "ok",
        },
      ],
    });
  });

  it("handles renamed files and failed timed-out truncated validations in JSON report", () => {
    const jsonStr = jsonReport({
      repositoryPath: "/work/sample",
      baseRef: "origin/HEAD",
      changedFiles: [{ path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" }],
      validationResults: [
        {
          command: "npm run build",
          status: "failed",
          exitCode: null,
          timedOut: true,
          truncated: true,
          output: "build timed out and truncated",
        },
      ],
    });

    const parsed = JSON.parse(jsonStr);
    expect(parsed.files).toEqual([
      { path: "src/new.ts", status: "renamed", oldPath: "src/old.ts" },
    ]);
    expect(parsed.validations).toEqual([
      {
        command: "npm run build",
        status: "failed",
        exitCode: null,
        timedOut: true,
        truncated: true,
        output: "build timed out and truncated",
      },
    ]);
  });
});

describe("output size cap", () => {
  it("exports MAX_OUTPUT_SIZE constant equal to 16 KB", () => {
    expect(MAX_OUTPUT_SIZE).toBe(16 * 1024);
  });

  it("truncates validation output to 16 KB in markdownReport and adds truncated flag", () => {
    const headPart = "START_HEAD_DATA_".padEnd(8192, "A");
    const middlePart = "MIDDLE_".padEnd(4096, "M");
    const tailPart = "END_TAIL_DATA_".padStart(8192, "Z");
    const fullOutput = headPart + middlePart + tailPart; // 8192 + 4096 + 8192 = 20480 bytes

    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          output: fullOutput,
        },
      ],
    });

    expect(report).toContain("[... 4096 bytes omitted ...]");
    expect(report).toContain("START_HEAD_DATA_");
    expect(report).toContain("END_TAIL_DATA_");
    expect(report).not.toContain("MIDDLE_");
    expect(report).toContain("### npm test - PASSED (exitCode: 0, truncated)");
  });

  it("truncates validation output to 16 KB in jsonReport and adds outputTruncated: true", () => {
    const headPart = "START_HEAD_DATA_".padEnd(8192, "A");
    const middlePart = "MIDDLE_".padEnd(4096, "M");
    const tailPart = "END_TAIL_DATA_".padStart(8192, "Z");
    const fullOutput = headPart + middlePart + tailPart; // 20480 bytes

    const jsonStr = jsonReport({
      repositoryPath: "/work/sample",
      baseRef: "main",
      changedFiles: [],
      validationResults: [
        {
          command: "npm test",
          status: "passed",
          exitCode: 0,
          output: fullOutput,
        },
      ],
    });

    const parsed = JSON.parse(jsonStr);
    expect(parsed.validations[0].outputTruncated).toBe(true);
    expect(parsed.validations[0].truncated).toBe(true);
    expect(parsed.validations[0].output).toContain("[... 4096 bytes omitted ...]");
    expect(parsed.validations[0].output).toContain("START_HEAD_DATA_");
    expect(parsed.validations[0].output).toContain("END_TAIL_DATA_");
    expect(parsed.validations[0].output).not.toContain("MIDDLE_");
  });
});