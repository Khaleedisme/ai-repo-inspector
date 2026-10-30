# Submission

## What did you investigate first, and why?

I read all of `src/` and `test/` (about 180 lines) and ran `npm run typecheck` and `npm test` before changing
anything. Both passed, but the only test covered `report.ts`, so green meant very little.

Because the tool is meant to be called by AI agents, I looked first at the places where input from an untrusted
caller reaches a shell, git, or the file system. I **reproduced each suspicion by running it** instead of
trusting a code read:

- `validation.ts` used `exec` (a shell). `echo ok; touch /tmp/x` created the file.
- MCP exposed `validationCommands` to the caller, so the same shell was reachable by an agent.
- `mcp-server.ts` declared `repo_path` but read `input.repoPath`. The value was `undefined`, git ran in the
  server's cwd, and the tool **silently reviewed the wrong repository** (report title: `undefined`).
- `baseRef` reached `git diff` unvalidated. `--base-ref "--output=/tmp/x"` made git write a file.
- A failing validation command rejected the promise and crashed the whole review.
- `--repo` was cut at the first space, `--format json` was accepted and silently ignored, renames produced
  `old<TAB>new (modified)`, and the default base was hard-coded to `main`.

## What did you choose to implement or fix?

In priority order (security and silent-wrong-answer bugs first, polish last). Each item has a separate red test
commit followed by the fix commit.

1. **MCP contract:** one zod schema, `repo_path` is actually used, no `any`, errors returned with `isError: true`.
2. **Trust boundary:** allowed roots (`REPO_INSPECTOR_ROOTS`, default: server cwd) with a realpath check; MCP
   accepts only the presets `test`, `typecheck`, `build`; `core` has an explicit `validationPolicy`
   (`presets-only` by default, the CLI uses `trusted-cli`).
3. **`baseRef`:** reject a leading `-`, verify with `rev-parse --verify --end-of-options`, pass `--end-of-options`;
   the default base is detected from `origin/HEAD`, then `main`, then `master`.
4. **Validation:** no shell, timeout (30 s), `maxBuffer` (10 MB); failures are returned as data (`failed`, exit
   code, stdout and stderr, `timedOut`, `truncated`) instead of being thrown.
5. **Git:** `-z --find-renames` parsing, renamed files carry `oldPath`, unicode names are not octal-quoted, git
   has a timeout and a buffer limit.
6. **CLI:** strict `parseArgs`, `--help`, clean one-line errors, `--format json`, exit codes 0 / 1 / 2.
7. **Report:** per-validation status and exit code, a code fence longer than any backtick run in the output
   (output cannot break out of the block), a 16 KB per-validation cap (head and tail kept, flagged), renamed
   files shown as `old -> new`.
8. **Build and test hygiene:** `tsconfig.build.json` so `bin` points to a real `dist/cli.js`; `vitest.config.ts`
   so compiled tests in `dist/` no longer run twice; the build test compiles into a temp directory so
   `npm test` works on a fresh clone.

Result: 61 unique tests (starter had 1).

## What did you intentionally not do?

- **Uncommitted and untracked changes are not reported.** The tool compares `base...HEAD` only. I did not have
  time to design the flag and its semantics properly.
- **MCP has no `format` parameter;** JSON output is CLI-only for now. There is no CLI/MCP parity test.
- **Validation presets run the inspected repository's own `npm` scripts.** A malicious repo inside an allowed
  root can therefore run code. The allowed-roots list is the only guard; I documented it instead of sandboxing.
- **Git can run repo-configured helpers** (for example `core.fsmonitor`) in an untrusted repository. Not addressed.
- On timeout only the direct child process is killed, not its process tree.
- The MCP error for a path outside the roots lists the allowed roots (minor information disclosure).
- `outputTruncated` appears in JSON only when output was truncated; a stable always-present field would be a
  better contract.
- A case-only rename (`README.md` to `readme.md`) was checked on Linux (reported as a rename). I did **not**
  test it on Windows, where `core.ignorecase` may behave differently.

## Interface decision

- Decision: **hybrid, deliberately asymmetric**
- Primary user and execution environment: developers and local coding agents on a developer machine or in CI,
  inspecting repositories they own.
- Trust boundary and allowed capabilities: the CLI caller is the machine's owner (trusted), so it may run
  free-text validation commands, still without a shell. The MCP caller is an LLM that can be prompt-injected
  (untrusted), so it may only name presets, only inside configured roots, and never supplies command text.
  Repositories inside the allowed roots are assumed trusted, because presets execute their scripts.
- Reliability, discoverability, latency/context, and output-size tradeoffs: stdio MCP is easy for agents to
  discover but must keep responses small, so each validation output is capped at 16 KB and flagged when cut; git
  and validation have 30 s timeouts; failures are returned as structured data so one failing test run does not
  lose the whole report. Markdown is for humans and agents, JSON is for scripts. Exit code 2 lets CI tell
  "report produced, validation failed" apart from "tool error".
- How supported interfaces remain consistent: both adapters call the same `reviewRepository` in `core`, and the
  policy difference is explicit (`validationPolicy`) instead of hidden in adapters. They are **not** fully
  consistent yet: JSON format is CLI-only (see "not done").
- Evidence that would change this decision: if most real usage is CI, I would make it CLI-first and drop MCP;
  if agents need project-specific checks, I would add a per-repository allowlist file instead of free-text commands.

## How did you use an AI coding agent?

Two AI tools with separate roles. **Claude (chat)** acted as investigator, reviewer and orchestrator: it read the
code, reproduced bugs, wrote the phase prompts, and re-verified every batch from a fresh clone of my repository.
**Gemini in Antigravity** implemented the changes as an agent.

I ran it in phases: an investigation-only phase (no edits), then batches of 3-5 items, each requiring a failing
test first, a separate commit per step, and a stated uncertainty at the end of each batch. I used the agent's
own summaries only as claims to check, not as evidence.

## Where did you check, correct, or reject an AI suggestion? (required)

Verified by running code, not by reading the agent's summaries:

- The agent rated the `bin` path problem "Critical". It only affects an installed `inspector` command (the
  README uses `tsx`), so I treated it as medium and fixed it last.
- The agent described the `repo_path` bug as "the tool crashes". Reproduced behaviour was worse: it silently
  reviewed the wrong repository.
- The agent's first findings list missed `baseRef` argument injection. I reproduced it (git wrote a file) and
  had it fixed.
- The Batch 1 summary claimed `maxBuffer` was 10 MB; the code said 1 MB. Found by reading the constant and
  running a 2 MB output.
- The Batch 1 summary said "50 tests"; only 25 were unique, because `vitest` also ran compiled copies in `dist/`.
- The Batch 1 summary said "TDD", but each commit contained test and fix together. I asked for separate red
  commits and later checked three of them out individually to confirm they really fail.
- The agent's new preset lookup (`cmd in VALIDATION_PRESETS`) matched prototype keys (`constructor`,
  `__proto__`) and crashed the CLI. This bug was introduced by the agent's own security fix; fixed with
  `Object.hasOwn`.
- The agent worried that case-only renames break on Windows (`core.ignorecase`). I tested the committed-diff case
  on Linux (works); for `base...HEAD` between two commits the working-tree setting should not matter, but I did
  not confirm it on Windows.
- After Batch 3, `npm test` failed on a fresh clone because a test required a prior `npm run build`. CI hid it
  because CI builds first. The agent had reported "all tests pass" from a directory that already had `dist/`.
  I found it in a clean clone and had the test compile into a temp directory.

## Commands used to verify the result, with outcomes

Run on Windows by the agent, and independently re-run by the reviewer on a fresh Linux clone (Node 22, git 2.43):

```
npm ci
npm run typecheck                                  # passes
rm -rf dist && npm test                            # 7 files, 61 tests pass (no prior build needed)
npm run build && npm test                          # 61 pass; dist/cli.js exists
node dist/cli.js review --help                     # documents exit codes 0 / 1 / 2
node dist/cli.js review --repo "<path with spaces>" --base-ref <ref>      # works
node dist/cli.js review --repo <repo> --base-ref "--output=/tmp/x"        # rejected, no file created
node dist/cli.js review --repo <repo> --validate 'node -e "process.exit(3)"'
                                                   # exit code 2, report says FAILED (exitCode: 3)
node dist/cli.js review --repo <repo> --validate constructor              # clean failure, no crash
node dist/cli.js review --repo <repo> --bogus      # clean one-line error, exit 1
```

MCP over stdio: a path outside the allowed root is rejected with `isError`; a symlink pointing outside the root
is rejected; `validationCommands: ["touch /tmp/x"]` is rejected by the schema and no file is created;
`baseRef: "--output=/tmp/x"` is rejected. A 200 KB validation output produced a report of about 16.6 KB.

## A blocker you hit and how you approached it

Starting `npm` without a shell fails on Windows (`npm` is `npm.cmd`), while CI runs on Linux. I kept the fixed
presets as the only place with a Windows special case (`cmd.exe /d /s /c npm ...`), so no user-supplied text
ever reaches a shell. A second blocker was the build test depending on an existing `dist/`, described above.

## Known limitations and the next three things you would do

1. Report uncommitted and untracked changes behind an explicit flag.
2. Add `format` to the MCP schema with a CLI/MCP/core parity test; add a Windows job to CI.
3. Replace free-text trust with a per-repository allowlist file, and kill the whole process tree on timeout.

## Approximate focused-work time

- Start: 13:55 (repository created from the template, Baku time, 30 Oct 2026)
- Finish: about 15:50
- Honest accounting: this is about 115 minutes wall-clock, which is **over the 90-minute limit**. Roughly 30
  minutes of that were gaps between commits (reviewing and re-verifying agent output, which I did not count as
  idle). The last ~25 minutes (after 15:24) went only to fixing the fresh-clone test failure and writing this
  document; no new features were added in that period. Reading the starter and an initial investigation before
  creating the repository are not included. I would rather report this accurately than round it down.
