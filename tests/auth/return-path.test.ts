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

describe("the return path carries nothing that names a client or a record (review fix)", () => {
  it("keeps only the allowed, non-identifying keys", () => {
    expect(dashboardReturnPath("/dashboard/forms/", "?event=legal-assessment&range=30&tab=results")).toBe("/dashboard/forms/?event=legal-assessment&range=30&tab=results");
    for (const key of ["event", "range", "view", "form", "tab", "group", "who", "kind"]) {
      expect(dashboardReturnPath("/dashboard/x/", `?${key}=abc`), key).toBe(`/dashboard/x/?${key}=abc`);
    }
  });

  it.each(["q", "c", "m", "box", "live", "open", "lead", "matter", "person", "i", "notice", "email", "anything"])("drops %s", (key) => {
    expect(dashboardReturnPath("/dashboard/review/", `?${key}=Jane%20Doe&view=board`)).toBe("/dashboard/review/?view=board");
  });

  it("drops a kept key whose value isn't plain (spaces, @, colon, too long)", () => {
    for (const v of ["Jane%20Doe", "a%40b.com", "lead%3Aabc", "x".repeat(121)]) {
      expect(dashboardReturnPath("/dashboard/forms/", `?event=${v}`), v).toBe("/dashboard/forms/");
    }
  });

  it("caps the length: over the cap falls back to the bare path, then to Today", () => {
    const many = Array.from({ length: 8 }, (_, i) => `${["event", "range", "view", "form", "tab", "group", "who", "kind"][i]}=${"a".repeat(100)}`).join("&");
    expect(dashboardReturnPath("/dashboard/forms/", `?${many}`)).toBe("/dashboard/forms/");
    expect(dashboardReturnPath(`/dashboard/${"a".repeat(700)}`, "")).toBe("/dashboard/");
  });

  it("refuses paths that leave the dashboard or are not plain", () => {
    for (const p of ["/dashboard/../../x", "//host/dashboard", "/dashboard\\x", "/dashboard/\r\nx", "https://evil.example/dashboard", "/dashboardx"]) {
      expect(dashboardReturnPath(p, ""), JSON.stringify(p)).toBeNull();
    }
  });
});

describe("proxy: a browser-sent return header never reaches the app", () => {
  it("deletes a forged x-lectual-return-to and sets its own for a dashboard page", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../../src/proxy");
    const forged = new NextRequest("https://app.example/dashboard/review/?q=Jane&view=board", { headers: { "x-lectual-return-to": "//evil.example/" } });
    const res = await proxy(forged);
    expect(res.headers.get("x-middleware-request-x-lectual-return-to")).toBe("/dashboard/review/?view=board");
    const outside = new NextRequest("https://app.example/sign-in/", { headers: { "x-lectual-return-to": "/dashboard/x/" } });
    const res2 = await proxy(outside);
    expect(res2.headers.get("x-middleware-request-x-lectual-return-to")).toBeNull();
    expect(res2.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-lectual-return-to");
  });
});
