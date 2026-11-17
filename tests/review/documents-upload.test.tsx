import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/dashboard/files/actions", () => ({ requestUploadAction: vi.fn(), confirmUploadAction: vi.fn() }));

import { ReviewDocuments } from "../../src/components/review/ReviewDocuments";
import { UploadView } from "../../src/components/files/UploadView";
import { FILE_UPLOAD_ROLES } from "../../src/lib/files/roles";
import { FILE_MESSAGES } from "../../src/lib/files/rules";
import { MATTER_WRITE_ROLES } from "../../src/lib/matters/matters";
import { LEAD, MATTER } from "../files/helpers";
import { TODAY } from "./fixtures";

const ok = { status: "ok" as const };
const empty = { files: { ...ok, capped: false, files: [] }, letters: null };
const render = (over: Record<string, unknown> = {}, kind: "lead" | "matter" = "lead") =>
  renderToStaticMarkup(
    <ReviewDocuments open={{ kind, id: kind === "lead" ? LEAD : MATTER }} documents={empty as never} members={[]} today={TODAY} timeZone="America/New_York" canWrite canUpload {...over} />,
  );

describe("upload in the review panel", () => {
  it("is drawn for staff who may upload, on a lead and a matter", () => {
    expect(render()).toContain('type="file"');
    expect(render({}, "matter")).toContain('id="rv-file-input"');
  });

  it("is not drawn at all without upload rights (viewer, social_media)", () => {
    expect(render({ canWrite: false, canUpload: false })).not.toContain('type="file"');
    expect(render({ canUpload: undefined })).not.toContain('type="file"');
  });

  it("the panel's gate is the card's list: canWrite is the same eight roles as FILE_UPLOAD_ROLES", () => {
    expect([...MATTER_WRITE_ROLES].sort()).toEqual([...FILE_UPLOAD_ROLES].sort());
    for (const r of ["viewer", "social_media"]) expect(FILE_UPLOAD_ROLES).not.toContain(r);
    expect(readFileSync("src/components/review/ReviewPanel.tsx", "utf8")).toContain("canUpload={canWrite}");
  });

  it("a files table that isn't set up shows its sentence and no control", () => {
    const html = render({ documents: { files: { status: "not-set-up" }, letters: null } });
    expect(html).toContain(FILE_MESSAGES.notSetUp.replace("'", "&#x27;"));
    expect(html).not.toContain('type="file"');
  });

  it("a failed read keeps the control, as the card does, and says so", () => {
    const html = render({ documents: { files: { status: "unavailable" }, letters: null } });
    expect(html).toContain('type="file"');
    expect(html).toContain("couldn&#x27;t");
  });

  it("a refusal shows its fixed sentence", () => {
    const html = renderToStaticMarkup(<UploadView busy={false} error={FILE_MESSAGES.cantUpload} inputId="rv-file-input" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(FILE_MESSAGES.cantUpload.replace("'", "&#x27;"));
  });

  it("uses the existing actions and no second path", () => {
    const ctl = readFileSync("src/components/files/UploadControl.tsx", "utf8");
    expect(ctl).toContain("requestUploadAction");
    expect(ctl).toContain("confirmUploadAction");
    const wrap = readFileSync("src/components/review/ReviewUpload.tsx", "utf8");
    expect(wrap).toContain("UploadControl");
    expect(wrap).toContain("router.refresh()");
    expect(wrap).not.toMatch(/Action\b|fetch\(|storage/);
    expect(readFileSync("src/app/dashboard/review/actions.ts", "utf8")).not.toMatch(/requestUpload|confirmUpload/);
  });
});

describe("the panel follows a merged lead to its keeper", () => {
  it("opened with a merged id it loads the keeper's record and documents", async () => {
    vi.resetModules();
    const { makeWorld, seedTables, fileRow, ORG } = await import("../files/helpers");
    const merged = "77777777-7777-4777-8777-777777777777";
    const world = makeWorld({
      tables: seedTables({
        crm_lead: [
          { id: LEAD, org_id: ORG, first_name: "K", last_name: "Keeper", merged_into_id: null },
          { id: merged, org_id: ORG, first_name: "M", last_name: "Merged", merged_into_id: LEAD },
        ],
        crm_file: [fileRow({ id: "own" })],
      }),
    });
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false), activeOrgModulesOrNull: vi.fn(async () => []) }));
    vi.doMock("@/lib/matters/stages", () => ({ listMatterStages: vi.fn(async () => []) }));
    vi.doMock("@/lib/pipeline/stages", () => ({ listStages: vi.fn(async () => []) }));
    const { loadReviewDetail } = await import("../../src/lib/review/detail-load");
    const d = await loadReviewDetail({ kind: "lead", id: merged });
    expect(d.status).toBe("ok");
    expect(d.status === "ok" && d.openId).toBe(LEAD);
    expect(d.status === "ok" && d.documents.files.status === "ok" && d.documents.files.files.map((f) => f.id)).toEqual(["own"]);
    world.db.fail("crm_lead", "select");
    expect((await loadReviewDetail({ kind: "lead", id: merged })).status).toBe("unavailable");
  });
});
