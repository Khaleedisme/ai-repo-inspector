#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { reviewRepositoryDetails } from "./core.js";

const HELP_TEXT = `Usage: inspector review --repo <path> [--base-ref <ref>] [--format <markdown|json>] [--validate <command>...]

Options:
  --repo <path>           Path to the repository to inspect (required)
  --base-ref <ref>        Git base reference to compare against
  --format <format>       Report format: markdown (default) or json
  --validate <command>    Validation command or preset to run (can be repeated)
  -h, --help              Show this help message

Exit codes:
  0  All passed
  1  Tool/usage error
  2  Review produced but at least one validation failed
`;

export function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options: {
      repo: { type: "string" },
      "base-ref": { type: "string" },
      format: { type: "string" },
      validate: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });
}

async function main() {
  try {
    const { values, positionals } = parseCliArgs(process.argv.slice(2));

    if (values.help) {
      process.stdout.write(HELP_TEXT);
      return;
    }

    if (positionals[0] !== "review") {
      console.error("Usage: inspector review --repo <path> [--base-ref <ref>] [--format <markdown|json>] [--validate <command>]");
      process.exitCode = 1;
      return;
    }

    if (!values.repo) {
      console.error("Error: Missing required option '--repo'");
      process.exitCode = 1;
      return;
    }

    if (values.format !== undefined && values.format !== "markdown" && values.format !== "json") {
      console.error(`Invalid format: "${values.format}". Must be "markdown" or "json".`);
      process.exitCode = 1;
      return;
    }

    const format = values.format as "markdown" | "json" | undefined;
    const { report, hasValidationFailures } = await reviewRepositoryDetails({
      repositoryPath: values.repo,
      baseRef: values["base-ref"],
      validationCommands: values.validate ?? [],
      format,
      validationPolicy: "trusted-cli",
    });

    const outputFile = format === "json" ? "review-report.json" : "review-report.md";
    writeFileSync(outputFile, report, "utf8");
    console.log(`Review report written to ${outputFile}`);

    if (hasValidationFailures) {
      process.exitCode = 2;
    } else {
      process.exitCode = 0;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.split("\n")[0]);
    process.exitCode = 1;
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const current = fileURLToPath(import.meta.url).toLowerCase();
    const invoked = resolve(process.argv[1]).toLowerCase();
    if (current === invoked) return true;
  } catch {}

  const normalized = process.argv[1].replace(/\\/g, "/").toLowerCase();
  return (
    normalized.endsWith("/cli.ts") ||
    normalized.endsWith("/cli.js") ||
    normalized.endsWith("/bin/inspector") ||
    normalized.endsWith("/inspector") ||
    normalized === "inspector"
  );
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.split("\n")[0]);
    process.exitCode = 1;
  });
}