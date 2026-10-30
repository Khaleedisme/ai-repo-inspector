import { execFileSync } from "node:child_process";
import type { ChangedFile } from "./types.js";

export const DEFAULT_GIT_TIMEOUT = 30_000;
export const DEFAULT_GIT_MAX_BUFFER = 10 * 1024 * 1024;

export type GitOptions = {
  timeout?: number;
  maxBuffer?: number;
};

export function git(
  repositoryPath: string,
  args: string[],
  options?: GitOptions,
): string {
  return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repositoryPath,
    encoding: "utf8",
    timeout: options?.timeout ?? DEFAULT_GIT_TIMEOUT,
    maxBuffer: options?.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER,
  });
}

function isValidCommit(
  repositoryPath: string,
  ref: string,
  options?: GitOptions,
): boolean {
  try {
    execFileSync(
      "git",
      ["-c", "core.quotepath=false", "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      {
        cwd: repositoryPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: options?.timeout ?? DEFAULT_GIT_TIMEOUT,
        maxBuffer: options?.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER,
      },
    );
    return true;
  } catch (error: unknown) {
    if (error && typeof error === "object") {
      const err = error as { code?: unknown; killed?: boolean };
      if (
        err.code === "ENOBUFS" ||
        err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
        err.code === "ETIMEDOUT" ||
        err.killed
      ) {
        throw error;
      }
    }
    return false;
  }
}

export function detectDefaultBaseRef(
  repositoryPath: string,
  options?: GitOptions,
): string {
  const candidates = ["origin/HEAD", "main", "master"];
  for (const candidate of candidates) {
    if (isValidCommit(repositoryPath, candidate, options)) {
      return candidate;
    }
  }
  throw new Error("Could not detect default base revision (tried origin/HEAD, main, master).");
}

export function parseDiffOutput(output: string): ChangedFile[] {
  const tokens = output.split("\0");
  const files: ChangedFile[] = [];
  let i = 0;

  while (i < tokens.length) {
    const statusToken = tokens[i];
    if (!statusToken) {
      i++;
      continue;
    }

    const statusCode = statusToken[0];

    if (statusCode === "R" || statusCode === "C") {
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath !== undefined && newPath !== undefined) {
        if (statusCode === "R") {
          files.push({
            path: newPath,
            status: "renamed",
            oldPath,
          });
        } else {
          files.push({
            path: newPath,
            status: "added",
            oldPath,
          });
        }
        i += 3;
        continue;
      }
    }

    const path = tokens[i + 1];
    if (path !== undefined) {
      let status: ChangedFile["status"] = "modified";
      if (statusCode === "A") {
        status = "added";
      } else if (statusCode === "D") {
        status = "deleted";
      } else if (statusCode === "?") {
        status = "untracked";
      }
      files.push({ path, status });
      i += 2;
      continue;
    }

    i++;
  }

  return files;
}

export function changedFiles(
  repositoryPath: string,
  baseRef?: string,
  options?: GitOptions,
): ChangedFile[] {
  let base: string;

  const trimmed = baseRef?.trim();

  if (trimmed !== undefined && trimmed !== "") {
    if (trimmed.startsWith("-")) {
      throw new Error(`Invalid baseRef: "${trimmed}". References cannot start with "-".`);
    }
    if (!isValidCommit(repositoryPath, trimmed, options)) {
      throw new Error(`Invalid baseRef: "${trimmed}". Revision does not exist or is not a commit.`);
    }
    base = trimmed;
  } else {
    base = detectDefaultBaseRef(repositoryPath, options);
  }

  const output = git(
    repositoryPath,
    [
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      "--end-of-options",
      `${base}...HEAD`,
    ],
    options,
  );

  return parseDiffOutput(output);
}