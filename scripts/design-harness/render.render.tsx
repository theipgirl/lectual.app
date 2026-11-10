import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import { renderToPipeableStream } from "react-dom/server";
import type { Screen } from "./registry";
import { NOW } from "./fixtures";
import { documentHtml } from "./document";

const OUT = path.resolve(__dirname, "out");
const wanted = (process.env.HARNESS_SCREENS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Every screens/*.screen.tsx exports `screens: Screen[]`.
const SCREEN_DIR = path.resolve(__dirname, "screens");
const files = fs.readdirSync(SCREEN_DIR).filter((f) => f.endsWith(".screen.tsx")).sort();
const modules = await Promise.all(files.map((f) => import(/* @vite-ignore */ path.join(SCREEN_DIR, f)) as Promise<{ screens: Screen[] }>));
const all = modules.flatMap((m) => m.screens);
const chosen = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all;

/** Fizz renders async server components too (they are awaited), so the real pages work unmodified. */
function toHtml(node: React.ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        html += chunk.toString();
        cb();
      },
      final(cb) {
        resolve(html);
        cb();
      },
    });
    const stream = renderToPipeableStream(node, {
      onAllReady() {
        stream.pipe(sink);
      },
      onShellError: reject,
      onError: (e) => {
        reject(e);
      },
    });
  });
}

describe("design harness render", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    fs.mkdirSync(OUT, { recursive: true });
  });
  afterAll(() => vi.useRealTimers());

  it("has screens", () => expect(chosen.length).toBeGreaterThan(0));

  for (const screen of chosen) {
    it(`renders ${screen.id}`, async () => {
      screen.prepare?.();
      const element = await screen.render();
      let body = await toHtml(element);
      if (screen.transformHtml) body = screen.transformHtml(body);
      fs.writeFileSync(path.join(OUT, `${screen.id}.html`), documentHtml(screen, body));
    });
  }

  it("writes the manifest", () => {
    // Merge into the existing manifest so a partial run (HARNESS_SCREENS) keeps the other screens.
    const file = path.join(OUT, "manifest.json");
    const prev: { id: string }[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    const entry = ({ id, title, designBoard, viewport, designCrop, note }: Screen) => ({ id, title, designBoard, viewport, designCrop: designCrop ?? null, note: note ?? "" });
    const known = new Set(all.map((s) => s.id));
    const merged = [...prev.filter((p) => known.has(p.id) && !chosen.some((c) => c.id === p.id)), ...chosen.map(entry)];
    merged.sort((a, b) => all.findIndex((s) => s.id === a.id) - all.findIndex((s) => s.id === b.id));
    fs.writeFileSync(file, JSON.stringify(merged, null, 2));
  });
});
