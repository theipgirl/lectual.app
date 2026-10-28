import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, type FakeDb } from "./helpers/fake-db";
import { formData, standardSeed } from "./helpers/seed";
import { BAND_COPY } from "@/lib/matters/worklist";

/**
 * Sprint 8 on the real matter page. The page's loaders and the real server
 * actions both run against one in-memory scoped client (helpers/fake-db.ts), so
 * "do the thing, render again" is a true round trip: the action writes, the page
 * reads what was written. Only what is outside this sprint (session, modules,
 * meetings, intake links, voice playback) is mocked.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as { client(): unknown },
  role: "attorney" as string,
  members: [{ userId: "user-2", displayName: "Dana Cole", email: "dana@example.com", role: "paralegal", identified: true }] as unknown[],
  membersFail: false,
}));

/** Client components use hooks, so they are rendered as elements, never called as functions. */
function el<P extends object>(component: ComponentType<P>, props: P) {
  return createElement(component, props);
}
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&apos;", "'");
const stub = () => null;

let db: FakeDb;

async function load() {
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
  vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: h.role })) }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
  vi.doMock("@/lib/members/directory", () => ({
    listMemberDirectory: vi.fn(async () => {
      if (h.membersFail) throw new Error("directory down");
      return h.members;
    }),
  }));
  vi.doMock("@/lib/meetings/read", () => ({ meetingsFor: vi.fn(async () => ({ status: "none" })) }));
  vi.doMock("@/lib/voice/notes", async (orig) => ({ ...(await orig<typeof import("@/lib/voice/notes")>()), voiceNotePlaybackUrls: vi.fn(async () => ({})) }));
  vi.doMock("@/lib/intake-forms/requests", () => ({
    canSendIntakeRequest: () => false,
    listMatterIntakeRequests: vi.fn(async () => ({ status: "ok", requests: [], formReady: false })),
  }));
  vi.doMock("@/lib/intake-forms/origin", () => ({ intakeOrigin: vi.fn(async () => "https://app.example.test") }));
  vi.doMock("@/components/meetings/LinkedMeetings", () => ({ LinkedMeetings: stub }));
  vi.doMock("@/components/voice/VoiceNoteRecorder", () => ({ default: stub }));
  vi.doMock("@/components/matters/IntakeRequestCard", () => ({ IntakeRequestCard: stub }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: vi.fn() }));

  const page = await import("../../src/app/dashboard/matters/[id]/page");
  const actions = await import("../../src/app/dashboard/matters/[id]/actions");
  const edits = await import("../../src/components/matters/MatterEdits");
  return {
    actions,
    edits,
    render: async () => renderToStaticMarkup(await page.default({ params: Promise.resolve({ id: "matter-1" }) })),
  };
}

function setRole(role: string) {
  h.role = role;
  db.role = role;
}

/** The part of the page between two headings. */
function between(html: string, from: string, to: string): string {
  const start = html.indexOf(from);
  const end = html.indexOf(to, start);
  return html.slice(start, end === -1 ? undefined : end);
}

/** The second line of the sub-line (days in stage, package, came from). */
const factsLine = (html: string) => html.match(/<p class="lx-note" style="margin:2px 0 0">(.*?)<\/p>/)?.[1] ?? "";
const subLine = (html: string) => html.match(/<p class="lx-note" style="margin:6px 0 0">(.*?)<\/p>/)?.[1] ?? "";
const count = (html: string, needle: RegExp) => (html.match(needle) ?? []).length;
const link = { id: "l-1", org_id: "org-1", matter_id: "matter-1", contact_id: "contact-1", role: "client", created_at: "2026-02-01T00:00:00Z" };

beforeEach(() => {
  db = createFakeDb({ tables: standardSeed() });
  h.db = db;
  h.role = "attorney";
  h.membersFail = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── V4 and V3: the header and the read-only page ──────────────────────────────

describe("matter header", () => {
  it("keeps every existing part and adds the Edit details disclosure for a write role", async () => {
    const { render } = await load();
    const html = await render();
    expect(html).toContain("← Matters");
    expect(html).toMatch(/Trademark · <span class="lx-num">TM-2026-0001<\/span>/);
    expect(html).toContain('<h1 class="lx-h1">Acme</h1>');
    expect(subLine(html)).toContain("No client linked");
    expect(subLine(html)).toContain(BAND_COPY.unplaced.label);
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-label="Owner"');
    expect(html).toContain("Edit details");
    expect(html).toContain("Save details");
    for (const label of ["Title", "Package", "Matter type", "Came from"]) expect(html).toContain(`>${label}<`);
    // Litigation is never offered as a type to change to.
    expect(between(html, 'name="type"', "</select>")).not.toContain('value="LIT"');
  });

  it("shows 'Came from' in the sub-line only when it has a value", async () => {
    const { render } = await load();
    expect(factsLine(await render())).toContain("Came from Booth");
    db.rows("crm_matter").find((m) => m.id === "matter-1")!.referral_source = null;
    expect(factsLine(await render())).not.toContain("Came from");
  });

  it("shows 'Came from' in the sub-line to a read-only role", async () => {
    setRole("viewer");
    const { render } = await load();
    expect(factsLine(await render())).toContain("Came from Booth");
  });

  it("offers only Litigation on a litigation matter, with the reason", async () => {
    const { edits } = await load();
    const html = renderToStaticMarkup(el(edits.HeaderEditForm, { matterId: "matter-lit", values: { title: null, packageName: null, type: "LIT", referralSource: null } }));
    expect(between(html, 'name="type"', "</select>")).toContain('value="LIT"');
    expect(between(html, 'name="type"', "</select>")).not.toContain('value="TM"');
    expect(text(html)).toContain("the type can't be changed");
  });

  it("round trip (D1): the saved title and Came from show in the re-rendered header", async () => {
    const { render, actions } = await load();
    const before = await render();
    expect(before).toContain('<h1 class="lx-h1">Acme</h1>');

    const result = await actions.updateMatterHeaderAction({}, formData({ matterId: "matter-1", title: "Acme Rebrand", referralSource: "Dawn's referral" }));
    expect(result).toEqual({ saved: true });

    const after = await render();
    expect(after).toContain('<h1 class="lx-h1">Acme Rebrand</h1>');
    expect(text(factsLine(after))).toContain("Came from Dawn's referral");
    expect(after).toContain('value="Acme Rebrand"'); // the edit form is pre-filled with the saved value
    expect(after).toContain("Matter details updated");
    expect(after).toContain("title, came from");
  });
});

describe("read-only role sees no new controls (V3)", () => {
  const CONTROLS = [
    "Edit details",
    "Save details",
    "Link or add contact",
    "Add and link contact",
    "Save contact",
    "Add to timeline",
    "Records something that happened",
    "Reopen",
    "Add a deadline",
    "Save deadline",
    ">Edit<",
    ">Delete<",
    "Save task",
    ">Done<",
    "Add a task",
  ];

  it("renders none of the controls for viewer and social_media, but still the facts", async () => {
    db.rows("crm_matter_contact").push({ ...link });
    Object.assign(db.rows("crm_task")[0], { assignee_id: "user-2" });
    for (const role of ["viewer", "social_media"]) {
      setRole(role);
      const { render } = await load();
      const html = await render();
      for (const label of CONTROLS) expect(html, `${role} must not see ${label}`).not.toContain(label);
      expect(html).not.toContain("<textarea"); // no composer, no notes box
      // The card, the deadlines and the tasks are still readable.
      expect(html).toContain(">Client contact<");
      expect(html).toContain("Ana Smith");
      expect(html).toContain("ana@example.com");
      expect(html).toContain("Call the client");
      expect(html).toContain("Assigned to Dana Cole");
      expect(html).toContain("Your role can view this matter but not change it.");
    }
  });

  it("shows the controls to a write role (the same labels are really there)", async () => {
    db.rows("crm_matter_contact").push({ ...link });
    setRole("attorney");
    const { render } = await load();
    const html = await render();
    for (const label of ["Edit details", "Link or add contact", "Add to timeline", ">Edit<", ">Delete<", ">Done<", "Reopen"]) expect(html).toContain(label);
  });
});

// ── F7 and D2: the Client contact card ────────────────────────────────────────

describe("Client contact card", () => {
  it("shows the linked contact's name, email, phone, company and role", async () => {
    db.rows("crm_matter_contact").push({ ...link });
    const { render } = await load();
    const html = await render();
    const card = between(html, ">Client contact<", ">Tasks<");
    for (const fact of ["Ana Smith", "ana@example.com", "555-0100", "Acme Inc", "Client"]) expect(card).toContain(fact);
    expect(card).not.toContain("No contact linked yet.");
    // The linked contact also names the client in the header.
    expect(subLine(html)).toContain("Ana Smith");
    expect(card).toContain("Link or add contact");
    expect(card).toContain("Edit");
    expect(text(card)).toContain("one shared record");
  });

  it("lists every linked contact, oldest link first", async () => {
    db.rows("crm_matter_contact").push({ ...link }, { ...link, id: "l-2", contact_id: "contact-2", role: "co-client", created_at: "2026-03-01T00:00:00Z" });
    const { render } = await load();
    const card = between(await render(), ">Client contact<", ">Tasks<");
    expect(card.indexOf("Ana Smith")).toBeGreaterThan(-1);
    expect(card.indexOf("Bo Lee")).toBeGreaterThan(card.indexOf("Ana Smith"));
    expect(card).toContain("Co-client");
  });

  it("says 'No contact linked yet.' when the read worked and found none", async () => {
    const { render } = await load();
    const card = between(await render(), ">Client contact<", ">Tasks<");
    expect(card).toContain("No contact linked yet.");
    expect(card).toContain("Link or add contact");
  });

  it("says the contact couldn't be loaded, not 'No contact linked yet.', and keeps the rest of the page", async () => {
    db.fail("crm_matter_contact", "select");
    const { render } = await load();
    const html = await render();
    const card = between(html, ">Client contact<", ">Tasks<");
    expect(text(card)).toContain("The client contact couldn't be loaded.");
    expect(card).not.toContain("No contact linked yet.");
    expect(text(subLine(html))).toContain("Client contact couldn't be loaded");
    expect(html).toContain(">Deadlines<");
    expect(html).toContain("Timeline");
    expect(html).toContain(">Tasks<");
  });

  it("reads the contacts through the one three-state loader only", () => {
    const source = readFileSync(path.resolve(__dirname, "../../src/app/dashboard/matters/[id]/page.tsx"), "utf8");
    expect(source.match(/loadMatterContacts\(/g)).toHaveLength(1);
    for (const forbidden of ["primaryClientContact(", "listMatterContacts(", "resolveMatterClientName(", "crm_contact", "crm_matter_contact"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("flow (D2): search finds the contact unlinked, link adds it to the card, a second search flags it", async () => {
    const { render, actions } = await load();
    const first = await actions.searchContactsAction({}, formData({ matterId: "matter-1", q: "ana" }));
    expect(first.hits).toEqual([{ id: "contact-1", name: "Ana Smith", email: "ana@example.com", phone: "555-0100", companyName: "Acme Inc", linked: false }]);

    expect(await actions.linkContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1" }))).toMatchObject({ saved: true });

    const card = between(await render(), ">Client contact<", ">Tasks<");
    for (const fact of ["Ana Smith", "ana@example.com", "555-0100", "Acme Inc"]) expect(card).toContain(fact);
    expect(card).not.toContain("No contact linked yet.");

    const second = await actions.searchContactsAction({}, formData({ matterId: "matter-1", q: "ana" }));
    expect(second.hits?.[0]).toMatchObject({ id: "contact-1", linked: true });
  });

  it("flow: an edit shows in the card, and a bad email is refused with a sentence", async () => {
    db.rows("crm_matter_contact").push({ ...link });
    const { render, actions } = await load();
    expect((await actions.editContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1", email: "nope" }))).error).toMatch(/valid email/);
    expect(await actions.editContactAction({}, formData({ matterId: "matter-1", contactId: "contact-1", phone: "555-0999" }))).toEqual({ saved: true });
    expect(between(await render(), ">Client contact<", ">Tasks<")).toContain("555-0999");
  });

  it("the search panel shows a failed search as an error, the add form says what it does", async () => {
    const { edits } = await load();
    const html = renderToStaticMarkup(el(edits.ContactLinker, { matterId: "matter-1" }));
    expect(html).toContain("Search contacts");
    expect(html).toContain("Add a new contact");
    expect(html).toContain("Add and link contact");
    expect(html).toContain("Links as the client. Sends nothing.");
    for (const label of ["First name", "Last name", "Business name", "Email", "Phone", "Company"]) expect(html).toContain(`>${label}<`);
  });
});

// ── F8, D3: the timeline composer ─────────────────────────────────────────────

describe("typed timeline entries", () => {
  it("offers Note, Call, Email (logged) and Meeting above the voice recorder, with the reassurance line", async () => {
    const { render } = await load();
    const timeline = between(await render(), ">Timeline<", "</section>");
    for (const label of ["Note", "Call", "Email (logged)", "Meeting"]) expect(timeline).toContain(label);
    expect(timeline).toContain("Add to timeline");
    expect(timeline).toContain("Records something that happened. Nothing is sent.");
    expect(timeline).not.toContain("@name"); // matter notes don't promise @tags
  });

  it("flow (D3): a call, then a meeting, appear on the Timeline with their own titles, newest first", async () => {
    const { render, actions } = await load();
    expect(await actions.addMatterNoteAction({}, formData({ matterId: "matter-1", kind: "call_logged", body: "Talked through classes", subject: "Check-in call" }))).toEqual({ saved: true });
    expect(await actions.addMatterNoteAction({}, formData({ matterId: "matter-1", kind: "meeting", body: "Met at the booth" }))).toEqual({ saved: true });

    const timeline = between(await render(), ">Timeline<", "</section>");
    expect(timeline).toContain("Call logged");
    expect(timeline).toContain("Check-in call");
    expect(timeline).toContain("Meeting");
    expect(timeline).toContain("Met at the booth");
    expect(timeline.indexOf("Meeting")).toBeLessThan(timeline.indexOf("Call logged"));
  });
});

// ── F9, D4: deadlines ─────────────────────────────────────────────────────────

describe("deadline controls", () => {
  const docket = (html: string) => between(html, ">Deadlines<", ">Filing details<");

  it("lifecycle (D4): close, see it closed with Reopen, reopen, see it open with Edit", async () => {
    const { render, actions } = await load();
    const start = docket(await render());
    expect(start).toContain("2 open"); // dl-open and dl-conf
    expect(start).toContain("1 closed out");

    expect(await actions.closeDeadlineAction({}, formData({ matterId: "matter-1", deadlineId: "dl-open", status: "waived" }))).toEqual({});
    const closed = docket(await render());
    expect(closed).toContain("1 open");
    expect(closed).toContain("2 closed out");
    expect(text(closed)).toMatch(/office action response · Nov 3, 2026 · waived/i);
    expect(count(closed, />Reopen</g)).toBe(2);

    expect(await actions.reopenDeadlineAction({}, formData({ matterId: "matter-1", deadlineId: "dl-open" }))).toEqual({});
    const reopened = docket(await render());
    expect(reopened).toContain("2 open");
    expect(reopened).toContain("1 closed out");
    expect(count(reopened, />Reopen</g)).toBe(1);
    expect(count(reopened, />Edit</g)).toBe(2); // both open deadlines
  });

  it("edit moves the date, and the confirmation chip drops when a confirmed date moves", async () => {
    setRole("attorney");
    const { render, actions } = await load();
    const before = docket(await render());
    expect(count(before, /Unconfirmed/g)).toBe(1); // dl-open only
    await actions.updateDeadlineAction({}, formData({ matterId: "matter-1", deadlineId: "dl-conf", dueDate: "2027-01-15" }));
    const after = docket(await render());
    expect(text(after)).toContain("Jan 15, 2027");
    expect(count(after, /Unconfirmed/g)).toBe(2);
  });

  it("shows Delete to an admin for an unconfirmed deadline, to an attorney never, and to nobody for a confirmed one", async () => {
    const delButtons = (html: string) => count(docket(html), />Delete</g);
    for (const [role, expected] of [
      ["admin", 2], // dl-open (open) and dl-closed (closed); dl-conf is confirmed
      ["senior_admin", 2],
      ["owner", 2],
      ["attorney", 0],
      ["paralegal", 0],
      ["intake", 0],
      ["clerk", 0],
      ["law_clerk", 0],
    ] as const) {
      setRole(role);
      const { render } = await load();
      expect(delButtons(await render()), role).toBe(expected);
    }
  });

  it("a confirmed deadline shows no Delete even to an owner, but still shows Edit", async () => {
    setRole("owner");
    db.rows("crm_matter_deadline").forEach((d) => {
      if (d.id !== "dl-conf" && d.org_id === "org-1") d.status = "satisfied";
    });
    const { render } = await load();
    const html = docket(await render());
    expect(count(html, />Delete</g)).toBe(2); // the two closed unconfirmed ones; the confirmed open one has none
    expect(html).toContain("SOU");
  });

  it("the edit form warns a confirmed date will need confirming again; the delete step names what goes", async () => {
    const { edits } = await load();
    const confirmed = text(renderToStaticMarkup(el(edits.DeadlineEdit, { matterId: "matter-1", deadlineId: "dl-conf", title: "SOU", dueDate: "2026-12-01", confirmed: true, defaultOpen: true })));
    expect(confirmed).toContain("An attorney has confirmed this date. If you move it, the attorney will need to confirm it again.");
    expect(confirmed).toContain("Save deadline");
    expect(confirmed).toContain('value="2026-12-01"');
    const plain = renderToStaticMarkup(el(edits.DeadlineEdit, { matterId: "matter-1", deadlineId: "dl-open", title: null, dueDate: "2026-11-03", confirmed: false, defaultOpen: true }));
    expect(plain).not.toContain("will need to confirm it again");

    const del = text(renderToStaticMarkup(el(edits.DeadlineDelete, { matterId: "matter-1", deadlineId: "dl-open", label: "Office Action response", dueDate: "Nov 3, 2026", defaultOpen: true })));
    expect(del).toContain("Delete this deadline? Office Action response, due Nov 3, 2026, will be removed from the docket.");
    expect(del).toContain("Yes, delete");
    expect(del).toContain("Cancel");
  });

  it("a delete button needs a second click: closed it shows only 'Delete'", async () => {
    const { edits } = await load();
    const html = renderToStaticMarkup(el(edits.DeadlineDelete, { matterId: "matter-1", deadlineId: "dl-open", label: "x", dueDate: "y" }));
    expect(html).toContain(">Delete<");
    expect(html).not.toContain("Yes, delete");
    expect(html).not.toContain("<form");
  });
});

// ── F10, D5: tasks ────────────────────────────────────────────────────────────

describe("task controls", () => {
  const aside = (html: string) => between(html, ">Tasks<", ">Notes<");

  it("lifecycle (D5): create, edit title and due date, assign, unassign, delete", async () => {
    const { render, actions } = await load();
    expect(await actions.createTaskAction({}, formData({ matterId: "matter-1", title: "Send engagement letter", dueAt: "2026-11-10" }))).toEqual({});
    let tasks = aside(await render());
    expect(tasks).toContain("Send engagement letter");
    expect(tasks).toContain("Due Nov 10, 2026");

    const created = db.rows("crm_task").find((t) => t.title === "Send engagement letter")!;
    expect(await actions.updateTaskAction({}, formData({ matterId: "matter-1", taskId: created.id as string, title: "Send the engagement letter", dueAt: "2026-11-12" }))).toEqual({ saved: true });
    tasks = aside(await render());
    expect(tasks).toContain("Send the engagement letter");
    expect(tasks).toContain("Due Nov 12, 2026");
    expect(tasks).not.toContain("Send engagement letter<");

    expect(await actions.updateTaskAction({}, formData({ matterId: "matter-1", taskId: created.id as string, assigneeId: "user-2" }))).toEqual({ saved: true });
    expect(aside(await render())).toContain("Assigned to Dana Cole");

    expect(await actions.updateTaskAction({}, formData({ matterId: "matter-1", taskId: created.id as string, assigneeId: "" }))).toEqual({ saved: true });
    expect(aside(await render())).not.toContain("Assigned to");

    expect(await actions.deleteTaskAction({}, formData({ matterId: "matter-1", taskId: created.id as string }))).toEqual({});
    tasks = aside(await render());
    expect(tasks).not.toContain("Send the engagement letter");
    expect(tasks).toContain("Call the client"); // the other task is untouched
  });

  it("each open task has Done, Edit and Delete for a write role", async () => {
    const { render } = await load();
    const tasks = aside(await render());
    for (const label of [">Done<", ">Edit<", ">Delete<", "Add a task"]) expect(tasks).toContain(label);
  });

  it("the edit form offers an Unassigned option and the firm's members", async () => {
    const { edits } = await load();
    const html = renderToStaticMarkup(el(edits.TaskControls, { matterId: "matter-1", task: { id: "task-1", title: "Call the client", dueDate: "2026-10-30", assigneeId: "user-2" }, members: [{ userId: "user-2", name: "Dana Cole" }], defaultOpen: true }));
    expect(html).toContain('aria-label="Task title"');
    expect(html).toContain('value="Call the client"');
    expect(html).toContain('value="2026-10-30"');
    expect(html).toContain(">Unassigned<");
    expect(html).toMatch(/<option value="user-2" selected="">Dana Cole<\/option>/);
    expect(html).toContain("Save task");
    expect(html).toContain(">Delete<");
    expect(html).not.toContain("Yes, delete");
  });

  it("leaves the assignee choice out, and says why, when the team list couldn't be read", async () => {
    h.membersFail = true;
    const { render, edits } = await load();
    const html = text(renderToStaticMarkup(el(edits.TaskControls, { matterId: "matter-1", task: { id: "task-1", title: "Call the client", dueDate: null, assigneeId: null }, members: null, defaultOpen: true })));
    expect(html).not.toContain("<select");
    expect(html).toContain("The team list couldn't be loaded, so this task can't be reassigned right now.");
    // And the page itself still renders.
    expect(await render()).toContain("Call the client");
  });
});

// ── Staff notes ───────────────────────────────────────────────────────────────

describe("staff notes", () => {
  it("shows a saved note and a 'Notes updated' timeline row", async () => {
    const { render, actions } = await load();
    await actions.updateMatterNotesAction({}, formData({ matterId: "matter-1", notes: "Client wants an expedited filing." }));
    const html = await render();
    expect(html).toContain("Client wants an expedited filing.");
    expect(between(html, ">Timeline<", "</section>")).toContain("Notes updated");
  });
});
