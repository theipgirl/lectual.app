import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SIGN_IN_HOME, safeNext } from "@/lib/auth/safe-next";

describe("sign-in lands on Today (Sprint 34 D)", () => {
  it("none, root or an unsafe value resolves to Today", () => {
    expect(SIGN_IN_HOME).toBe("/dashboard/");
    for (const v of [undefined, null, "", "/", "//evil.example", "https://evil.example", "dashboard", "/\\evil", "/\t/evil.example", "/\n/evil.example", "/\r//evil.example", " //evil.example", decodeURIComponent("/%09/evil.example"), "/\u0000x"]) expect(safeNext(v)).toBe("/dashboard/");
  });

  it("the sign-in callback value from the audit cannot leave the origin", () => {
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
    expect(new URL(safeNext("/%09/evil.com"), "https://app.example").origin).toBe("https://app.example");
  });

  it("keeps an in-app path", () => {
    expect(safeNext("/dashboard/queue/")).toBe("/dashboard/queue/");
  });

  it("every entry point uses the one sanitiser, and / goes to Today", () => {
    for (const f of ["src/app/auth/callback/route.ts", "src/app/sign-in/page.tsx", "src/app/sign-in/actions.ts", "src/proxy.ts"]) expect(readFileSync(f, "utf8")).toContain("safe-next");
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain('redirect("/dashboard/")');
  });
});
