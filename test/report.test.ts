import { describe, expect, it } from "vitest";
import { markdownReport, jsonReport } from "../src/report.js";

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
});