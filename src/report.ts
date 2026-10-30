import type { ChangedFile, ValidationResult } from "./types.js";

export type ReportInput = {
  repositoryPath: string;
  changedFiles: ChangedFile[];
  validationResults: ValidationResult[];
};

export type JsonReportInput = {
  repositoryPath: string;
  baseRef: string;
  changedFiles: ChangedFile[];
  validationResults: ValidationResult[];
};

function chooseFence(output: string): string {
  const matches = output.match(/`+/g);
  let maxBackticks = 0;
  if (matches) {
    for (const match of matches) {
      if (match.length > maxBackticks) {
        maxBackticks = match.length;
      }
    }
  }
  return "`".repeat(Math.max(3, maxBackticks + 1));
}

export function markdownReport(input: ReportInput): string {
  const lines = [`# Review Report: ${input.repositoryPath}`, "", "## Changed files"];
  if (input.changedFiles.length === 0) {
    lines.push("No changes");
  } else {
    for (const file of input.changedFiles) {
      if (file.status === "renamed" && file.oldPath) {
        lines.push(`- ${file.oldPath} -> ${file.path} (renamed)`);
      } else {
        lines.push(`- ${file.path} (${file.status})`);
      }
    }
  }

  lines.push("", "## Validation output");
  if (input.validationResults.length === 0) {
    lines.push("No validations run");
  } else {
    for (const result of input.validationResults) {
      const status = result.status === "passed" ? "PASSED" : "FAILED";
      const exitCode =
        result.exitCode !== undefined ? result.exitCode : (result.status === "passed" ? 0 : null);
      const flags: string[] = [];
      if (result.timedOut) flags.push("timedOut");
      if (result.truncated) flags.push("truncated");
      const flagStr = flags.length > 0 ? `, ${flags.join(", ")}` : "";
      const fence = chooseFence(result.output);
      lines.push(
        `### ${result.command} - ${status} (exitCode: ${exitCode}${flagStr})`,
        fence,
        result.output,
        fence,
      );
    }
  }

  return lines.join("\n") + "\n";
}

export function jsonReport(input: JsonReportInput): string {
  const data = {
    repo: input.repositoryPath,
    base: input.baseRef,
    files: input.changedFiles,
    validations: input.validationResults.map((v) => ({
      command: v.command,
      status: v.status,
      exitCode: v.exitCode !== undefined ? v.exitCode : (v.status === "passed" ? 0 : null),
      timedOut: Boolean(v.timedOut),
      truncated: Boolean(v.truncated),
      output: v.output,
    })),
  };
  return JSON.stringify(data, null, 2);
}