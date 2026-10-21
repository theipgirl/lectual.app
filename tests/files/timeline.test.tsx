import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "../../src/components/timeline/Timeline";
import { describeActivity } from "../../src/components/leads/describe";
import { ACTIVITY_TYPES_0097 } from "../../src/lib/matters/activity";

const row = (payload: unknown, id = "a1") => ({ id, type: "file_uploaded", actor_type: "user", created_at: "2026-10-21T10:00:00Z", payload });
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

describe("a file_uploaded row in the Timeline", () => {
  it("names the file in plain words and shows the size, never the storage path", () => {
    const html = text(renderToStaticMarkup(<Timeline rows={[row({ file_id: "f", file_name: "Signed LOE.pdf", size_bytes: 86_016, storage_path: "org/lead/x/y.pdf" })]} />));
    expect(html).toContain("File added: Signed LOE.pdf");
    expect(html).toContain("84 KB");
    expect(html).not.toContain("org/lead/x/y.pdf");
  });

  it("describes the row without a path even when the payload (wrongly) carries one", () => {
    const d = describeActivity(row({ file_name: "a.pdf", size_bytes: 10, storage_path: "p/q.pdf" }));
    expect(JSON.stringify(d)).not.toContain("p/q.pdf");
    expect(d).toMatchObject({ title: "File added: a.pdf", detail: "10 B", tone: "note", link: null });
  });

  it.each([
    ["no payload", null],
    ["an empty payload", {}],
    ["a non-string name", { file_name: 42, size_bytes: "big" }],
    ["a blank name", { file_name: "   " }],
    ["an object name", { file_name: { a: 1 } }],
    ["a negative size", { file_name: "a.pdf", size_bytes: -5 }],
  ])("does not break on %s", (_label, payload) => {
    const html = renderToStaticMarkup(<Timeline rows={[row(payload)]} />);
    expect(html).toContain("File added");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("[object");
  });

  it("is a type the app adds by the 0097 widening", () => {
    expect(ACTIVITY_TYPES_0097).toEqual(["file_uploaded"]);
  });
});
