import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 15 hygiene: the Outlook calendar files hold the line the sprint was
 * judged on. The forbidden patterns are built from pieces so that a grep over
 * this sprint's files for those same patterns stays clean.
 */

const SERVICE_ROLE_CALL = ["get", "AdminClient", "\\("].join("");
const ADMIN_IMPORT = ["@/lib/db/", "admin"].join("");
const SERVICE_KEY = ["SUPABASE_", "SERVICE", "_ROLE"].join("");
const RAW_HTML = ["dangerously", "SetInnerHTML"].join("");
const EM_DASH = String.fromCharCode(0x2014);

function files(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir).filter((f) => ext.test(f)).map((f) => path.join(dir, f));
}

const calendarLib = files("src/lib/calendar", /^outlook-.*\.ts$/);
const calendarUi = files("src/components/calendar", /\.tsx$/);
const sprintFiles = [...calendarLib, ...calendarUi];

describe("Sprint 15 hygiene", () => {
  it("finds the files it is meant to check", () => {
    expect(calendarLib.length).toBeGreaterThanOrEqual(5);
    expect(calendarUi.length).toBeGreaterThanOrEqual(2);
  });

  it("no new service-role use: no admin client, no admin import, no service key", () => {
    // The sync receives its admin client from the cron route as an argument; none of these files imports one.
    const changed = [...sprintFiles, "src/lib/mailbox/sync.ts", "src/lib/mailbox/providers.ts", "src/app/dashboard/settings/integrations/page.tsx"];
    for (const f of changed) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(new RegExp(SERVICE_ROLE_CALL));
      expect(src, f).not.toContain(ADMIN_IMPORT);
      expect(src, f).not.toContain(SERVICE_KEY);
    }
  });

  it("the readers and the components use the scoped client only", () => {
    for (const f of [...calendarUi, "src/lib/calendar/outlook-read.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toContain(ADMIN_IMPORT);
    }
    expect(fs.readFileSync("src/lib/calendar/outlook-read.ts", "utf8")).toContain("getScopedClient");
  });

  it("no raw HTML injection and no console output in any file of the sprint", () => {
    for (const f of sprintFiles) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toContain(RAW_HTML);
      expect(src, f).not.toMatch(/\bconsole\./);
    }
  });

  it("the cron route, vercel.json and the global stylesheet are untouched by this sprint's code", () => {
    // The route still passes only the admin client and credentials; it has no calendar knowledge.
    const route = fs.readFileSync("src/app/api/cron/mailbox-sync/route.ts", "utf8");
    expect(route).not.toMatch(/calendar/i);
    const cron = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path: string }> };
    expect(cron.crons?.filter((c) => c.path.includes("mailbox-sync"))).toHaveLength(1);
    expect(fs.readFileSync("src/app/globals.css", "utf8")).not.toMatch(/lx-consult|outlook/i);
  });

  it("no em dash in the new components' copy, and no placeholder text", () => {
    for (const f of calendarUi) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toContain(EM_DASH);
      expect(src, f).not.toMatch(/lorem|TODO|FIXME|placeholder|sample event/i);
    }
  });

  it("the sync stores no body: the only mention of the preview is the select, the parser's read and the notes", () => {
    const sync = fs.readFileSync("src/lib/calendar/outlook-sync.ts", "utf8");
    const written = sync.slice(sync.indexOf("function eventRows"), sync.indexOf("function chunks"));
    expect(written).not.toMatch(/body|preview/i);
    const parse = fs.readFileSync("src/lib/calendar/outlook-parse.ts", "utf8");
    const rowType = parse.slice(parse.indexOf("export type OutlookEventRow"), parse.indexOf("export const MAX_ATTENDEES"));
    expect(rowType).not.toMatch(/body|preview/i);
  });

  it("the calendar header copy no longer says synced from Lawmatics anywhere in src", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /synced from Lawmatics/i.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });

  it("calendar-sync has its label on the Agents page run log", () => {
    expect(fs.readFileSync("src/app/dashboard/agents/page.tsx", "utf8")).toContain('"calendar-sync": "Calendar sync"');
  });

  it("AGENTS.md carries the Outlook calendar section", () => {
    const agents = fs.readFileSync("AGENTS.md", "utf8");
    expect(agents).toContain("## Outlook calendar (lectual 0098, Sprint 15)");
    expect(agents).toContain("Apply 0098 to BOTH lectual-dev and lectual-prod");
  });
});
