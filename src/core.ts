import { changedFiles, detectDefaultBaseRef } from "./git.js";
import { jsonReport, markdownReport } from "./report.js";
import type { ReviewRequest } from "./types.js";
import { runValidations, VALIDATION_PRESETS } from "./validation.js";

export async function reviewRepository(request: ReviewRequest): Promise<string> {
  const policy = request.validationPolicy ?? "presets-only";
  const commands = request.validationCommands ?? [];

  if (policy === "presets-only") {
    for (const cmd of commands) {
      if (!Object.hasOwn(VALIDATION_PRESETS, cmd.trim())) {
        throw new Error(
          `Validation command "${cmd}" is not allowed under presets-only policy. Only predefined presets are allowed: ${Object.keys(VALIDATION_PRESETS).join(", ")}.`,
        );
      }
    }
  }

  const base = request.baseRef?.trim()
    ? request.baseRef.trim()
    : detectDefaultBaseRef(request.repositoryPath);

  const files = changedFiles(request.repositoryPath, base);
  const validations = await runValidations(commands, request.repositoryPath);

  if (request.format === "json") {
    return jsonReport({
      repositoryPath: request.repositoryPath,
      baseRef: base,
      changedFiles: files,
      validationResults: validations,
    });
  }

  return markdownReport({
    repositoryPath: request.repositoryPath,
    changedFiles: files,
    validationResults: validations,
  });
}