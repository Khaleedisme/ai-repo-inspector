import { changedFiles, detectDefaultBaseRef } from "./git.js";
import { jsonReport, markdownReport } from "./report.js";
import type { ReviewRequest } from "./types.js";
import { runValidations, VALIDATION_PRESETS } from "./validation.js";

export type ReviewResult = {
  report: string;
  hasValidationFailures: boolean;
};

export async function reviewRepositoryDetails(request: ReviewRequest): Promise<ReviewResult> {
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
  const hasValidationFailures = validations.some((v) => v.status === "failed");

  let report: string;
  if (request.format === "json") {
    report = jsonReport({
      repositoryPath: request.repositoryPath,
      baseRef: base,
      changedFiles: files,
      validationResults: validations,
    });
  } else {
    report = markdownReport({
      repositoryPath: request.repositoryPath,
      changedFiles: files,
      validationResults: validations,
    });
  }

  return { report, hasValidationFailures };
}

export async function reviewRepository(request: ReviewRequest): Promise<string> {
  const { report } = await reviewRepositoryDetails(request);
  return report;
}