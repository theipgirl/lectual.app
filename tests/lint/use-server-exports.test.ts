import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Next refuses a "use server" module that exports anything but async functions, and the
// failure only shows at runtime: every server action on the page answers 500. A constant
// exported from one actions file took down every form in the dashboard on 2026-10-23.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('"use server" files export only async functions', () => {
  const serverFiles = files("src").filter((f) => /^\s*["']use server["'];?\s*$/m.test(readFileSync(f, "utf8").split("\n").slice(0, 3).join("\n")));

  it("finds the server action files", () => {
    expect(serverFiles.length).toBeGreaterThan(10);
  });

  it.each(serverFiles)("%s", (file) => {
    const bad = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => /^export\s/.test(line))
      .filter((line) => !/^export\s+(async\s+function|type\s|interface\s)/.test(line));
    expect(bad).toEqual([]);
  });
});
