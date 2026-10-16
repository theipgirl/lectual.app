import { describe, it, expect } from "vitest";
import { cronAuthorized } from "@/lib/cron-auth";

describe("cron authorisation", () => {
  it("accepts exactly Bearer <secret>", () => {
    expect(cronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(cronAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(cronAuthorized("s3cret", "s3cret")).toBe(false);
  });
  it("fails closed when no secret is configured", () => {
    expect(cronAuthorized("Bearer ", undefined)).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(cronAuthorized(null, "s3cret")).toBe(false);
  });
});
