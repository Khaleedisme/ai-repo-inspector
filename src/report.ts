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

export function markdownReport(input: ReportInput): string {
  const lines = [`# Review Report: ${input.repositoryPath}`, "", "## Changed files"];
  for (const file of input.changedFiles) {
    lines.push(`- ${file.path} (${file.status})`);
  }
  lines.push("", "## Validation output");
  for (const result of input.validationResults) {
    lines.push(`### ${result.command}`, "```", result.output, "```");
  }
  return lines.join("\n");
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