import { describe, it, expect } from "vitest";
import { isMissingTableError } from "@/lib/reports/db";

describe("isMissingTableError", () => {
  it("is false for no error", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });

  it("matches PostgREST's and Postgres's own missing-table codes", () => {
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
  });

  it("falls back to message sniffing only when there's no matching code", () => {
    expect(isMissingTableError({ message: "Could not find the table 'agent_run' in the schema cache" })).toBe(true);
    expect(isMissingTableError({ message: "relation \"agent_run\" does not exist" })).toBe(true);
  });

  it("is false for an unrelated error", () => {
    expect(isMissingTableError({ code: "42501", message: "permission denied for table crm_lead" })).toBe(false);
  });
});
