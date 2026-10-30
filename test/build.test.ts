import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

describe("build and test hygiene", () => {
  it("has tsconfig.build.json configuring rootDir 'src' and excluding 'test'", () => {
    const tsconfigBuildPath = resolve("tsconfig.build.json");
    expect(existsSync(tsconfigBuildPath)).toBe(true);

    const content = JSON.parse(readFileSync(tsconfigBuildPath, "utf8"));
    expect(content.compilerOptions?.rootDir).toBe("src");
    expect(content.exclude).toContain("test");
  });

  it("has vitest.config.ts that excludes dist/**", () => {
    const vitestConfigPath = resolve("vitest.config.ts");
    expect(existsSync(vitestConfigPath)).toBe(true);

    const content = readFileSync(vitestConfigPath, "utf8");
    expect(content).toMatch(/dist\/\*\*/);
  });

  it("package.json uses tsconfig.build.json for build and has bin pointing to ./dist/cli.js", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(pkg.scripts?.build).toContain("tsconfig.build.json");
    expect(pkg.bin?.inspector).toBe("./dist/cli.js");
  });

  it("builds dist/cli.js and allows node dist/cli.js review --help to run successfully", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "build-test-"));
    try {
      const tscBin = resolve("node_modules/typescript/bin/tsc");
      const tscArgs = ["-p", "tsconfig.build.json", "--outDir", tmpDir];
      const buildRes = existsSync(tscBin)
        ? spawnSync(process.execPath, [tscBin, ...tscArgs], { encoding: "utf8" })
        : spawnSync("npx", ["tsc", ...tscArgs], { encoding: "utf8", shell: true });
      expect(buildRes.status).toBe(0);

      const cliPath = resolve(tmpDir, "cli.js");
      expect(existsSync(cliPath)).toBe(true);

      const res = spawnSync(process.execPath, [cliPath, "review", "--help"], {
        encoding: "utf8",
      });
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/Usage: inspector review/i);
      expect(res.stdout).toMatch(/Exit codes:/i);
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
