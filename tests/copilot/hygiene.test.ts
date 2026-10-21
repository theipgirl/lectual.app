import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every file under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const SRC = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));

/** The copilot's own files: the ones a read-only / no-send / no-admin rule applies to. */
const COPILOT_FILES = [
  "src/app/api/matters-chat/route.ts",
  "src/app/dashboard/copilot/page.tsx",
  "src/app/dashboard/copilot/stat-cards.tsx",
  "src/components/copilot/CopilotChat.tsx",
  "src/components/copilot/CopilotLauncher.tsx",
  "src/lib/agents/matters-chat.ts",
  "src/lib/agents/copilot-context.ts",
  "src/lib/agents/copilot-cost.ts",
  ...readdirSync("src/lib/copilot").map((f) => `src/lib/copilot/${f}`),
];
const read = (f: string) => readFileSync(f, "utf8");

describe("the launcher is mounted exactly once, in the dashboard layout", () => {
  it("finds <CopilotLauncher once in src/, passing configured={aiConfigured()}", () => {
    const hits = SRC.filter((f) => read(f).includes("<CopilotLauncher"));
    expect(hits).toEqual(["src/app/dashboard/layout.tsx"]);
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout.match(/<CopilotLauncher/g)).toHaveLength(1);
    expect(layout).toContain("<CopilotLauncher configured={aiConfigured()} />");
  });
});

describe("the copilot stays read-only, firm-scoped and free of send paths", () => {
  it.each(COPILOT_FILES)("%s uses no service-role client", (f) => {
    expect(read(f)).not.toMatch(/getAdminClient\(|@\/lib\/db\/admin|SUPABASE_SERVICE_ROLE/);
  });

  it.each(COPILOT_FILES)("%s writes nothing and sends nothing", (f) => {
    expect(read(f)).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(|sendMail|resend|notify\(|createDraft|queue_draft|agent_run/i);
  });

  it.each(COPILOT_FILES)("%s has no placeholders", (f) => {
    expect(read(f)).not.toMatch(/\bTODO\b|FIXME|lorem ipsum/i);
  });

  it("adds no dangerouslySetInnerHTML anywhere in src/", () => {
    expect(SRC.filter((f) => read(f).includes("dangerouslySetInnerHTML"))).toEqual([]);
  });

  it("the tool set is unchanged: the same six reads", () => {
    const src = read("src/lib/agents/matters-chat.ts");
    const names = [...src.matchAll(/^    ([a-z_]+): \{\n      description:/gm)].map((m) => m[1]);
    expect(names).toEqual(["search_matters", "get_matter_detail", "get_upcoming_deadlines", "list_stalled_matters", "search_leads", "get_recent_activity"]);
  });
});

describe("COPILOT_MODEL", () => {
  it("is declared in env.ts and read only through copilotModel()", () => {
    expect(read("src/lib/env.ts")).toMatch(/COPILOT_MODEL: z\.string\(\)\.optional\(\)/);
    const readers = SRC.filter((f) => /COPILOT_MODEL/.test(read(f)) && f !== "src/lib/env.ts");
    expect(readers).toEqual(["src/lib/ai/claude.ts"]);
    expect(read("src/lib/ai/claude.ts").match(/env\.COPILOT_MODEL/g)).toHaveLength(1);
  });
});

describe("the route never takes the org from the body", () => {
  it("reads the org id from the resolved session", () => {
    const route = read("src/app/api/matters-chat/route.ts");
    expect(route).toContain("session.org.id");
    expect(route).not.toMatch(/parsed\.data\.(orgId|org_id)|body\.(orgId|org_id)/);
  });
});

describe("AGENTS.md documents the copilot", () => {
  const doc = read("AGENTS.md");
  const section = doc.slice(doc.indexOf("## Copilot"), doc.indexOf("## JSX text spacing"));

  it("has a Copilot section", () => {
    expect(doc).toContain("## Copilot (`/dashboard/copilot`");
    expect(section.length).toBeGreaterThan(500);
  });

  it.each([
    "Server-Sent Events",
    "`tool`",
    "`delta`",
    "`context`",
    "`final`",
    "`error`",
    "COPILOT_MODEL",
    'claude-sonnet-5',
    "`listMatters()` is read once",
    "last 10",
    "8k",
    "mounted once",
    "/dashboard/copilot",
    "re-reads the record",
    "Cost is logged, not stored",
    "0098",
  ])("covers %s", (item) => {
    expect(section).toContain(item);
  });
});
