export type ChangedFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "untracked" | "renamed";
  oldPath?: string;
};

export type ValidationResult = {
  command: string;
  status: "passed" | "failed";
  output: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
};

export type ReviewRequest = {
  repositoryPath: string;
  baseRef?: string;
  validationCommands?: string[];
  format?: "markdown" | "json";
  validationPolicy?: "presets-only" | "trusted-cli";
};