import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { Icon } from "@/components/ui/Icon";
import { PageHeader, BackLink } from "@/components/ui/PageHeader";
import { Dialog, SidePanel, CloseButton } from "@/components/ui/Dialog";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { LoadFailedCard, LoadFailedLine } from "@/components/ui/LoadFailed";
import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";
import { SavedNote } from "@/components/ui/SavedNote";
import { Toast } from "@/components/ui/Toast";
import { Field } from "@/components/ui/Field";
import { cantShowTitle, noneYet, columnEmpty, yesVerb } from "@/lib/ui/words";

describe("Icon", () => {
  it("is hidden from assistive tech unless labelled", () => {
    expect(renderToStaticMarkup(<Icon name="close" />)).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(<Icon name="check" label="Done" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Done"');
    expect(labelled).not.toContain("aria-hidden");
  });
  it("draws every name", () => {
    for (const n of ["close", "chevron-down", "chevron-right", "chevron-left", "more", "check"] as const) {
      expect(renderToStaticMarkup(<Icon name={n} size={20} />)).toContain('width="20"');
    }
    expect(renderToStaticMarkup(<Icon name="more" />).match(/<circle/g)).toHaveLength(3);
  });
});

describe("PageHeader", () => {
  it("has a title, one sub-line, details and ONE actions slot, and no eyebrow", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Proposals" sub="Everything sent." details="Updated today" count={4} back={{ href: "/x", label: "Leads" }} actions={<button>New</button>} tour="p-head" />,
    );
    expect(html).toContain('class="lx-page-head lx-head"');
    expect(html).toContain('<h1 class="lx-h1" data-tour="p-head">Proposals</h1>');
    expect(html).toContain('<p class="lx-sub">Everything sent.</p>');
    expect(html).toContain('<p class="lx-head-details">Updated today</p>');
    expect(html).toContain('<span class="lx-head-count">4</span>');
    expect(html.match(/lx-head-actions/g)).toHaveLength(1);
    expect(html).not.toContain("lx-label");
    expect(html.indexOf("lx-back")).toBeLessThan(html.indexOf("<h1"));
  });
  it("leaves out what it is not given", () => {
    const html = renderToStaticMarkup(<PageHeader title="Team" />);
    expect(html).not.toContain("lx-sub");
    expect(html).not.toContain("lx-head-actions");
  });
  it("BackLink is an arrow and the parent's name", () => {
    expect(renderToStaticMarkup(<BackLink href="/a" label="Proposals" />)).toMatch(/<a href="\/a" class="lx-back">← Proposals<\/a>/);
  });
});

describe("Dialog and SidePanel", () => {
  it("Dialog is a labelled modal dialog with one close control", () => {
    const html = renderToStaticMarkup(
      <Dialog title="Your name" titleId="t1" onClose={() => {}} footer={<button>Save</button>}>
        body
      </Dialog>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t1"');
    expect(html).toContain('id="t1"');
    expect(html.match(/aria-label="Close"/g)).toHaveLength(1);
    expect(html).toContain("lx-modal lx-modal-md");
    expect(html).toContain("lx-modal-foot");
  });
  it("sizes and a URL close", () => {
    const html = renderToStaticMarkup(
      <Dialog title="T" size="lg" closeHref="/back">
        x
      </Dialog>,
    );
    expect(html).toContain("lx-modal-lg");
    expect(html).toContain('data-close="true"');
    expect(html).toContain('href="/back"');
  });
  it("SidePanel is a right-side drawer with the same parts", () => {
    const html = renderToStaticMarkup(
      <SidePanel title="Lead" titleId="p1" closeHref="/leads">
        x
      </SidePanel>,
    );
    expect(html).toContain("lx-drawer-root");
    expect(html).toContain('<aside role="dialog" aria-modal="true" aria-labelledby="p1"');
    expect(html).toContain('aria-label="Close"');
  });
  it("CloseButton says Close by default", () => {
    expect(renderToStaticMarkup(<CloseButton onClick={() => {}} />)).toContain('aria-label="Close"');
  });
});

describe("InlineConfirm", () => {
  const ask = (props: Partial<React.ComponentProps<typeof InlineConfirm>> = {}) =>
    renderToStaticMarkup(<InlineConfirm label="Remove" question="Remove Sam?" onConfirm={() => {}} initial="asking" {...props} />);
  it("defaults to 'Yes, <verb>' in the danger style, with Cancel", () => {
    const html = ask();
    expect(html).toContain(">Yes, remove<");
    expect(html).toContain("lx-btn-danger");
    expect(html).toContain(">Cancel<");
    expect(html).toContain('role="alert"');
  });
  it("uses the primary style for a confirm that removes nothing", () => {
    expect(ask({ tone: "primary", label: "Change role" })).toContain("lx-btn-pri");
  });
  it("yesVerb lowercases", () => expect(yesVerb(" Archive ")).toBe("Yes, archive"));
});

describe("load failed, notice, empty, saved, toast, field", () => {
  it("LoadFailedCard has the shared title, sentence and a Refresh control", () => {
    const html = renderToStaticMarkup(<LoadFailedCard what="proposals" />);
    expect(html).toContain("Can&#x27;t show proposals right now");
    expect(cantShowTitle("proposals")).toBe("Can't show proposals right now");
    expect(html).toContain("Refresh to try again.");
    expect(html).toContain(">Refresh<");
    expect(html).toContain('role="status"');
  });
  it("LoadFailedLine says the shared sentence by default and can drop Refresh", () => {
    expect(renderToStaticMarkup(<LoadFailedLine />)).toContain("Can&#x27;t show this right now.");
    expect(renderToStaticMarkup(<LoadFailedLine refresh={false}>Nope</LoadFailedLine>)).not.toContain("Refresh<");
  });
  it("Notice has four tones", () => {
    for (const tone of ["ok", "warn", "risk", "mute"] as const) {
      expect(renderToStaticMarkup(<Notice tone={tone}>x</Notice>)).toContain(`lx-banner lx-banner-${tone}`);
    }
    expect(renderToStaticMarkup(<Notice>x</Notice>)).toContain("lx-banner-mute");
    expect(renderToStaticMarkup(<Notice title="T" role="alert" action={<a>Go</a>}>x</Notice>)).toContain("<strong>T</strong>x<a>Go</a>");
  });
  it("EmptyState is a card or a line, with the shared sentence shape", () => {
    expect(renderToStaticMarkup(<EmptyState title="Nothing">{noneYet("proposals", "Start one from a lead.")}</EmptyState>)).toContain("No proposals yet. Start one from a lead.");
    expect(renderToStaticMarkup(<EmptyState variant="line">x</EmptyState>)).toBe('<p class="lx-note lx-state-line">x</p>');
    expect(columnEmpty("leads")).toBe("No leads here yet.");
  });
  it("SavedNote draws only when shown", () => {
    expect(renderToStaticMarkup(<SavedNote show={false} />)).toBe("");
    expect(renderToStaticMarkup(<SavedNote show />)).toBe('<span class="lx-saved" role="status">Saved.</span>');
  });
  it("Toast is a status with an optional action", () => {
    expect(renderToStaticMarkup(<Toast action={<a>Undo</a>}>Moved</Toast>)).toBe('<div class="lx-toast" role="status">Moved<a>Undo</a></div>');
  });
  it("Field has a sentence-case label, and marks only optional ones", () => {
    const html = renderToStaticMarkup(
      <Field label="Company name" hint="As on the filing" optional>
        <input />
      </Field>,
    );
    expect(html).toContain('<span class="lx-label">Company name<span class="lx-optional"> (optional)</span></span>');
    expect(html).toContain('<span class="lx-note">As on the filing</span>');
    expect(renderToStaticMarkup(<Field label="Email"><input /></Field>)).not.toContain("optional");
  });
});
