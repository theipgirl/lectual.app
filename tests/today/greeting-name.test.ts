import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { greetingName, greetingSuffix } from "@/lib/today/greeting-name";

const me = "user-1";
const heading = (name: string | null) => `Good morning${greetingSuffix(name)}.`;

describe("greetingName (F16)", () => {
  it("uses the first word of the directory name", () => {
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: "Taylor McGhee" }], email: "taylormcghee93@gmail.com" })).toBe("Taylor");
  });

  it("returns null when only an email exists, so the heading has no handle", () => {
    const name = greetingName({ userId: me, members: [], metadata: {}, email: "taylormcghee93@gmail.com" });
    expect(name).toBeNull();
    expect(heading(name)).toBe("Good morning.");
    expect(heading(name)).not.toContain("taylormcghee93");
    expect(heading(name)).not.toContain(",");
  });

  it("falls back to metadata full_name, then name", () => {
    expect(greetingName({ userId: me, members: [], metadata: { full_name: "Rebecca Beliard" }, email: "r@x.example" })).toBe("Rebecca");
    expect(greetingName({ userId: me, members: [], metadata: { name: "Dawn Alvarez" }, email: "d@x.example" })).toBe("Dawn");
    expect(greetingName({ userId: me, members: [], metadata: { full_name: "Rebecca B", name: "Other" } })).toBe("Rebecca");
  });

  it("prefers the directory name over the metadata name", () => {
    expect(
      greetingName({ userId: me, members: [{ userId: me, displayName: "Taylor McGhee" }], metadata: { full_name: "Somebody Else" } }),
    ).toBe("Taylor");
  });

  it("treats blank and whitespace-only names as missing", () => {
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: "   " }], metadata: { full_name: "" , name: " \t " }, email: "a@b.example" })).toBeNull();
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: "   " }], metadata: { full_name: "Rebecca B" } })).toBe("Rebecca");
  });

  it("never leaks the email handle, even when a name field holds it", () => {
    const email = "taylormcghee93@gmail.com";
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: "taylormcghee93" }], email })).toBeNull();
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: "TaylorMcGhee93" }], email })).toBeNull();
    expect(greetingName({ userId: me, members: [], metadata: { full_name: "taylormcghee93" }, email })).toBeNull();
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: email }], email })).toBeNull();
  });

  it("falls through unidentified rows and null names to the metadata", () => {
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: "Stale Name", identified: false }], metadata: { name: "Real Name" } })).toBe("Real");
    expect(greetingName({ userId: me, members: [{ userId: me, displayName: null }], metadata: { name: "Real Name" } })).toBe("Real");
  });

  it("ignores other members' names and non-string metadata", () => {
    expect(greetingName({ userId: me, members: [{ userId: "user-2", displayName: "Dawn Alvarez" }], metadata: { full_name: 42, name: null } })).toBeNull();
  });

  it("greets with the name and a comma", () => {
    expect(heading("Taylor")).toBe("Good morning, Taylor.");
  });
});

describe("Today heading wiring (F16)", () => {
  const page = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/page.tsx"), "utf8");

  it("no longer builds the greeting from session.displayName", () => {
    expect(page).not.toContain("session.displayName.split");
    expect(page).toContain("greetingName(");
    expect(page).toContain("greetingSuffix(");
  });

  it("reads the directory it already loads and passes the account's own fields", () => {
    expect(page).toContain("members,");
    expect(page).toContain("session.user.user_metadata");
  });
});
