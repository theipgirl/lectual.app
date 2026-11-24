import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(__dirname, "../../src/lib/meeting-assistant");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("meeting-assistant hygiene", () => {
  it("has files", () => expect(files.length).toBeGreaterThan(5));
  it("no console call except the one counts-only default logger", () => {
    for (const f of files) {
      const calls = strip(readFileSync(path.join(dir, f), "utf8")).match(/console\.\w+\([^)]*\)/g) ?? [];
      for (const c of calls) {
        expect(f).toBe("run.ts");
        expect(c).toMatch(/console\.info\(line\)/);
      }
    }
  });
  it("imports no service-role client, mail, queue or send function, and has no db write", () => {
    for (const f of files) {
      const src = strip(readFileSync(path.join(dir, f), "utf8"));
      expect(src).not.toMatch(/db\/admin|getAdminClient|service[-_ ]?role/i);
      expect(src).not.toMatch(/internal-mail|outlook-send|sendMail|send_message|\/queue\//);
      expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(src).not.toMatch(/getScopedClient/);
    }
  });
});
