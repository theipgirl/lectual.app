import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");

describe("B5: the recorder reads nothing from the page", () => {
  const files = ["src/components/feedback/FeedbackTrailRecorder.tsx", "src/lib/feedback/trail.ts", "src/components/feedback/FeedbackDialog.tsx", "src/components/feedback/SendFeedbackButton.tsx"];
  it.each(files)("%s has no DOM reads and no storage but sessionStorage", (f) => {
    const src = read(f);
    // The dialog reads its own two controls' values (the person's typing); the recorder and trail never read a value.
    const forbidden = f.endsWith("FeedbackDialog.tsx") ? /\bdocument\.|innerText|textContent|querySelector|FormData|localStorage/ : /\bdocument\.|innerText|textContent|querySelector|FormData|localStorage|\.value\b/;
    expect(src).not.toMatch(forbidden);
    if (f.endsWith("FeedbackDialog.tsx")) expect(src).toMatch(/window\.sessionStorage/);
  });
  it("uses one storage key and renders nothing", () => {
    expect(read("src/lib/feedback/trail.ts").match(/lectual_feedback_trail/g)).toHaveLength(1);
    expect(read("src/components/feedback/FeedbackTrailRecorder.tsx")).toMatch(/return null;/);
  });
});

describe("B7: no database, no service role", () => {
  const files = [...walk("src/lib/feedback"), "src/app/dashboard/feedback-actions.ts", "src/lib/mail/internal-mail.ts", ...walk("src/components/feedback")];
  it.each(files)("%s", (f) => {
    expect(read(f)).not.toMatch(/db\/admin|getAdminClient|service[-_ ]role|getScopedClient|supabase/i);
  });
});

describe("B12: one mailer", () => {
  it("api.resend.com appears in exactly one source file, which failure-alert imports", () => {
    const hits = walk("src").filter((f) => read(f).includes("api.resend.com"));
    expect(hits).toEqual(["src/lib/mail/internal-mail.ts"]);
    expect(read("src/lib/agents/failure-alert.ts")).toContain('from "@/lib/mail/internal-mail"');
  });
});

describe("B14: env and docs", () => {
  it("lists the variables and documents the sprint", () => {
    expect(read("src/lib/env.ts")).toMatch(/FEEDBACK_TO: z\.string\(\)\.optional\(\)/);
    expect(read("src/lib/env.ts")).toMatch(/FEEDBACK_FROM: z\.string\(\)\.optional\(\)/);
    expect(read(".env.example")).toMatch(/^FEEDBACK_TO=$/m);
    expect(read(".env.example")).toMatch(/^FEEDBACK_FROM=$/m);
    const agents = read("AGENTS.md");
    expect(agents).toContain("Send feedback and the pay link (Sprint 25");
    expect(agents).toContain("bugs@lectual.app");
  });
});
