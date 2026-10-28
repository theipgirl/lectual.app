import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { folderSelect, type MailNavLink } from "@/lib/mailbox/folder-select";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { MailFolderSelect } from "@/components/mailbox/MailFolderSelect";

const links = (boxCurrent: string | null, sent = false): MailNavLink[] => [
  { key: "received", group: "Folders", label: "Received", href: "/dashboard/mail/", current: !sent },
  { key: "sent", group: "Folders", label: "Sent", href: "/dashboard/mail/?f=sent", current: sent },
  { key: "all", group: "Mailboxes", label: "All mailboxes", href: "/dashboard/mail/", current: boxCurrent === null },
  { key: "b1", group: "Mailboxes", label: "a@firm.com", href: "/dashboard/mail/?box=b1", current: boxCurrent === "b1" },
];

describe("My Mail compact select (Sprint 34 B)", () => {
  it("option values are exactly the sidebar link hrefs", () => {
    const l = links("b1");
    expect(folderSelect(l).options.map((o) => o.href)).toEqual(l.map((x) => x.href));
  });

  it("the closed select names the folder and the mailbox it is showing", () => {
    expect(folderSelect(links("b1", true)).value).toBe("/dashboard/mail/?f=sent");
    expect(folderSelect(links("b1")).options[0].label).toBe("Received (a@firm.com)");
    expect(folderSelect(links(null)).options[1].label).toBe("Sent (all mailboxes)");
  });

  it("renders one select with both groups, and the sidebar is hidden under 640px", () => {
    const html = renderToStaticMarkup(createElement(MailFolderSelect, { select: folderSelect(links("b1")) }));
    expect(html.match(/<select/g)?.length).toBe(1);
    expect(html).toContain('<optgroup label="Folders">');
    expect(html).toContain('<optgroup label="Mailboxes">');
    expect(html).toContain('value="/dashboard/mail/?box=b1"');
    const css = readFileSync("src/components/mailbox/mail-pane.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{[\s\S]*\.lx-mail-side\s*\{\s*display:\s*none/);
    expect(readFileSync("src/app/dashboard/mail/page.tsx", "utf8")).toContain("<MailFolderSelect");
  });
});
