import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
/** Patterns are assembled from pieces so this file never contains the words it forbids elsewhere. */
const re = (flags: string, ...parts: string[]) => new RegExp(parts.join(""), flags);
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

/** Every file Sprint 13 added in src/, plus the Settings index it rewrote. */
const NEW_FILES = [
  ...walk("src/lib/setup"),
  ...walk("src/components/setup"),
  ...walk("src/components/integrations"),
  ...walk("src/app/dashboard/settings/setup"),
  ...walk("src/app/dashboard/setup"),
  "src/lib/integrations/copy.ts",
  "src/app/dashboard/settings/page.tsx",
];
const CODE = NEW_FILES.filter((f) => /\.(ts|tsx)$/.test(f));

describe("Today wiring", () => {
  const today = read("src/app/dashboard/page.tsx");

  it("has exactly one get-set-up card element and one import for it (Sprint 34: Setup or Getting started, never both)", () => {
    expect(today.match(/<GetSetUpCard\b/g)).toHaveLength(1);
    expect(today.match(/import \{ GetSetUpCard \} from "@\/components\/setup\/GetSetUpCard";/g)).toHaveLength(1);
    expect(today).toContain("<GetSetUpCard role={session.role} />");
    expect(today).not.toContain("<FinishSetupCard");
    expect(today).not.toContain("<GettingStartedCard");
  });

  it("places the card between the unreachable banner and the main split", () => {
    const banner = today.indexOf("We couldn&apos;t reach the approval");
    const card = today.indexOf("<GetSetUpCard");
    const split = today.indexOf('<div className="lx-split">');
    expect(banner).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(banner);
    expect(split).toBeGreaterThan(card);
  });
});

describe("what the new files may not do", () => {
  it("has files to check", () => {
    expect(CODE.length).toBeGreaterThan(15);
  });

  it("uses no service role, no admin client, no raw HTML injection", () => {
    for (const f of CODE) {
      const src = read(f);
      expect(src, f).not.toMatch(re("", "get", "AdminClient\\(|@\\/lib\\/db\\/", "admin|SUPABASE_", "SERVICE_ROLE|dangerously", "SetInnerHTML"));
    }
  });

  it("adds no server action and no route handler", () => {
    for (const f of CODE) expect(read(f), f).not.toMatch(re("", "[\"']use ", "server[\"']"));
    expect(NEW_FILES.filter((f) => /(^|\/)route\.ts$/.test(f))).toEqual([]);
  });

  it("writes nothing: no insert, update, upsert, delete or rpc in the setup loader, page, redirect and card", () => {
    for (const f of [...walk("src/lib/setup"), "src/app/dashboard/settings/setup/page.tsx", "src/app/dashboard/settings/page.tsx", "src/components/setup/FinishSetupCard.tsx", "src/components/setup/SetupChecklistView.tsx"]) {
      expect(read(f), f).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    }
  });

  it("sends nothing and builds no client link: no approval flow, mail provider, notification or network call", () => {
    for (const f of CODE) {
      const src = read(f);
      expect(src, f).not.toMatch(re("i", "que", "ue|send", "Mail|re", "send|noti", "fy\\(|\\bfe", "tch\\("));
    }
  });

  it("takes no org id from the browser, and sets no select(\"*\") on the sealed tables", () => {
    for (const f of CODE) {
      const src = read(f);
      expect(src, f).not.toMatch(/searchParams|org_id|orgId/);
      expect(src, f).not.toMatch(/select\(\s*["']\*["']\s*\)/);
    }
  });

  it("every role check goes through canSeeSetup", () => {
    for (const f of ["src/app/dashboard/settings/setup/page.tsx", "src/app/dashboard/settings/layout.tsx", "src/components/setup/FinishSetupCard.tsx"]) {
      expect(read(f), f).toContain("canSeeSetup(");
    }
  });

  it("uses tokens only: no hex or rgb colour in the new CSS or inline", () => {
    for (const f of NEW_FILES.filter((x) => /\.(css|tsx)$/.test(x))) {
      expect(read(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });

  it("has no placeholder wording on the new surfaces", () => {
    for (const f of CODE.filter((x) => !x.includes("integrations/states"))) {
      expect(read(f), f).not.toMatch(/\bTODO\b|lorem|FIXME/i);
    }
  });
});

describe("docs", () => {
  it("onboarding Part 2 points at /dashboard/setup and maps the steps to the checklist", () => {
    const doc = read("docs/onboarding-rpb.md");
    const part2 = doc.slice(doc.indexOf("## Part 2"), doc.indexOf("## After"));
    expect(part2).toContain("/dashboard/setup");
    expect(part2).toContain("Firm profile and sign-off");
    expect(part2).toContain("LawPay connected");
    expect(part2).toContain("AI configured");
  });

  it("AGENTS.md has the Setup checklist section", () => {
    expect(read("AGENTS.md")).toContain("## Setup checklist (`/dashboard/setup`");
  });
});
