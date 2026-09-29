import { describe, it, expect } from "vitest";
import { friendlyMatterError } from "../../src/app/dashboard/matters/errors";

describe("friendlyMatterError", () => {
  it("never passes a database message through", () => {
    const pg = Object.assign(new Error('new row violates row-level security policy for table "crm_matter"'), { code: "XX000" });
    expect(friendlyMatterError(pg, "Couldn't save.")).toBe("Couldn't save.");
    expect(friendlyMatterError({ code: "22P02", message: "invalid input syntax for type uuid" }, "Couldn't save.")).toBe("Couldn't save.");
  });
  it("maps the codes a person can act on", () => {
    expect(friendlyMatterError({ code: "42501" }, "x")).toMatch(/permission/);
    expect(friendlyMatterError({ code: "23505" }, "x")).toMatch(/already in use/);
  });
  it("keeps messages the app wrote to be read, and softens the role gate", () => {
    expect(friendlyMatterError(new Error("Enter the due date."), "x")).toBe("Enter the due date.");
    expect(friendlyMatterError(new Error("Forbidden: role 'viewer' cannot write matters"), "x")).toMatch(/permission/);
    expect(friendlyMatterError("boom", "x")).toBe("x");
  });
});
