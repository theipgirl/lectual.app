import { describe, it, expect } from "vitest";

import {
  LawmaticsApiError,
  createLawmaticsClient,
  type FetchLike,
} from "@/lib/lawmatics/client";

import { prospectsPayload, type FixtureProspect } from "../__fixtures__/lawmatics.fixture";

/** A fake fetch that records every URL and answers from a scripted queue. */
function fakeFetch(
  handler: (url: URL) => { status?: number; body?: unknown; text?: string },
): { fetch: FetchLike; urls: URL[] } {
  const urls: URL[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input);
    urls.push(url);
    const res = handler(url);
    const status = res.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      text: async () => res.text ?? JSON.stringify(res.body ?? {}),
      json: async () => res.body ?? {},
    };
  };
  return { fetch: fetchImpl, urls };
}

function client(fetchImpl: FetchLike) {
  return createLawmaticsClient({
    token: "test-token",
    baseUrl: "https://api.example.test/v1",
    fetchImpl,
  });
}

function people(prefix: string, count: number, offset = 0): FixtureProspect[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${offset + i}`,
    matterName: `Fixture Matter ${offset + i}`,
    firstName: "Fixture",
    lastName: `Person${offset + i}`,
    email: `person${offset + i}@example.test`,
    stage: "Application Filed",
  }));
}

describe("Lawmatics read client", () => {
  it("sends the Bearer token and asks for JSON", async () => {
    let seenAuth: string | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      seenAuth = init?.headers?.Authorization;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "{}",
        json: async () => prospectsPayload([]),
      };
    };
    await client(fetchImpl).listAll("/prospects");
    expect(seenAuth).toBe("Bearer test-token");
  });

  it("paginates with the BRACKET params — flat page/per_page are ignored by Lawmatics", async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: prospectsPayload(people("p", 1)) }));
    await client(fetch).listAll("/prospects", { pageSize: 25 });

    const url = urls[0];
    expect(url.searchParams.get("page[number]")).toBe("1");
    expect(url.searchParams.get("page[size]")).toBe("25");
    // The flat form must not be sent — it is silently ignored upstream and
    // would make a truncated pull look like a complete one.
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("per_page")).toBeNull();
  });

  it("requests the sideloads the importer depends on", async () => {
    const { fetch, urls } = fakeFetch(() => ({ body: prospectsPayload([]) }));
    await client(fetch).listAll("/prospects", { include: "stage,practice_area,contact" });
    expect(urls[0].searchParams.get("include")).toBe("stage,practice_area,contact");
  });

  it("walks every page reported by meta.total_pages and merges the records", async () => {
    const { fetch, urls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page[number]"));
      return {
        body: prospectsPayload(people("p", 2, (page - 1) * 2), { totalPages: 3 }),
      };
    });
    const result = await client(fetch).listAll("/prospects", { pageSize: 2 });
    expect(urls).toHaveLength(3);
    expect(result.records).toHaveLength(6);
    expect(result.pagesFetched).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("stops on a short page when the server reports no page count", async () => {
    const { fetch, urls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page[number]"));
      const rows = page === 1 ? people("p", 5) : people("p", 2, 5);
      return { body: { data: prospectsPayload(rows).data } }; // no meta
    });
    const result = await client(fetch).listAll("/prospects", { pageSize: 5 });
    expect(urls).toHaveLength(2);
    expect(result.records).toHaveLength(7);
  });

  it("merges the `included` sideloads across pages", async () => {
    const { fetch } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page[number]"));
      return {
        body: prospectsPayload(
          [
            {
              id: `p-${page}`,
              matterName: `Matter ${page}`,
              stage: page === 1 ? "Application Filed" : "Opinion Letter Sent",
            },
          ],
          { totalPages: 2 },
        ),
      };
    });
    const result = await client(fetch).listAll("/prospects", { pageSize: 1 });
    expect(result.included.size).toBe(2);
  });

  it("stops (and flags truncation) when the server ignores pagination entirely", async () => {
    // The failure mode that motivated the bracket params: a server that hands
    // back page 1 forever. Without the repeat guard this loops to the cap.
    const { fetch, urls } = fakeFetch(() => ({
      body: { data: prospectsPayload(people("p", 3)).data },
    }));
    const result = await client(fetch).listAll("/prospects", { pageSize: 3, maxPages: 25 });
    expect(urls.length).toBe(2);
    expect(result.records).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toMatch(/ignore/i);
  });

  it("caps the number of records and says so", async () => {
    const { fetch } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page[number]"));
      return { body: prospectsPayload(people("p", 10, (page - 1) * 10), { totalPages: 99 }) };
    });
    const result = await client(fetch).listAll("/prospects", {
      pageSize: 10,
      maxRecords: 25,
    });
    expect(result.records).toHaveLength(25);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toMatch(/safety cap/i);
  });

  it("de-duplicates records that appear on more than one page", async () => {
    const { fetch } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page[number]"));
      const rows = page === 1 ? people("p", 2) : [...people("p", 1, 1), ...people("p", 1, 2)];
      return { body: prospectsPayload(rows, { totalPages: 2 }) };
    });
    const result = await client(fetch).listAll("/prospects", { pageSize: 2 });
    expect(result.records.map((r) => r.id)).toEqual(["p-0", "p-1", "p-2"]);
  });

  it("retries without `include` when the server rejects the include path", async () => {
    const { fetch, urls } = fakeFetch((url) =>
      url.searchParams.has("include")
        ? { status: 422, text: "unknown include" }
        : { body: prospectsPayload(people("p", 1)) },
    );
    const result = await client(fetch).listAll("/prospects", { include: "stage" });
    expect(urls).toHaveLength(2);
    expect(result.records).toHaveLength(1);
  });

  it("propagates a real outage instead of retrying it into a misleading success", async () => {
    const { fetch } = fakeFetch(() => ({ status: 503, text: "upstream down" }));
    await expect(client(fetch).listAll("/prospects", { include: "stage" })).rejects.toBeInstanceOf(
      LawmaticsApiError,
    );
  });

  it("surfaces an auth failure with its status", async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, text: "bad token" }));
    await expect(client(fetch).get("/prospects")).rejects.toMatchObject({ status: 401 });
  });

  it("refuses to be constructed without a token", () => {
    expect(() => createLawmaticsClient({ token: "" })).toThrow(/token/i);
  });

  it("exposes no write methods — the importer is one-way by construction", () => {
    const c = client(fakeFetch(() => ({ body: {} })).fetch);
    expect(Object.keys(c).sort()).toEqual(["get", "listAll"]);
  });
});
