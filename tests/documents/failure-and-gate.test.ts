import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCUMENT_LIST_LIMIT, FAILURE_REASONS, failureReason, listCutNotice } from "@/lib/documents/failure-reason";
import { RETRY_SENTENCES, runRetry, type RetryDeps } from "@/lib/documents/retry";

const page = readFileSync("src/app/dashboard/documents/page.tsx", "utf8");
const ID = "11111111-1111-4111-8111-111111111111";

describe("failure reasons (F12)", () => {
  it("maps stored text to a fixed sentence and never returns the stored text", () => {
    const secret = "ENOENT /srv/secrets/sk_live_ABC123 template missing";
    const out = failureReason(secret);
    expect(Object.values(FAILURE_REASONS)).toContain(out);
    expect(out).not.toContain("sk_live");
    for (const raw of ["boom sk_live_ABC123", "Error: upload failed for org-9", null, undefined, "", "docx render exploded sk_live_ABC123"]) {
      const r = failureReason(raw);
      expect(Object.values(FAILURE_REASONS)).toContain(r);
      expect(r).not.toContain("sk_live");
    }
    expect(failureReason(null)).toBe("This letter failed. Lectual has been told and is looking into it.");
    expect(failureReason("template not found")).toBe("The firm's template couldn't be read.");
  });

  it("the page uses the mapper and never prints error_message", () => {
    expect(page).toContain("failureReason(d.error_message)");
    expect(page.match(/error_message/g)?.length).toBe(3); // the row type, the select list and the mapper call
    expect(page).not.toMatch(/\{d\.error_message\}/);
  });
});

describe("the list is cut at 300 (F12)", () => {
  it("says so only when 300 rows came back", () => {
    expect(DOCUMENT_LIST_LIMIT).toBe(300);
    expect(listCutNotice(299)).toBeNull();
    expect(listCutNotice(300)).toContain("300");
    expect(page).toContain(".limit(DOCUMENT_LIST_LIMIT)");
  });
});

describe("the Document Center gate (F12)", () => {
  it("the page returns notFound() when the module is off or unreadable", () => {
    expect(page).toMatch(/if \(!\(await orgHasModule\("document-center"\)\.catch\(\(\) => false\)\)\) notFound\(\);/);
    expect(page.indexOf("notFound()")).toBeLessThan(page.indexOf("getScopedClient()"));
  });
  it("the page is notFound for a firm without the module", async () => {
    vi.resetModules();
    const notFound = vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    vi.doMock("next/navigation", () => ({ notFound }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
    const getScopedClient = vi.fn();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient }));
    vi.doMock("@/components/documents/RetryButton", () => ({ RetryButton: () => null }));
    const { default: Page } = await import("../../src/app/dashboard/documents/page");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getScopedClient).not.toHaveBeenCalled();
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => { throw new Error("modules unreadable"); }) }));
    vi.resetModules();
    const again = await import("../../src/app/dashboard/documents/page");
    await expect(again.default({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Retry (F12, P3)", () => {
  let status = "failed";
  const generate = vi.fn(async () => {});
  const deps = (over: Partial<RetryDeps> = {}): RetryDeps => ({
    gate: async () => null,
    loadDraft: async () => ({ status, queue_item_id: "q-1" }),
    orgKey: async () => "org-key",
    generate,
    revalidate: vi.fn(),
    ...over,
  });
  beforeEach(() => {
    status = "failed";
    generate.mockReset();
    generate.mockImplementation(async () => {});
  });

  it("re-runs the existing approved-document step for the same queue item and reports the result", async () => {
    generate.mockImplementation(async () => {
      status = "generated";
    });
    expect(await runRetry(deps(), ID)).toEqual({ notice: RETRY_SENTENCES.done });
    expect(generate).toHaveBeenCalledWith("org-key", "q-1");
  });

  it("says it still failed when the row is still failed afterwards", async () => {
    expect(await runRetry(deps(), ID)).toEqual({ error: RETRY_SENTENCES.stillFailed });
  });

  it("refuses without calling the step: gate, bad id, not visible, not failed, no approval, no queue", async () => {
    expect(await runRetry(deps({ gate: async () => RETRY_SENTENCES.notAllowed }), ID)).toEqual({ error: RETRY_SENTENCES.notAllowed });
    expect(await runRetry(deps(), "nope")).toEqual({ error: RETRY_SENTENCES.notFound });
    expect(await runRetry(deps({ loadDraft: async () => null }), ID)).toEqual({ error: RETRY_SENTENCES.notFound });
    expect(await runRetry(deps({ loadDraft: async () => { throw new Error("x"); } }), ID)).toEqual({ error: RETRY_SENTENCES.notFound });
    status = "generated";
    expect(await runRetry(deps(), ID)).toEqual({ error: RETRY_SENTENCES.notFailed });
    status = "failed";
    expect(await runRetry(deps({ loadDraft: async () => ({ status: "failed", queue_item_id: null }) }), ID)).toEqual({ error: RETRY_SENTENCES.noApproval });
    expect(await runRetry(deps({ orgKey: async () => null }), ID)).toEqual({ error: RETRY_SENTENCES.noQueue });
    expect(generate).not.toHaveBeenCalled();
  });

  it("is wired to the existing step, not a new send or generate path", () => {
    const action = readFileSync("src/app/dashboard/documents/actions.ts", "utf8");
    expect(action).toContain("generateApprovedDocument");
    expect(action).toContain("requireMatterWriteRole");
    expect(action).not.toMatch(/createDraft|sendMail|getAdminClient/);
  });
});
