// Ported from lectual tests/lawmatics/apply-budget.test.ts; the token now comes from the firm connection mock.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

import {
  RPB_STAGE_NAMES,
  contactsPayload,
  prospectsPayload,
  stageRefs,
} from "../__fixtures__/lawmatics.fixture";

/**
 * Direct coverage for `applyImport`'s time budget.
 *
 * `applyImport` had no direct tests at all — only mocks of it — because it
 * builds its own Supabase client internally. It is also the one function in
 * this codebase that writes real client records into a law firm's CRM, and it
 * is NOT transactional: it is a sequence of individual RLS-scoped statements.
 * So a serverless timeout part-way through used to leave committed rows behind
 * and return nothing at all — no counts, no failures, no idea where it got to.
 *
 * The budget makes the run stop itself just short of the platform limit and
 * report. These tests pin the two properties that matter: what it already
 * wrote is counted honestly, and what it did not reach is named rather than
 * implied to be done.
 */

const stages = stageRefs(RPB_STAGE_NAMES);

/**
 * Drives the REAL Lawmatics client by stubbing global fetch with the shared
 * fixture payloads, rather than hand-rolling record shapes — the pull and
 * normalize layers then run for real and the shapes cannot drift.
 */
function stubFetch(prospectCount: number) {
  const people = Array.from({ length: prospectCount }, (_, i) => ({
    id: String(i + 1),
    matterName: `Matter ${i + 1}`,
    firstName: `First${i + 1}`,
    lastName: `Last${i + 1}`,
    email: `client${i + 1}@example.com`,
    company: `Business ${i + 1}`,
    stage: "Application Filed",
    createdAt: "2026-01-14T09:30:00.000Z",
    updatedAt: "2026-06-02T16:05:00.000Z",
  }));

  return vi.fn(async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.toString();
    const body = href.includes("/contacts") ? contactsPayload([]) : prospectsPayload(people);
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

/** Records the writes so a test can assert how many actually happened. */
function makeSupabase(writes: { inserted: number; updated: number }) {
  const leadTable = () => ({
    insert: (rows: unknown) => {
      writes.inserted += Array.isArray(rows) ? rows.length : 1;
      return Promise.resolve({ error: null });
    },
    update: () => ({
      eq: () => {
        writes.updated += 1;
        return Promise.resolve({ error: null });
      },
    }),
    select: () => {
      const result = { data: [] as unknown[], error: null };
      const chain = {
        order: () => chain,
        range: () => Promise.resolve(result),
      };
      return chain;
    },
  });

  return {
    rpc: async (name: string) =>
      name === "current_org_id" ? { data: "org-1", error: null } : { data: null, error: null },
    from: (table: string) => {
      if (table === "crm_stage") {
        return {
          select: () => ({
            order: () => Promise.resolve({ data: stages.map((x) => ({ id: x.id, name: x.name })), error: null }),
          }),
        };
      }
      return leadTable();
    },
  };
}

async function loadApply(prospectCount: number, writes: { inserted: number; updated: number }) {
  vi.stubGlobal("fetch", stubFetch(prospectCount));
  // lectual.app: the client comes from the firm's own connection (0059), not
  // an env token. Built for real here, so pull and normalize still run.
  vi.doMock("@/lib/lawmatics/connection", async () => {
    const { createLawmaticsClient } = await import("@/lib/lawmatics/client");
    return { firmLawmaticsClient: async () => createLawmaticsClient({ token: "test-token" }) };
  });
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: async () => makeSupabase(writes),
  }));
  return import("@/lib/lawmatics/import");
}

describe("applyImport — time budget", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // loadApply() stubs global fetch and nothing put it back, so the stub
  // outlived this file: the shared afterAll teardown in tests/setup.ts then
  // built a Supabase client on a fetch that only answers Lawmatics URLs, and
  // wipe() died with "Cannot read properties of undefined (reading 'get')".
  // The three tests here passed the whole time — the FILE was failing on the
  // way out, which reads as "this suite is broken" rather than "this suite
  // littered".
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("stops on an exhausted budget and says so, instead of running to a kill", async () => {
    const writes = { inserted: 0, updated: 0 };
    const { applyImport, previewImport } = await loadApply(120, writes);

    const preview = await previewImport();
    // Budget 0 → out of time before the first chunk.
    const report = await applyImport(preview.plan.fingerprint, undefined, 0);

    expect(report.partial).toBe(true);
    expect(writes.inserted).toBe(0);
    // The work it did not reach is NAMED, not left to be inferred from a
    // count that looks like a total.
    expect(report.remaining.creates).toBeGreaterThan(0);
  });

  it("reports partial=false and no remainder when it finishes inside the budget", async () => {
    const writes = { inserted: 0, updated: 0 };
    const { applyImport, previewImport } = await loadApply(3, writes);

    const preview = await previewImport();
    const report = await applyImport(preview.plan.fingerprint, undefined, 60_000);

    expect(report.partial).toBe(false);
    expect(report.remaining).toEqual({ creates: 0, updates: 0 });
    expect(report.created).toBe(3);
    expect(writes.inserted).toBe(3);
  });

  it("counts only what it actually wrote — a partial report never overstates", async () => {
    const writes = { inserted: 0, updated: 0 };
    const { applyImport, previewImport } = await loadApply(10, writes);

    const preview = await previewImport();
    const report = await applyImport(preview.plan.fingerprint, undefined, 0);

    // Whatever `created` says, the database saw exactly that many rows.
    expect(report.created).toBe(writes.inserted);
    expect(report.created + report.remaining.creates).toBe(10);
  });
});
