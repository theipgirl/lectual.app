import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM, CSV_MAX_ROWS, buildCsv, csvCell, csvLine } from "@/lib/intake-forms/csv";
import type { FakeDb } from "../matters/helpers/fake-db";
import {
  ASSESSMENT_FORM_ID,
  BUSINESS_ANSWERS,
  FOREIGN_FORM_ID,
  FORM_ID,
  OTHER_ORG,
  QUESTIONS,
  assessmentAnswers,
  assessmentFormRow,
  daysAgo,
  formRow,
  newDb,
  submissionRow,
  mockScopedDb,
} from "./helpers/forms-db";

/** Sprint 9 F13 (access), F14 (content), D3 (assessment story) and D5 (range) for the CSV, with a small CSV parser of our own. */

/** RFC 4180 reader: quotes, doubled quotes, commas and line breaks inside quotes. Strips a BOM. */
function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const NOW = new Date("2026-10-21T12:00:00Z");

async function get(db: FakeDb, query: string, opts: Parameters<typeof mockScopedDb>[1] = {}) {
  vi.resetModules();
  mockScopedDb(db, opts);
  const { GET } = await import("../../src/app/dashboard/forms/export/route");
  return GET(new Request(`https://app.example.test/dashboard/forms/export/?${query}`));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/db/scoped-client");
});

describe("CSV encoding", () => {
  it("quotes fields with commas, quotes and line breaks and gives the original back", () => {
    const tricky = ['plain', 'a, b', 'say "hi"', 'line one\nline two', 'crlf\r\nbreak', 'all, of "them"\nat once'];
    const parsed = parseCsv(csvLine(tricky) + "\r\n");
    expect(parsed).toEqual([tricky]);
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("plain")).toBe("plain");
  });

  it("neutralises a cell that would be read as a formula", () => {
    for (const bad of ["=SUM(A1)", "+1", "-1+2", "@cmd", "\tx", "\rx"]) {
      expect(csvCell(bad).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(parseCsv(csvLine(["=HYPERLINK(\"http://x\",\"y\")"]))[0][0]).toBe("'=HYPERLINK(\"http://x\",\"y\")");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("")).toBe("");
  });

  it("builds the header, one row per person, blanks for the unfinished, and removed-question columns last", () => {
    const rows = [
      {
        contact: { name: "Ada, Lovelace", email: "ada@example.com" },
        answers: [
          { id: "q-name", question: "What name do you want to protect?", answer: 'SANKOFA, "the" brand\nsecond line' },
          { id: "q-old", question: "Removed question", answer: "legacy" },
        ],
        started_at: "2026-10-18T15:00:00Z",
        submitted_at: "2026-10-18T15:03:00Z",
      },
      { contact: { name: "Bo", email: "bo@example.com" }, answers: [], started_at: "2026-10-18T16:00:00Z", submitted_at: null },
      {
        contact: { name: "Cy", email: "cy@example.com" },
        answers: [{ id: null, question: "Another removed", answer: "=1+1" }],
        started_at: "2026-10-18T17:00:00Z",
        submitted_at: "2026-10-18T17:02:00Z",
      },
    ];
    const csv = buildCsv(rows, QUESTIONS);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const table = parseCsv(csv);
    expect(table[0]).toEqual(["Name", "Email", "Started", "Finished", "What name do you want to protect?", "Have you used it publicly?", "Removed question", "Another removed"]);
    expect(table).toHaveLength(4);
    expect(table[1]).toEqual(["Ada, Lovelace", "ada@example.com", "2026-10-18T15:00:00Z", "2026-10-18T15:03:00Z", 'SANKOFA, "the" brand\nsecond line', "", "legacy", ""]);
    expect(table[2]).toEqual(["Bo", "bo@example.com", "2026-10-18T16:00:00Z", "", "", "", "", ""]);
    expect(table[3][7]).toBe("'=1+1");
  });

  it("does not take answers from a person who didn't finish", () => {
    const csv = buildCsv(
      [{ contact: { name: "Bo" }, answers: [{ id: "q-name", question: "q", answer: "leaked" }], started_at: "2026-10-18T16:00:00Z", submitted_at: null }],
      QUESTIONS,
    );
    expect(csv).not.toContain("leaked");
  });
});

describe("CSV route, access (F13)", () => {
  const people = () => [submissionRow("a", { answers: [{ id: "q-name", question: "q", answer: "SANKOFA" }] })];

  it("returns 401 with no session and never asks for submissions", async () => {
    const db = newDb({ crm_intake_submission: people() });
    const res = await get(db, `form=${FORM_ID}`, { signedIn: false });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Sign in to export.");
    expect(db.froms).not.toContain("crm_intake_submission");
    expect(db.froms).not.toContain("crm_intake_form");
  });

  it.each(["viewer", "social_media"])("returns 403 for %s and never asks for submissions", async (role) => {
    const db = newDb({ crm_intake_submission: people() }, role);
    const res = await get(db, `form=${FORM_ID}`);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toContain("csv");
    expect(db.froms).not.toContain("crm_intake_submission");
  });

  it("returns 403 when the role can't be established (fails closed)", async () => {
    const noRole = newDb({ crm_intake_submission: people() });
    noRole.role = null;
    expect((await get(noRole, `form=${FORM_ID}`)).status).toBe(403);
    const odd = newDb({ crm_intake_submission: people() }, "janitor");
    expect((await get(odd, `form=${FORM_ID}`)).status).toBe(403);
    expect(odd.froms).not.toContain("crm_intake_submission");
  });

  it.each(["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"])("lets %s export", async (role) => {
    const res = await get(newDb({ crm_intake_submission: people() }, role), `form=${FORM_ID}`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for a form id the scoped client can't see, or a malformed one", async () => {
    const db = newDb({
      crm_intake_form: [formRow(), formRow({ id: FOREIGN_FORM_ID, org_id: OTHER_ORG })],
      crm_intake_submission: [submissionRow("x", { org_id: OTHER_ORG, form_id: FOREIGN_FORM_ID })],
    });
    const foreign = await get(db, `form=${FOREIGN_FORM_ID}`);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("Person");
    expect(db.froms).not.toContain("crm_intake_submission");
    expect((await get(db, "form=not-a-uuid")).status).toBe(404);
    expect((await get(db, "")).status).toBe(404);
  });

  it("returns an error status and no CSV body when the read fails, without leaking the database message", async () => {
    const db = newDb({ crm_intake_submission: people() });
    db.fail("crm_intake_submission", "select");
    const res = await get(db, `form=${FORM_ID}`);
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("Name,Email");
    expect(body).not.toContain("boom");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("returns 503 when the table isn't in this environment", async () => {
    const db = newDb({ crm_intake_submission: people() });
    db.fail("crm_intake_submission", "select", { code: "PGRST205", message: "no table" });
    const res = await get(db, `form=${FORM_ID}`);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("Name,Email");
  });

  it("returns 413 past 50,000 people, reading no rows", async () => {
    const db = newDb({ crm_intake_submission: people() });
    const res = await get(db, `form=${FORM_ID}`, {
      wrap: (client) => ({
        ...client,
        from: (table: string) => {
          if (table !== "crm_intake_submission") return client.from(table);
          const chain: Record<string, unknown> = {
            select: (_cols: string, o?: { head?: boolean }) => {
              if (!o?.head) throw new Error("rows must not be read past the limit");
              return chain;
            },
            eq: () => chain,
            gte: () => chain,
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: CSV_MAX_ROWS + 1 }).then(ok),
          };
          return chain;
        },
      }),
    });
    expect(res.status).toBe(413);
    expect(await res.text()).toContain("too many for one file");
  });
});

describe("CSV route, content (F14, D3)", () => {
  it("sets the type, BOM, no-store and an attachment filename from the link name and range", async () => {
    const res = await get(newDb({ crm_intake_submission: [submissionRow("a")] }), `form=${FORM_ID}&range=7`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ugw-2026-last-7-days.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes the form's questions in order, one row per person, escaped, with unfinished people blank", async () => {
    const db = newDb({
      crm_intake_submission: [
        submissionRow("a", {
          contact: { name: "Ada, \"Countess\" Lovelace", email: "ada@example.com" },
          answers: [
            { id: "q-use", question: "Have you used it publicly?", answer: "Yes,\nsince 2020" },
            { id: "q-name", question: "What name do you want to protect?", answer: "=SANKOFA" },
          ],
        }),
        submissionRow("b", { started_at: "2026-10-18T16:00:00Z", submitted_at: null, answers: [] }),
        submissionRow("c", {
          started_at: "2026-10-18T14:00:00Z",
          answers: [{ id: "q-removed", question: "A question since removed", answer: "legacy" }],
        }),
      ],
    });
    const res = await get(db, `form=${FORM_ID}&range=90`);
    const table = parseCsv(await res.text());
    expect(table[0]).toEqual(["Name", "Email", "Started", "Finished", "What name do you want to protect?", "Have you used it publicly?", "A question since removed"]);
    expect(table).toHaveLength(4);
    // Newest started first.
    expect(table.map((r) => r[0])).toEqual(["Name", "Person b", 'Ada, "Countess" Lovelace', "Person c"]);
    const ada = table.find((r) => r[1] === "ada@example.com")!;
    expect(ada[4]).toBe("'=SANKOFA");
    expect(ada[5]).toBe("Yes,\nsince 2020");
    const bo = table.find((r) => r[1] === "b@example.com")!;
    expect(bo.slice(3)).toEqual(["", "", "", ""]);
    expect(table.find((r) => r[1] === "c@example.com")![6]).toBe("legacy");
  });

  it("names only the columns it needs, and never writes", async () => {
    const db = newDb({ crm_intake_submission: [submissionRow("a")] });
    await get(db, `form=${FORM_ID}`);
    const submissionSelects = db.selects.filter(([t]) => t === "crm_intake_submission").map(([, c]) => c);
    expect(submissionSelects).toContain("id");
    expect(submissionSelects).toContain("contact, answers, started_at, submitted_at");
    for (const c of submissionSelects) {
      expect(c).not.toContain("*");
      expect(c).not.toMatch(/resume_hash|lawmatics|screening_note|source_host/);
    }
    expect(db.writes).toEqual([]);
  });

  it("D3: five finished assessments give five rows with the answer labels in the question columns", async () => {
    const variants = [
      { ...BUSINESS_ANSWERS, "1": "business" },
      { ...BUSINESS_ANSWERS, "1": "brand", "2": "yes" },
      { ...BUSINESS_ANSWERS, "1": "both", "5": "registered", "6": "documented", "7": "all" },
      { ...BUSINESS_ANSWERS, "4": "under_150k", "8": "3_plus_months" },
      { ...BUSINESS_ANSWERS, "5": "unsure" },
    ];
    const subs = variants.map((v, i) => {
      const a = assessmentAnswers(v);
      return submissionRow(`p${i}`, {
        form_id: ASSESSMENT_FORM_ID,
        mode: "assessment",
        answers: a.answerList,
        score: a.score.score,
        band: a.score.band,
        temperature: a.score.temperature,
        started_at: daysAgo(NOW, 2, i),
        submitted_at: daysAgo(NOW, 2, i + 3),
      });
    });
    const db = newDb({ crm_intake_form: [formRow(), assessmentFormRow()], crm_intake_submission: subs });
    const res = await get(db, `form=${ASSESSMENT_FORM_ID}&range=30`);
    expect(res.headers.get("content-disposition")).toContain("booth-assessment-last-30-days.csv");
    const table = parseCsv(await res.text());
    expect(table).toHaveLength(6);
    expect(table[0].slice(0, 5)).toEqual(["Name", "Email", "Started", "Finished", "Do you have a business, a personal brand, or both?"]);
    expect(table[0]).toHaveLength(4 + 8);
    const labels = table.slice(1).map((r) => r[4]);
    expect(labels.sort()).toEqual(["A business", "A business", "A business", "A personal brand", "Both"].sort());
    const reg = table.slice(1).find((r) => r[8] === "Yes, registered");
    expect(reg?.[9]).toBe("Yes, it is all documented");
  });
});

describe("range behaviour on the CSV (D5)", () => {
  it("limits rows to 7, 30 and 90 days against the fixed clock", async () => {
    const db = newDb({
      crm_intake_submission: [
        submissionRow("d3", { started_at: daysAgo(NOW, 3), submitted_at: daysAgo(NOW, 3, 4) }),
        submissionRow("d20", { started_at: daysAgo(NOW, 20), submitted_at: daysAgo(NOW, 20, 4) }),
        submissionRow("d60", { started_at: daysAgo(NOW, 60), submitted_at: daysAgo(NOW, 60, 4) }),
        submissionRow("d200", { started_at: daysAgo(NOW, 200), submitted_at: daysAgo(NOW, 200, 4) }),
      ],
    });
    const counts: Record<string, number> = {};
    for (const range of ["7", "30", "90"]) {
      counts[range] = parseCsv(await (await get(db, `form=${FORM_ID}&range=${range}`)).text()).length - 1;
    }
    expect(counts).toEqual({ "7": 1, "30": 2, "90": 3 });
    // An unknown range falls back to the default of 30.
    expect(parseCsv(await (await get(db, `form=${FORM_ID}&range=365`)).text()).length - 1).toBe(2);
  });

  it("pages through more than one page of rows until complete", async () => {
    const many = Array.from({ length: 2300 }, (_, i) => submissionRow(`m${i}`, { started_at: daysAgo(NOW, 1, -i), submitted_at: daysAgo(NOW, 1, -i + 2) }));
    const res = await get(newDb({ crm_intake_submission: many }), `form=${FORM_ID}&range=7`);
    expect(parseCsv(await res.text()).length - 1).toBe(2300);
  });
});
