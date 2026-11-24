import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(__dirname, "../../src/lib/uspto");

describe("src/lib/uspto", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  it("has source files", () => expect(files.length).toBeGreaterThan(5));
  it.each(files)("%s has no console.* call", (f) => {
    expect(readFileSync(path.join(dir, f), "utf8")).not.toMatch(/\bconsole\s*\./);
  });
  it("the key is read from env in config.ts only", () => {
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      const reads = /USPTO_TSDR_API_KEY/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
      expect(reads).toBe(f === "config.ts");
    }
  });
});
