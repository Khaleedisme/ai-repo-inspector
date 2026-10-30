#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { reviewRepository } from "./core.js";

export const reviewRepositorySchema = z.object({
  repo_path: z.string().describe("Repository path to inspect."),
  baseRef: z.string().optional().describe("Base git reference to compare against."),
  validationCommands: z
    .array(z.enum(["test", "typecheck", "build"]))
    .optional()
    .describe("Validation presets to run (test, typecheck, build)."),
});

export type ReviewRepositoryInput = z.infer<typeof reviewRepositorySchema>;

function isGitRepo(dir: string): boolean {
  if (existsSync(join(dir, ".git"))) {
    return true;
  }
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return gitDir === ".git" || resolve(dir, gitDir) === resolve(dir, ".git");
  } catch {
    return false;
  }
}

function getAllowedRoots(): string[] {
  const env = process.env.REPO_INSPECTOR_ROOTS;
  if (!env || !env.trim()) {
    return [resolve(process.cwd())];
  }
  const rawRoots = env.includes(delimiter)
    ? env.split(delimiter)
    : env.split(/[;,]/);
  return rawRoots.map((r) => resolve(r.trim())).filter(Boolean);
}

function isInsideAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  const resolvedTarget = resolve(targetPath);
  let realTarget = resolvedTarget;
  try {
    realTarget = realpathSync.native(resolvedTarget);
  } catch {}

  return allowedRoots.some((root) => {
    const resolvedRoot = resolve(root);
    let realRoot = resolvedRoot;
    try {
      realRoot = realpathSync.native(resolvedRoot);
    } catch {}

    const rel = relative(realRoot, realTarget);
    if (rel === "") return true;
    if (!rel.startsWith("..") && !isAbsolute(rel)) return true;

    if (process.platform === "win32") {
      const relLower = relative(realRoot.toLowerCase(), realTarget.toLowerCase());
      if (relLower === "") return true;
      if (!relLower.startsWith("..") && !isAbsolute(relLower)) return true;
    }

    return false;
  });
}

export function validateRepositoryPath(repoPath: string): { valid: true; path: string } | { valid: false; error: string } {
  const resolved = resolve(repoPath);

  if (!existsSync(resolved)) {
    return { valid: false, error: `Repository path does not exist: ${resolved}` };
  }

  const allowedRoots = getAllowedRoots();
  if (!isInsideAllowedRoots(resolved, allowedRoots)) {
    return {
      valid: false,
      error: `Repository path is not within allowed roots (${allowedRoots.join(", ")}): ${resolved}`,
    };
  }

  if (!isGitRepo(resolved)) {
    return { valid: false, error: `Path is not a valid Git repository: ${resolved}` };
  }

  return { valid: true, path: resolved };
}

export async function handleReviewRepository(input: ReviewRepositoryInput) {
  try {
    const pathValidation = validateRepositoryPath(input.repo_path);
    if (!pathValidation.valid) {
      return {
        content: [{ type: "text" as const, text: pathValidation.error }],
        isError: true,
      };
    }

    const report = await reviewRepository({
      repositoryPath: pathValidation.path,
      baseRef: input.baseRef,
      validationCommands: input.validationCommands,
    });

    return { content: [{ type: "text" as const, text: report }] };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: error?.message || String(error) }],
      isError: true,
    };
  }
}

export const server = new McpServer({ name: "repository-inspector", version: "2.0.0" });

server.tool(
  "review_repository",
  "Inspects a Git repository and returns a review report.",
  reviewRepositorySchema.shape,
  async (input) => {
    return handleReviewRepository(input);
  },
);

const isDirectRun =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === resolve(process.argv[1]) ||
    process.argv[1].endsWith("mcp-server.ts") ||
    process.argv[1].endsWith("mcp-server.js"));

if (isDirectRun) {
  await server.connect(new StdioServerTransport());
}