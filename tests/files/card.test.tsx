import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentsRead } from "../../src/lib/files/read";

/**
 * The card for each state and role, rendered with `renderToStaticMarkup`. The two client
 * pieces (upload, delete) are the real components: they render their idle state on the server.
 */

const NOW = Date.parse("2026-10-21T12:00:00Z");
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

async function load() {
  vi.resetModules();
  vi.doMock("@/app/dashboard/files/actions", () => ({ requestUploadAction: vi.fn(), confirmUploadAction: vi.fn(), deleteFileAction: vi.fn() }));
  const card = await import("../../src/components/files/DocumentsCard");
  const upload = await import("../../src/components/files/UploadView");
  const del = await import("../../src/components/files/DeleteFileButton");
  return { ...card, ...upload, ...del };
}

const file = (id: string, name: string, at: string, size = 86_016, by: string | null = "u1") => ({ id, file_name: name, mime: "application/pdf", size_bytes: size, uploaded_by: by, created_at: at });
const okFiles = (files: ReturnType<typeof file>[], capped = false): DocumentsRead["files"] => ({ status: "ok", files, capped });
const DIR = [{ userId: "u1", name: "Dawn Reyes" }];
const parent = { kind: "lead" as const, id: "11111111-1111-4111-8111-111111111111" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function render(read: DocumentsRead, over: { canUpload?: boolean; canDelete?: boolean; directory?: typeof DIR | null; parent?: typeof parent | { kind: "matter"; id: string } } = {}) {
  const { DocumentsCard } = await load();
  return text(
    renderToStaticMarkup(
      <DocumentsCard parent={over.parent ?? parent} read={read} directory={over.directory === undefined ? DIR : over.directory} canUpload={over.canUpload ?? true} canDelete={over.canDelete ?? false} now={NOW} />,
    ),
  );
}

describe("the list state", () => {
  it("shows name, size, who and when, newest first, with a Download link to the files route", async () => {
    const html = await render({
      files: okFiles([file("f-new", "Specimen.png", "2026-10-21T10:00:00Z", 2_411_724), file("f-old", "Signed LOE.pdf", "2026-10-18T10:00:00Z")]),
      letters: null,
    });
    expect(html).toContain('aria-label="Documents & files"');
    expect(html).toContain(">Documents & files<");
    expect(html).toContain("<b");
    expect(html).toContain("Specimen.png");
    expect(html).toContain("2.3 MB · Dawn Reyes · 2 h ago");
    expect(html).toContain("84 KB · Dawn Reyes · 3 days ago");
    expect(html.indexOf("Specimen.png")).toBeLessThan(html.indexOf("Signed LOE.pdf"));
    expect(html).toContain('href="/dashboard/files/f-new/download/"');
    expect(html).toContain('href="/dashboard/files/f-old/download/"');
    expect(html).not.toContain("Nothing here yet");
    expect(html).not.toContain("Generated letter");
  });

  it("marks a letter, links the existing documents route, and shows no size for it", async () => {
    const html = await render(
      {
        files: okFiles([file("f1", "Signed LOE.pdf", "2026-10-18T10:00:00Z")]),
        letters: { status: "ok", capped: false, letters: [{ id: "l1", doc_type: "opinion_letter", file_name: "Opinion.docx", created_by: "u1", generated_at: "2026-10-20T10:00:00Z", created_at: "2026-10-19T10:00:00Z" }] },
      },
      { parent: { kind: "matter", id: "22222222-2222-4222-8222-222222222222" } },
    );
    expect(html).toContain("Generated letter");
    expect(html).toContain('href="/dashboard/documents/l1/download/"');
    expect(html).toContain("Opinion letter · Dawn Reyes · 1 day ago");
    expect(html.indexOf("Opinion.docx")).toBeLessThan(html.indexOf("Signed LOE.pdf"));
    expect(html).not.toMatch(/Opinion letter · \d+ KB/);
  });

  it("says who it was when the directory failed or the user is gone, and still renders", async () => {
    const read = { files: okFiles([file("f1", "a.pdf", "2026-10-20T10:00:00Z", 100, "gone"), file("f2", "b.pdf", "2026-10-19T10:00:00Z", 100, null)]), letters: null };
    for (const directory of [null, DIR]) {
      const html = await render(read, { directory });
      expect(html.match(/A teammate/g)).toHaveLength(2);
      expect(html).toContain("a.pdf");
    }
  });

  it("states the cap when there are more than 100", async () => {
    const html = await render({ files: okFiles([file("f1", "a.pdf", "2026-10-20T10:00:00Z")], true), letters: null });
    expect(html).toContain("Showing the newest 100 files.");
  });
});

describe("the empty state", () => {
  it("says 'Nothing here yet' when every read worked and found nothing, with the upload control for staff", async () => {
    const html = await render({ files: okFiles([]), letters: null });
    expect(html).toContain("Nothing here yet");
    expect(html).toContain('type="file"');
    expect(html).not.toContain("Couldn't be loaded");
  });

  it("says it for a matter only when the letters read worked too", async () => {
    const html = await render({ files: okFiles([]), letters: { status: "ok", capped: false, letters: [] } });
    expect(html).toContain("Nothing here yet");
  });

  it("is never shown after a failed read", async () => {
    for (const read of [
      { files: { status: "unavailable" } as const, letters: null },
      { files: { status: "unavailable" } as const, letters: { status: "ok", capped: false, letters: [] } as const },
      { files: okFiles([]), letters: { status: "unavailable" } as const },
      { files: { status: "not-set-up" } as const, letters: null },
    ] satisfies DocumentsRead[]) {
      expect(await render(read)).not.toContain("Nothing here yet");
    }
  });
});

describe("the error state", () => {
  it("says the files could not be loaded and that this is a database problem, not an empty list", async () => {
    const html = await render({ files: { status: "unavailable" }, letters: null });
    expect(html).toContain("Files couldn't be loaded. Refresh to try again.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("isn't set up");
  });

  it("shows the letters beside the files error, and the files beside a letters error", async () => {
    const a = await render({
      files: { status: "unavailable" },
      letters: { status: "ok", capped: false, letters: [{ id: "l1", doc_type: "loe_general", file_name: "LOE.docx", created_by: null, generated_at: "2026-10-20T10:00:00Z", created_at: "2026-10-20T10:00:00Z" }] },
    }, { parent: { kind: "matter", id: "22222222-2222-4222-8222-222222222222" } });
    expect(a).toContain("Files couldn't be loaded");
    expect(a).toContain("LOE.docx");
    const b = await render({ files: okFiles([file("f1", "kept.pdf", "2026-10-20T10:00:00Z")]), letters: { status: "unavailable" } }, { parent: { kind: "matter", id: "22222222-2222-4222-8222-222222222222" } });
    expect(b).toContain("Generated letters couldn't be loaded. Refresh to try again.");
    expect(b).toContain("kept.pdf");
    expect(b).not.toContain("Files couldn't be loaded");
  });
});

describe("the not-set-up state", () => {
  it("says file storage is not set up yet, with no upload control and no error wording", async () => {
    const html = await render({ files: { status: "not-set-up" }, letters: null });
    expect(html).toContain("File storage isn't set up for this firm yet.");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("lx-banner");
    expect(html).not.toMatch(/couldn't be loaded|problem reaching/i);
    expect(html).not.toContain("Nothing here yet");
  });
});

describe("role-aware controls", () => {
  const read = { files: okFiles([file("f1", "a.pdf", "2026-10-20T10:00:00Z")]), letters: null };

  it("a staff role sees the upload control and no delete", async () => {
    const html = await render(read, { canUpload: true, canDelete: false });
    expect(html).toContain('type="file"');
    expect(html).toContain(">Download<");
    expect(html).not.toContain(">Delete<");
  });

  it("an admin tier sees upload and a Delete on files (not on letters)", async () => {
    const html = await render(
      { files: read.files, letters: { status: "ok", capped: false, letters: [{ id: "l1", doc_type: "loe_general", file_name: "L.docx", created_by: null, generated_at: "2026-10-21T00:00:00Z", created_at: "2026-10-21T00:00:00Z" }] } },
      { canUpload: true, canDelete: true, parent: { kind: "matter", id: "22222222-2222-4222-8222-222222222222" } },
    );
    expect(html.match(/>Delete</g)).toHaveLength(1);
    expect(html.indexOf(">Delete<")).toBeGreaterThan(html.indexOf("a.pdf"));
  });

  it("a viewer sees the list and Download links but no upload or delete control", async () => {
    const html = await render(read, { canUpload: false, canDelete: false });
    expect(html).toContain("a.pdf");
    expect(html).toContain('href="/dashboard/files/f1/download/"');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain("Add a file");
  });
});

describe("the upload control", () => {
  it("states the allowed types and the 25 MB limit in text, and the card says files are internal", async () => {
    const html = await render({ files: okFiles([]), letters: null });
    expect(html).toContain("Allowed: PDF, Word (DOCX, DOC), Excel (XLSX, XLS), CSV, PNG, JPG, HEIC, TXT, EML and MSG. Up to 25 MB each.");
    expect(html).toContain("Files are internal to the firm. Nothing here is shared with a client.");
    expect(html).toMatch(/accept="[^"]*\.msg[^"]*\.heic|accept="[^"]*\.heic[^"]*\.msg/);
  });

  it("renders its idle, busy and error states", async () => {
    const { UploadView } = await load();
    const idle = text(renderToStaticMarkup(<UploadView busy={false} error={null} />));
    expect(idle).not.toContain("Uploading");
    expect(idle).not.toContain('role="alert"');
    expect(idle).not.toContain("disabled");

    const busy = text(renderToStaticMarkup(<UploadView busy busyName="Signed LOE.pdf" error={null} />));
    expect(busy).toContain("Uploading Signed LOE.pdf…");
    expect(busy).toContain('role="status"');
    expect(busy).toContain("disabled");

    const failed = text(renderToStaticMarkup(<UploadView busy={false} error="That file is larger than 25 MB, the most that can be stored here." />));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("larger than 25 MB");
  });
});

describe("the delete control", () => {
  it("asks for confirmation naming the file before it deletes", async () => {
    const { DeleteFileButton } = await load();
    const closed = text(renderToStaticMarkup(<DeleteFileButton fileId="f1" name="Signed LOE.pdf" />));
    expect(closed).toContain(">Delete<");
    expect(closed).not.toContain("Yes, delete");
    const open = text(renderToStaticMarkup(<DeleteFileButton fileId="f1" name="Signed LOE.pdf" defaultOpen />));
    expect(open).toContain("Delete Signed LOE.pdf? The stored file is removed for good.");
    expect(open).toContain("Yes, delete");
    expect(open).toContain("Cancel");
  });
});

describe("the card's wording and style", () => {
  it("uses the app's lx classes, no placeholder text, no inline colours outside the tokens", async () => {
    const html = await render({ files: okFiles([file("f1", "a.pdf", "2026-10-20T10:00:00Z")]), letters: null }, { canDelete: true });
    expect(html).toMatch(/class="lx-card"/);
    expect(html).toMatch(/class="lx-label"/);
    expect(html).toMatch(/class="lx-h2"/);
    expect(html).not.toMatch(/todo|coming soon|lorem/i);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });
});
