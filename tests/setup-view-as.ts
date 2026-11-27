import { vi } from "vitest";

/**
 * View as (spec docs/pge/2026-11-17-agentic-ip-os/spec-owner-view-as.md): every server action now asks the preview flag
 * before it runs (previewSafe). Its real read resolves the session through the scoped client, which most suites replace
 * with a fake that records every table it is asked for. So, for every suite, the flag is OFF and the state read makes no
 * call, exactly as for a person who isn't previewing. The View as suites (tests/views/view-as-*) unmock it to test the real
 * read.
 */
vi.mock("@/lib/views/view-as-flag", () => ({
  previewFlag: async () => "off",
  readPreviewState: async () => ({ kind: "off" }),
}));
