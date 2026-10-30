import { exec, execFile, type ExecException, type ExecFileException } from "node:child_process";
import type { ValidationResult as BaseValidationResult } from "./types.js";

export interface ValidationResult extends BaseValidationResult {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
}

export type ValidationOptions = {
  allowShell?: boolean;
  timeout?: number;
  maxBuffer?: number;
};

export const DEFAULT_TIMEOUT = 30_000;
export const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export const VALIDATION_PRESETS: Record<string, { file: string; args: string[] }> = {
  test: {
    file: "npm",
    args: ["test"],
  },
  typecheck: {
    file: "npm",
    args: ["run", "typecheck"],
  },
  build: {
    file: "npm",
    args: ["run", "build"],
  },
};

export function parseCommandString(cmd: string): { file: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === "\\") {
        const next = cmd[i + 1];
        if (next === '"' || next === "\\") {
          current += next;
          i++;
          continue;
        }
        current += char;
        continue;
      }
      if (char === '"') {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "\\") {
      const next = cmd[i + 1];
      if (next === '"' || next === "'" || next === "\\" || (next !== undefined && /\s/.test(next))) {
        current += next;
        i++;
        continue;
      }
      current += char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const [file = "", ...args] = tokens;
  return { file, args };
}

export function runValidation(
  command: string,
  cwd: string,
  options?: ValidationOptions,
): Promise<ValidationResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;

  return new Promise((resolve) => {
    const trimmed = command.trim();
    if (!trimmed) {
      resolve({
        command,
        status: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "Empty command",
        output: "Empty command",
      });
      return;
    }

    const handleResult = (
      error: ExecException | ExecFileException | null,
      stdout: string,
      stderr: string,
    ) => {
      const stdoutStr = stdout?.toString() ?? "";
      let stderrStr = stderr?.toString() ?? "";

      if (!error) {
        const output = [stdoutStr, stderrStr].filter(Boolean).join("\n").trim();
        resolve({
          command,
          status: "passed",
          exitCode: 0,
          stdout: stdoutStr,
          stderr: stderrStr,
          output,
        });
        return;
      }

      if (!stderrStr && !stdoutStr && error.message) {
        stderrStr = error.message;
      }

      const timedOut = Boolean(
        (error.killed && (error.signal === "SIGTERM" || error.code === "ETIMEDOUT")) ||
          error.code === "ETIMEDOUT" ||
          (error.message && error.message.includes("timed out")),
      );

      const truncated = Boolean(
        error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
          (error.message && error.message.includes("maxBuffer")),
      );

      let exitCode: number | null = null;
      if (typeof error.code === "number") {
        exitCode = error.code;
      } else if ("status" in error && typeof (error as { status?: unknown }).status === "number") {
        exitCode = (error as { status: number }).status;
      }

      const outputParts: string[] = [];
      if (stdoutStr) outputParts.push(stdoutStr);
      if (stderrStr) outputParts.push(stderrStr);

      if (timedOut) {
        outputParts.push("timed out");
      }
      if (truncated) {
        outputParts.push("truncated");
      }

      if (outputParts.length === 0 && error.message) {
        outputParts.push(error.message);
      }

      resolve({
        command,
        status: "failed",
        exitCode,
        stdout: stdoutStr,
        stderr: stderrStr,
        output: outputParts.join("\n").trim(),
        timedOut: timedOut ? true : undefined,
        truncated: truncated ? true : undefined,
      });
    };

    // Check if command is a preset
    if (Object.hasOwn(VALIDATION_PRESETS, trimmed)) {
      const preset = VALIDATION_PRESETS[trimmed];
      let targetFile = preset.file;
      let targetArgs = [...preset.args];

      if (process.platform === "win32" && targetFile === "npm") {
        targetFile = "cmd.exe";
        targetArgs = ["/d", "/s", "/c", "npm", ...preset.args];
      }

      execFile(
        targetFile,
        targetArgs,
        {
          cwd,
          timeout,
          maxBuffer,
          shell: false,
          encoding: "utf8",
        },
        handleResult,
      );
      return;
    }

    // CLI or user text
    if (options?.allowShell) {
      exec(command, { cwd, timeout, maxBuffer, encoding: "utf8" }, handleResult);
    } else {
      const { file, args } = parseCommandString(trimmed);
      execFile(
        file,
        args,
        {
          cwd,
          timeout,
          maxBuffer,
          shell: false,
          encoding: "utf8",
        },
        handleResult,
      );
    }
  });
}

export async function runValidations(
  commands: string[],
  cwd: string,
  options?: ValidationOptions,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const command of commands) {
    results.push(await runValidation(command, cwd, options));
  }
  return results;
}