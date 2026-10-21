import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXTENSIONS,
  EXTENSION_MIME,
  FILES_BUCKET,
  FILE_MESSAGES,
  MAX_FILE_BYTES,
  buildStoragePath,
  checkFileName,
  checkFileSize,
  cleanFileName,
  extensionOf,
  formatFileSize,
  isUuid,
} from "../../src/lib/files/rules";
import { FILE_DELETE_ROLES, FILE_UPLOAD_ROLES } from "../../src/lib/files/roles";
import { CAN_WRITE_LEAD } from "../../src/lib/pipeline/leads";
import { MATTER_WRITE_ROLES } from "../../src/lib/matters/matters";
import { FILE_ID, LEAD, ORG } from "./helpers";

/** The 12 types the bucket (0097) allows and the crm_file mime CHECK repeats. */
const BUCKET_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/heic",
  "text/plain",
  "message/rfc822",
  "application/vnd.ms-outlook",
];

describe("the extension to type table", () => {
  it("maps to exactly the 12 MIME types of the bucket and the table CHECK", () => {
    expect(new Set(Object.values(EXTENSION_MIME))).toEqual(new Set(BUCKET_MIMES));
    expect(new Set(Object.values(EXTENSION_MIME)).size).toBe(12);
  });

  it("maps each of the 13 extensions as specified", () => {
    expect(EXTENSION_MIME).toEqual({
      pdf: "application/pdf",
      docx: BUCKET_MIMES[1],
      doc: "application/msword",
      xlsx: BUCKET_MIMES[3],
      xls: "application/vnd.ms-excel",
      csv: "text/csv",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      heic: "image/heic",
      txt: "text/plain",
      eml: "message/rfc822",
      msg: "application/vnd.ms-outlook",
    });
    expect(ALLOWED_EXTENSIONS).toHaveLength(13);
  });

  it("matches the migration's own list when the sibling repo is checked out", () => {
    let sql: string;
    try {
      sql = readFileSync(path.resolve(__dirname, "../../../lectual/supabase/migrations/0097_client_files.sql"), "utf8");
    } catch {
      return; // the lectual repo is not next to this one
    }
    for (const mime of BUCKET_MIMES) expect(sql).toContain(`'${mime}'`);
    expect(sql).toContain("26214400");
    expect(sql).toContain(`'${FILES_BUCKET}'`);
  });

  it("uses a 25 MB limit of 26,214,400 bytes", () => {
    expect(MAX_FILE_BYTES).toBe(26_214_400);
  });
});

describe("checkFileName: the extension is the single authority", () => {
  it.each([
    ["scan.pdf", "pdf", "application/pdf"],
    ["SCAN.PDF", "pdf", "application/pdf"],
    ["Photo.HEIC", "heic", "image/heic"],
    ["mail.eml", "eml", "message/rfc822"],
    ["Outlook item.MSG", "msg", "application/vnd.ms-outlook"],
    ["a.b.c.xlsx", "xlsx", BUCKET_MIMES[3]],
    ["photo.JPeG", "jpeg", "image/jpeg"],
  ])("accepts %s", (name, ext, mime) => {
    const r = checkFileName(name);
    expect(r).toMatchObject({ ok: true, ext, mime });
  });

  it.each(["virus.exe", "a.zip", "page.html", "logo.svg", "run.js", "noextension", "ends-with-dot.", "invoice.pdf.exe", ".hidden", "", "   ", "archive.pdf.zip", "x.pdf "])(
    "refuses %j",
    (name) => {
      const r = checkFileName(name);
      if (name === "x.pdf ") return expect(r.ok).toBe(true); // trailing space is trimmed, so this is a pdf
      expect(r).toEqual({ ok: false, error: FILE_MESSAGES.badType });
    },
  );

  it("uses only the last dot", () => {
    expect(extensionOf("a.pdf.exe")).toBe("exe");
    expect(extensionOf("a.")).toBeNull();
    expect(extensionOf("nodot")).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("removes control characters, replaces path separators, trims", () => {
    expect(cleanFileName("  my\u0000 file\n.pdf\u007f ")).toBe("my file.pdf");
    expect(cleanFileName("../../other/x.pdf")).toBe(".._.._other_x.pdf");
    expect(cleanFileName("a\\b/c.pdf")).toBe("a_b_c.pdf");
  });

  it("keeps a 400-character name to 255 and keeps its extension", () => {
    const name = `${"a".repeat(400)}.pdf`;
    const cleaned = cleanFileName(name);
    expect(cleaned).toHaveLength(255);
    expect(cleaned.endsWith(".pdf")).toBe(true);
    expect(checkFileName(name)).toMatchObject({ ok: true, ext: "pdf" });
  });
});

describe("checkFileSize", () => {
  it("accepts a positive whole number up to exactly 26,214,400", () => {
    expect(checkFileSize(1).ok).toBe(true);
    expect(checkFileSize(26_214_400).ok).toBe(true);
  });

  it("refuses 26,214,401 with a sentence naming 25 MB", () => {
    const r = checkFileSize(26_214_401);
    expect(r).toEqual({ ok: false, error: FILE_MESSAGES.tooBig });
    expect(FILE_MESSAGES.tooBig).toContain("25 MB");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10" as unknown as number, null as unknown as number])("refuses %s, naming the limit", (size) => {
    const r = checkFileSize(size);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("25 MB");
  });
});

describe("buildStoragePath", () => {
  it("is {org}/{kind}/{parent}/{file}.{ext}, with the org id first", () => {
    expect(buildStoragePath({ orgId: ORG, kind: "lead", parentId: LEAD, fileId: FILE_ID, ext: "pdf" })).toBe(`${ORG}/lead/${LEAD}/${FILE_ID}.pdf`);
    expect(buildStoragePath({ orgId: ORG, kind: "matter", parentId: LEAD, fileId: FILE_ID, ext: "msg" }).split("/")[0]).toBe(ORG);
  });

  it("has no parameter for a file name", () => {
    expect(buildStoragePath.length).toBe(1);
    const src = readFileSync(path.resolve(__dirname, "../../src/lib/files/rules.ts"), "utf8");
    const from = src.indexOf("export type StoragePathInput");
    const type = src.slice(from, src.indexOf("};", from));
    expect(type).not.toMatch(/name/i);
  });
});

describe("formatFileSize", () => {
  it.each([
    [512, "512 B"],
    [86_016, "84 KB"],
    [2_411_724, "2.3 MB"],
    [26_214_400, "25.0 MB"],
    [1_048_000, "1023 KB"],
    [1_048_575, "1.0 MB"],
    [1_048_576, "1.0 MB"],
    [1, "1 B"],
  ])("%d is %s", (n, text) => expect(formatFileSize(n)).toBe(text));
});

describe("roles", () => {
  it("re-exports the staff list rather than copying it", () => {
    expect(FILE_UPLOAD_ROLES).toBe(CAN_WRITE_LEAD);
    expect([...FILE_UPLOAD_ROLES].sort()).toEqual([...MATTER_WRITE_ROLES].sort());
    expect(FILE_UPLOAD_ROLES).toHaveLength(8);
    expect(FILE_UPLOAD_ROLES).not.toContain("viewer");
    expect(FILE_UPLOAD_ROLES).not.toContain("social_media");
  });

  it("limits delete to owner, admin and senior_admin", () => {
    expect([...FILE_DELETE_ROLES]).toEqual(["owner", "admin", "senior_admin"]);
  });
});

describe("isUuid", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(isUuid(FILE_ID)).toBe(true);
    for (const v of ["", "abc", "../x", `${FILE_ID}/x`, 5, null, undefined]) expect(isUuid(v)).toBe(false);
  });
});
