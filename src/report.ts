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

export const MAX_OUTPUT_SIZE = 16 * 1024; // 16 KB

export function truncateOutput(
  output: string,
  limit: number = MAX_OUTPUT_SIZE,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(output, "utf8");
  if (buf.length <= limit) {
    return { text: output, truncated: false };
  }

  const half = Math.floor(limit / 2);
  let headBuf = buf.subarray(0, half);
  let tailBuf = buf.subarray(buf.length - half);

  let headEnd = headBuf.length;
  while (headEnd > 0 && (headBuf[headEnd - 1] & 0xc0) === 0x80) {
    headEnd--;
  }
  if (headEnd > 0) {
    const lead = headBuf[headEnd - 1];
    let expectedLen = 1;
    if ((lead & 0xe0) === 0xc0) expectedLen = 2;
    else if ((lead & 0xf0) === 0xe0) expectedLen = 3;
    else if ((lead & 0xf8) === 0xf0) expectedLen = 4;
    const actualLen = headBuf.length - (headEnd - 1);
    if (actualLen < expectedLen) {
      headEnd = headEnd - 1;
    }
  }
  headBuf = headBuf.subarray(0, headEnd);

  let tailStart = 0;
  while (tailStart < tailBuf.length && (tailBuf[tailStart] & 0xc0) === 0x80) {
    tailStart++;
  }
  tailBuf = tailBuf.subarray(tailStart);

  const omittedBytes = buf.length - headBuf.length - tailBuf.length;
  const headStr = headBuf.toString("utf8");
  const tailStr = tailBuf.toString("utf8");
  const text = `${headStr}\n[... ${omittedBytes} bytes omitted ...]\n${tailStr}`;

  return { text, truncated: true };
}

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
      const { text: processedOutput, truncated: outputTruncated } = truncateOutput(result.output);
      const isTruncated = Boolean(result.truncated || outputTruncated);
      const status = result.status === "passed" ? "PASSED" : "FAILED";
      const exitCode =
        result.exitCode !== undefined ? result.exitCode : (result.status === "passed" ? 0 : null);
      const flags: string[] = [];
      if (result.timedOut) flags.push("timedOut");
      if (isTruncated) flags.push("truncated");
      const flagStr = flags.length > 0 ? `, ${flags.join(", ")}` : "";
      const fence = chooseFence(processedOutput);
      lines.push(
        `### ${result.command} - ${status} (exitCode: ${exitCode}${flagStr})`,
        fence,
        processedOutput,
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
    validations: input.validationResults.map((v) => {
      const { text: processedOutput, truncated: outputTruncated } = truncateOutput(v.output);
      const isTruncated = Boolean(v.truncated || outputTruncated);
      const entry: Record<string, unknown> = {
        command: v.command,
        status: v.status,
        exitCode: v.exitCode !== undefined ? v.exitCode : (v.status === "passed" ? 0 : null),
        timedOut: Boolean(v.timedOut),
        truncated: isTruncated,
        output: processedOutput,
      };
      if (outputTruncated || v.outputTruncated) {
        entry.outputTruncated = true;
      }
      return entry;
    }),
  };
  return JSON.stringify(data, null, 2);
}