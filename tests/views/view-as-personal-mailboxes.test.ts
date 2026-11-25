import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isEntryFile } from "./_entry";

/**
 * View as (D2): the owner's PERSONAL mailboxes never reach a teammate's view. Every render path that lists mailbox
 * connections goes through listConnectionsForViewer (shared mailboxes only while previewing) or filters them itself.
 */
const ROOT = path.resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** The only non-entry files that may call listConnections() directly, each with why it can't leak a personal mailbox. */
const DIRECT: Record<string, string> = {
  "src/lib/mailbox/connections.ts": "the definition",
  "src/lib/views/view-as.ts": "listConnectionsForViewer itself",
  "src/app/dashboard/mail/page.tsx": "filters to scope 'firm' while previewing (and skips live reads on the flag)",
  "src/lib/calendar/consult-deps-view.ts": "sharedOnly: scope 'firm' while a teammate is shown",
  "src/lib/calendar/consult-sources-live.ts": "used only outside a preview (consultDepsForViewer replaces it in one)",
};

const fixture = vi.hoisted(() => ({ inPreview: true }));
vi.mock("@/lib/mailbox/connections", () => ({
  listConnections: async () => ({
    ok: true,
    connections: [
      { id: "p", scope: "personal", provider: "microsoft", email: "owner-own@example.com", status: "active" },
      { id: "f", scope: "firm", provider: "microsoft", email: "intake@example.com", status: "active" },
    ],
  }),
}));
vi.mock("@/lib/views/view-as-flag", () => ({ readPreviewState: async () => (fixture.inPreview ? { kind: "unknown" } : { kind: "off" }), previewFlag: async () => "off" }));
vi.mock("@/lib/firm/session", () => ({
  loadFirmSessionCore: async () => ({ kind: "ok", user: { id: "u" }, org: { id: "o" }, member: { role: "owner", org_id: "o" }, role: "owner", displayName: "Owner" }),
  resolveFirmSession: async () => ({ kind: "ok" }),
}));

import { listConnectionsForViewer } from "@/lib/views/view-as";

describe("no preview surface lists personal connections", () => {
  it("every non-entry caller of listConnections() is the wrapper or filters itself", () => {
    const callers = walk(path.join(ROOT, "src"))
      .filter((f) => !isEntryFile(f) && /\blistConnections\(\)/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
    expect(callers.sort()).toEqual(Object.keys(DIRECT).sort());
  });

  it("the Integrations, Assistants, Features, Setup, Getting started and Reconcile readers use the wrapper", () => {
    for (const f of ["src/app/dashboard/settings/integrations/page.tsx", "src/app/dashboard/agents/page.tsx", "src/app/dashboard/settings/modules/page.tsx", "src/app/dashboard/intake/reconcile/page.tsx", "src/lib/setup/readers.ts", "src/lib/setup/first-users-load.ts"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8"), f).toMatch(/listConnectionsForViewer/);
    }
  });

  it("while the flag is on or unknown, only the shared mailbox is listed; otherwise all", async () => {
    fixture.inPreview = true;
    const on = await listConnectionsForViewer();
    expect(on.ok && on.connections.map((c) => c.email)).toEqual(["intake@example.com"]);
    expect(on.hidPersonal).toBe(true);
    fixture.inPreview = false;
    const off = await listConnectionsForViewer();
    expect(off.ok && off.connections.map((c) => c.email)).toEqual(["owner-own@example.com", "intake@example.com"]);
    expect(off.hidPersonal).toBeUndefined();
  });

  it("the Integrations page shows the sentence in the personal block and offers no personal connect while previewing", () => {
    const src = readFileSync(path.join(ROOT, "src/app/dashboard/settings/integrations/page.tsx"), "utf8");
    expect(src).toMatch(/\{!hidPersonal && <ConnectButton provider=\{p\} scope="personal"/);
    expect(src).toMatch(/previewName \? VIEW_AS_PRIVATE_MAIL\(previewName\) : VIEW_AS_PERSONAL_HIDDEN/);
  });
});
