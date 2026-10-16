import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { runMailboxSync } from "@/lib/mailbox/sync";
import { planActivities } from "@/lib/mailbox/apply";
import { buildEmailEvidence } from "@/lib/intake/email-match";
import type { ThreadMessage } from "@/lib/intake/email-threads";
import { fakeAdmin, filterValue, type Recorded } from "./fake-db";

const root = randomBytes(32);
const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const CONN = "33333333-3333-3333-3333-333333333333";
const NOW = Date.parse("2026-09-25T12:00:00Z");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gmailMessage(id: string, from: string, subject: string, labels = ["INBOX"]) {
  return {
    id,
    threadId: `t-${id}`,
    labelIds: labels,
    internalDate: String(Date.parse("2026-09-24T09:00:00Z")),
    snippet: "Private words the client wrote",
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: "intake@firm.example" },
        { name: "Subject", value: subject },
      ],
    },
  };
}

function providerFetch(opts: { refresh: "ok" | "invalid_grant" }) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("oauth2.googleapis.com/token")) {
      return opts.refresh === "ok"
        ? json({ access_token: "fresh-access", expires_in: 3600 })
        : json({ error: "invalid_grant" }, 400);
    }
    if (url.endsWith("/profile")) return json({ historyId: "777" });
    if (url.includes("/messages?q=")) return json({ messages: [{ id: "lead" }, { id: "client" }, { id: "stranger" }] });
    if (url.includes("/messages/lead?")) return json(gmailMessage("lead", "Amara Nwosu <amara@example.com>", "Hello"));
    if (url.includes("/messages/client?")) return json(gmailMessage("client", "Leslie <leslie@ayaforstudio.example>", "AYAFOR renewal"));
    if (url.includes("/messages/stranger?")) return json(gmailMessage("stranger", "News <news@iplawweekly.example>", "Weekly digest"));
    throw new Error(`unrouted ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

function db(connectionOverrides: Record<string, unknown> = {}) {
  return fakeAdmin((q: Recorded) => {
    if (q.table === "crm_org" && q.action === "select") return { data: [{ id: ORG }], error: null };
    if (q.table === "mailbox_connection" && q.action === "select") {
      return {
        data: [
          {
            id: CONN,
            org_id: ORG,
            provider: "google",
            email: "intake@firm.example",
            status: "active",
            access_token_enc: sealToken(root, "stale-access"),
            refresh_token_enc: sealToken(root, "the-refresh-token"),
            token_expires_at: "2026-09-25T11:00:00Z", // already expired
            sync_cursor: null,
            matched_count: 5,
            ...connectionOverrides,
          },
        ],
        error: null,
      };
    }
    if (q.table === "crm_lead" && q.action === "select") {
      return {
        data: [
          { id: "lead-1", first_name: "Amara", last_name: "Nwosu", business_name: null, email: "amara@example.com", mark_text: null, assigned_to: "user-a", last_outbound_at: null, last_inbound_at: null },
        ],
        error: null,
      };
    }
    if (q.table === "crm_contact") return { data: [{ id: "contact-1", email: "leslie@ayaforstudio.example" }], error: null };
    if (q.table === "crm_matter_contact") return { data: [{ contact_id: "contact-1", matter_id: "matter-1" }], error: null };
    if (q.table === "crm_matter") return { data: [{ id: "matter-1", mark_text: "AYAFOR" }], error: null };
    if (q.table === "crm_org_member") return { data: [{ user_id: "user-a", role: "intake" }], error: null };
    if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run-1" }], error: null };
    if (q.table === "crm_activity" && q.action === "insert") {
      const rows = q.values as Array<{ payload: unknown }>;
      return { data: rows.map((r, i) => ({ id: `act-${i}`, payload: r.payload })), error: null };
    }
    return undefined;
  });
}

const creds = () => ({ clientId: "cid", clientSecret: "secret" });

describe("mailbox sync, end to end against a recording database", () => {
  it("files the lead's and the client's mail, drops the stranger's, and stays inside the firm", async () => {
    const { client, log } = db();
    const { impl } = providerFetch({ refresh: "ok" });
    const summary = await runMailboxSync({
      admin: client as unknown as SupabaseClient,
      root,
      credentials: creds,
      fetchImpl: impl,
      now: () => NOW,
    });
    expect(summary).toMatchObject({ orgs: 1, connections: 1, ok: 1, failed: 0 });

    // Two timeline rows: the lead's email, and the client's email on their matter.
    const inserts = log.filter((q) => q.table === "crm_activity" && q.action === "insert");
    const rows = inserts.flatMap((q) => q.values as Array<Record<string, unknown>>);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.lead_id === "lead-1")).toMatchObject({ type: "email_received", org_id: ORG });
    expect(rows.find((r) => r.matter_id === "matter-1")).toMatchObject({ lead_id: null, org_id: ORG });

    // Nothing from the stranger, and no preview text anywhere.
    const written = JSON.stringify(rows);
    expect(written).not.toContain("iplawweekly");
    expect(written).not.toContain("Private words");

    // TENANT FENCE: every read or write of a tenant table carries this firm's org_id.
    const tenantTables = new Set(["crm_lead", "crm_contact", "crm_matter_contact", "crm_matter", "crm_org_member", "crm_activity", "crm_notification", "agent_run", "mailbox_connection"]);
    for (const q of log.filter((x) => tenantTables.has(x.table))) {
      const scoped =
        filterValue(q, "org_id") === ORG ||
        (Array.isArray(filterValue(q, "org_id")) && (filterValue(q, "org_id") as string[]).every((id) => id === ORG)) ||
        (q.action === "insert" && [q.values].flat().every((v) => (v as { org_id?: string }).org_id === ORG));
      expect(scoped, `${q.action} ${q.table} not scoped to the firm`).toBe(true);
      expect(JSON.stringify(q)).not.toContain(OTHER_ORG);
    }

    // The refreshed token was re-sealed, never stored in the clear.
    const tokenWrite = log.find((q) => q.table === "mailbox_connection" && q.action === "update" && (q.values as Record<string, unknown>).access_token_enc);
    const sealed = (tokenWrite!.values as { access_token_enc: string }).access_token_enc;
    expect(sealed).not.toContain("fresh-access");
    expect(openToken(root, sealed)).toBe("fresh-access");

    // Cursor, count and status recorded on the connection.
    const done = log.find((q) => q.table === "mailbox_connection" && q.action === "update" && (q.values as Record<string, unknown>).sync_cursor);
    expect(done!.values).toMatchObject({ sync_cursor: "777", status: "active", matched_count: 7, last_error: null });

    // The run log holds counts, not content.
    const runUpdate = log.find((q) => q.table === "agent_run" && q.action === "update");
    expect(runUpdate!.values).toMatchObject({ status: "ok", items_in: 3 });
    expect(JSON.stringify(runUpdate!.values)).not.toMatch(/@|Amara|AYAFOR/);
  });

  it("a revoked refresh token marks the mailbox for reconnection and writes nothing else", async () => {
    const { client, log } = db();
    const { impl, calls } = providerFetch({ refresh: "invalid_grant" });
    const summary = await runMailboxSync({ admin: client as unknown as SupabaseClient, root, credentials: creds, fetchImpl: impl, now: () => NOW });
    expect(summary).toMatchObject({ ok: 0, failed: 1 });
    expect(log.some((q) => q.table === "crm_activity" && q.action === "insert")).toBe(false);
    const status = log.find((q) => q.table === "mailbox_connection" && q.action === "update");
    expect(status!.values).toMatchObject({ status: "reauth" });
    expect(calls.some((c) => c.includes("gmail.googleapis.com"))).toBe(false);
  });

  it("skips the whole run when no firm holds the mailbox module", async () => {
    const { client, log } = fakeAdmin((q) => (q.table === "crm_org" ? { data: [], error: null } : undefined));
    const summary = await runMailboxSync({ admin: client as unknown as SupabaseClient, root, credentials: creds, now: () => NOW });
    expect(summary.connections).toBe(0);
    expect(log.some((q) => q.table === "mailbox_connection")).toBe(false);
  });
});

describe("planning activity rows", () => {
  const base: ThreadMessage = {
    id: "m1",
    conversationId: null,
    mailbox: "intake@firm.example",
    folder: "inbox",
    direction: "inbound",
    at: "2026-09-24T09:00:00Z",
    from: { name: "Amara Nwosu", address: "amara@example.com" },
    to: [],
    cc: [],
    subject: "Opposing counsel letter",
    preview: "Settlement terms attached",
    webLink: null,
  };

  it("never puts a preview in the payload, and tags the source and connection", () => {
    const leads = [{ id: "L", firstName: "Amara", lastName: "Nwosu", businessName: null, email: "amara@example.com", markText: null, stageName: null, assignedTo: null, lastOutboundAt: null, lastInboundAt: null }];
    const report = buildEmailEvidence({ messages: [base], leads, directory: [] });
    const planned = planActivities({ report, messages: [base], matterFor: () => null, connectionId: "conn-1" });
    expect(planned).toHaveLength(1);
    expect(planned[0].payload).toMatchObject({ source: "mailbox-sync", connection_id: "conn-1", message_id: "m1" });
    expect(JSON.stringify(planned[0].payload)).not.toContain("Settlement");
  });

  it("produces nothing for a message matching no lead and no matter", () => {
    const report = buildEmailEvidence({ messages: [base], leads: [], directory: [] });
    expect(planActivities({ report, messages: [base], matterFor: () => null, connectionId: "c" })).toEqual([]);
  });
});
