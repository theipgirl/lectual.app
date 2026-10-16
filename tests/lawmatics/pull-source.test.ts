import { describe, it, expect } from "vitest";

import { pullSource } from "@/lib/lawmatics/import";
import type { LawmaticsClient, ListResult } from "@/lib/lawmatics/client";
import { includedIndex, records, type Raw } from "@/lib/lawmatics/jsonapi";

import { contactsPayload, prospectsPayload } from "../__fixtures__/lawmatics.fixture";

/**
 * A stand-in for the read client that answers from fixture payloads. The real
 * client's paging is covered in client.test.ts; this exercises the layer above
 * it — prospects merged with contacts into sanitized source records.
 */
function stubClient(byPath: Record<string, unknown | (() => never)>): LawmaticsClient {
  return {
    get: async () => ({}),
    listAll: async (path: string): Promise<ListResult> => {
      const entry = byPath[path];
      if (typeof entry === "function") entry();
      const payload = entry as Raw;
      return {
        records: records(payload),
        included: includedIndex(payload),
        pagesFetched: 1,
        truncated: false,
        includeDropped: false,
      };
    },
  };
}

describe("pullSource", () => {
  it("reads prospects from /prospects — there is no /matters endpoint", async () => {
    const paths: string[] = [];
    const client: LawmaticsClient = {
      get: async () => ({}),
      listAll: async (path) => {
        paths.push(path);
        return { records: [], included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false };
      },
    };
    await pullSource(client);
    expect(paths).toContain("/prospects");
    expect(paths).not.toContain("/matters");
  });

  it("merges a separately-fetched contact into the prospect that references it", async () => {
    const client = stubClient({
      "/prospects": prospectsPayload([
        {
          id: "4207",
          matterName: "Verdant Bloom Botanicals — VERDANT BLOOM",
          firstName: "Marisol",
          lastName: "Vega",
          stage: "Application Filed",
          contactId: "c-88",
        },
      ]),
      "/contacts": contactsPayload([
        {
          id: "c-88",
          email: "marisol@verdantbloom.co",
          phone: "+1 (305) 555-0134",
          company: "Verdant Bloom Botanicals",
        },
      ]),
    });

    const pull = await pullSource(client);
    expect(pull.records).toHaveLength(1);
    expect(pull.records[0]).toMatchObject({
      lawmaticsId: "4207",
      email: "marisol@verdantbloom.co",
      businessName: "Verdant Bloom Botanicals",
      stageName: "Application Filed",
    });
    expect(pull.contactCount).toBe(1);
  });

  it("does not import contacts that belong to no prospect", async () => {
    const client = stubClient({
      "/prospects": prospectsPayload([]),
      "/contacts": contactsPayload([
        { id: "c-1", firstName: "Opposing", lastName: "Counsel", email: "oc@example.test" },
      ]),
    });
    const pull = await pullSource(client);
    expect(pull.records).toHaveLength(0);
    expect(pull.contactCount).toBe(1);
  });

  it("still imports what the prospects carry when /contacts fails, and flags it", async () => {
    const client = stubClient({
      "/prospects": prospectsPayload([
        {
          id: "4207",
          matterName: "Halloran Studio — HALLORAN",
          firstName: "Theo",
          lastName: "Halloran",
          email: "theo@halloran.studio",
          stage: "Application Filed",
        },
      ]),
      "/contacts": () => {
        throw new Error("contacts endpoint unavailable");
      },
    });

    const pull = await pullSource(client);
    expect(pull.records).toHaveLength(1);
    expect(pull.records[0].email).toBe("theo@halloran.studio");
    // A missing email must never read as "the client has none" when the reason
    // is that we couldn't fetch it.
    expect(pull.truncated).toBe(true);
    expect(pull.truncatedReason).toMatch(/contact details/i);
  });
});
