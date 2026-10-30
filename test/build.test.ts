import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    const distCliPath = resolve("dist/cli.js");
    expect(existsSync(distCliPath)).toBe(true);

    const res = spawnSync(process.execPath, [distCliPath, "review", "--help"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Usage: inspector review/i);
    expect(res.stdout).toMatch(/Exit codes:/i);
  });
});
