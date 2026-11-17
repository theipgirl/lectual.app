import { describe, expect, it } from "vitest";
import { dashboardReturnPath, signInRedirect } from "@/lib/auth/return-path";
import { safeNext } from "@/lib/auth/safe-next";

describe("sign-in comes back to the page that was asked for", () => {
  it("keeps a dashboard page's path and query (the event page)", () => {
    expect(dashboardReturnPath("/dashboard/forms/", "?event=legal-assessment")).toBe("/dashboard/forms/?event=legal-assessment");
    expect(dashboardReturnPath("/dashboard/forms/", "?event=urban-golf-2026&range=30")).toBe("/dashboard/forms/?event=urban-golf-2026&range=30");
    expect(dashboardReturnPath("/dashboard", "")).toBe("/dashboard");
  });

  it("is null outside the dashboard", () => {
    for (const p of ["/", "/sign-in/", "/p/abc/", "/i/x", "/dashboardx", "/api/worksheet/"]) expect(dashboardReturnPath(p, ""), p).toBeNull();
  });

  it("encodes the next path so its own query survives the sign-in URL, and round-trips", () => {
    const url = signInRedirect("/dashboard/forms/?event=legal-assessment&range=30");
    expect(url).toBe("/sign-in/?next=%2Fdashboard%2Fforms%2F%3Fevent%3Dlegal-assessment%26range%3D30");
    const next = new URL(url, "https://x.invalid").searchParams.get("next");
    expect(safeNext(next)).toBe("/dashboard/forms/?event=legal-assessment&range=30");
  });

  it("never points off the app", () => {
    for (const bad of ["//evil.example/x", "https://evil.example/", "/\\evil", "", null]) expect(signInRedirect(bad)).toBe("/sign-in/?next=%2Fdashboard%2F");
  });
});
