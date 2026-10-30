import { execFileSync } from "node:child_process";
import type { ChangedFile } from "./types.js";

function git(repositoryPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function isValidCommit(repositoryPath: string, ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], {
      cwd: repositoryPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

export function detectDefaultBaseRef(repositoryPath: string): string {
  const candidates = ["origin/HEAD", "main", "master"];
  for (const candidate of candidates) {
    if (isValidCommit(repositoryPath, candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not detect default base revision (tried origin/HEAD, main, master).");
}

export function changedFiles(repositoryPath: string, baseRef?: string): ChangedFile[] {
  let base: string;

  if (baseRef !== undefined && baseRef !== "") {
    if (baseRef.startsWith("-")) {
      throw new Error(`Invalid baseRef: "${baseRef}". References cannot start with "-".`);
    }
    if (!isValidCommit(repositoryPath, baseRef)) {
      throw new Error(`Invalid baseRef: "${baseRef}". Revision does not exist or is not a commit.`);
    }
    base = baseRef;
  } else {
    base = detectDefaultBaseRef(repositoryPath);
  }

  const output = git(repositoryPath, [
    "diff",
    "--name-status",
    "--end-of-options",
    `${base}...HEAD`,
  ]);

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [code, ...pathParts] = line.split("\t");
      const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
      return { path: pathParts.join("\t"), status };
    });
}