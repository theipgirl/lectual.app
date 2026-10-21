"use client";

// Matter editing for daily work (Sprint 8): header details, the Client contact
// card, the typed timeline composer, deadline edit/reopen/delete and task
// edit/assign/delete. Same classes and the same Save / Saving… / error-line
// behaviour as MatterForms.tsx; no new CSS. Every control here is rendered by
// the page for write roles only, and every action re-checks the role itself.

import { useActionState, useRef, useState } from "react";
import {
  addContactAction,
  addMatterNoteAction,
  deleteDeadlineAction,
  deleteTaskAction,
  editContactAction,
  linkContactAction,
  reopenDeadlineAction,
  searchContactsAction,
  updateDeadlineAction,
  updateMatterHeaderAction,
  updateTaskAction,
  type ActionState,
  type ContactSearchState,
  type MessageActionState,
} from "@/app/dashboard/matters/[id]/actions";
// Pure leaf modules only: the @/lib/matters barrel pulls in the server client.
import { MATTER_TYPE_OPTIONS, type MatterType } from "@/lib/matters/matter-types";
import { contactLabel } from "@/lib/matters/contact-input";
import type { MatterContactsRead } from "@/lib/matters/contacts";
import { NOTE_KIND_OPTIONS } from "@/lib/pipeline/lead-input";
import { Err, Field, RowButton, type Action } from "./MatterForms";

// ── Header ────────────────────────────────────────────────────────────────────

export type HeaderValues = {
  title: string | null;
  packageName: string | null;
  type: MatterType;
  referralSource: string | null;
};

/** "Edit details" under the matter title: title, package, type and where the matter came from. */
export function HeaderEditForm({ matterId, values: v }: { matterId: string; values: HeaderValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateMatterHeaderAction, {});
  const isLitigation = v.type === "LIT";
  // Litigation keeps its own case number and case details, so it is never offered as a change.
  const options = MATTER_TYPE_OPTIONS.filter((o) => (isLitigation ? o.value === "LIT" : o.value !== "LIT"));
  return (
    <details className="lx-disclosure-inline" style={{ marginTop: 10 }}>
      <summary>Edit details</summary>
      <form action={action} className="lx-form-grid">
        <input type="hidden" name="matterId" value={matterId} />
        <Field name="title" label="Title" defaultValue={v.title} placeholder="Optional" />
        <Field name="packageName" label="Package" defaultValue={v.packageName} placeholder="Optional" />
        <label className="lx-field">
          <span className="lx-label">Matter type</span>
          <select name="type" className="lx-input" defaultValue={v.type}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Field name="referralSource" label="Came from" defaultValue={v.referralSource} placeholder="Optional" />
        <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
          {isLitigation
            ? "Litigation matters keep their case number and case details, so the type can't be changed."
            : "Changing the type keeps the matter number as it is. A matter can't be changed to Litigation."}
        </p>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </button>
          {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
          <Err state={state} />
        </div>
      </form>
    </details>
  );
}

// ── Client contact card ───────────────────────────────────────────────────────

function roleLabel(role: string): string {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Contact";
}

function Msg({ state }: { state: MessageActionState }) {
  return state.saved && state.message ? (
    <p role="status" className="lx-note" style={{ color: "var(--ok)", margin: 0 }}>
      {state.message}
    </p>
  ) : null;
}

/**
 * The matter's linked contacts, in three states: listed, "No contact linked
 * yet." (the read worked and found none) and a warning when the read failed. A
 * read-only role gets the card with no controls.
 */
export function ClientContactCard({ matterId, read, canWrite }: { matterId: string; read: MatterContactsRead; canWrite: boolean }) {
  return (
    <section className="lx-card lx-aside">
      <div className="lx-label">Client contact</div>
      {read.status === "unavailable" ? (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          The client contact couldn&apos;t be loaded. This is a problem reaching the database, not an empty card.
        </p>
      ) : read.status === "none" ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No contact linked yet.
        </p>
      ) : (
        read.contacts.map((c) => (
          <div key={c.link_id} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <b>{contactLabel(c)}</b>
              <span className="lx-pill lx-pill-mute">{roleLabel(c.role)}</span>
            </div>
            <div className="lx-meta">
              <span>Email</span>
              <span>{c.email ?? "—"}</span>
            </div>
            <div className="lx-meta">
              <span>Phone</span>
              <span>{c.phone ?? "—"}</span>
            </div>
            <div className="lx-meta">
              <span>Company</span>
              <span>{c.company_name ?? "—"}</span>
            </div>
            {canWrite && (
              <ContactEditForm
                matterId={matterId}
                contactId={c.id}
                values={{ firstName: c.first_name, lastName: c.last_name, email: c.email, phone: c.phone, companyName: c.company_name }}
              />
            )}
          </div>
        ))
      )}
      {canWrite && <ContactLinker matterId={matterId} />}
    </section>
  );
}

export type ContactValues = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
};

/** Edits a linked contact. A contact is one shared record, and the form says so. */
export function ContactEditForm({ matterId, contactId, values: v }: { matterId: string; contactId: string; values: ContactValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(editContactAction, {});
  return (
    <details className="lx-disclosure-inline">
      <summary>Edit</summary>
      <form action={action} className="lx-form-grid">
        <input type="hidden" name="matterId" value={matterId} />
        <input type="hidden" name="contactId" value={contactId} />
        <Field name="firstName" label="First name" defaultValue={v.firstName} />
        <Field name="lastName" label="Last name" defaultValue={v.lastName} />
        <Field name="email" label="Email" type="email" defaultValue={v.email} />
        <Field name="phone" label="Phone" type="tel" defaultValue={v.phone} />
        <Field name="companyName" label="Company" defaultValue={v.companyName} wide />
        <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
          This contact is one shared record. A change here shows on every matter they are linked to.
        </p>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Save contact"}
          </button>
          {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
          <Err state={state} />
        </div>
      </form>
    </details>
  );
}

function LinkContactButton({ matterId, contactId, name }: { matterId: string; contactId: string; name: string }) {
  const [state, action, pending] = useActionState<MessageActionState, FormData>(linkContactAction, {});
  return (
    <form action={action} className="lx-inline-form">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="contactId" value={contactId} />
      {state.saved ? (
        <span className="lx-note" style={{ color: "var(--ok)" }}>
          {state.message}
        </span>
      ) : (
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending} aria-label={`Link ${name}`}>
          {pending ? "Linking…" : "Link"}
        </button>
      )}
      <Err state={state} />
    </form>
  );
}

/** "Link or add contact": search this firm's contacts and link one, or add a new contact. */
export function ContactLinker({ matterId }: { matterId: string }) {
  const [search, searchAction, searching] = useActionState<ContactSearchState, FormData>(searchContactsAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [added, addAction, adding] = useActionState<MessageActionState, FormData>(async (prev, fd) => {
    const res = await addContactAction(prev, fd);
    if (!res.error) formRef.current?.reset();
    return res;
  }, {});
  return (
    <details className="lx-disclosure-inline">
      <summary>Link or add contact</summary>
      <div style={{ display: "grid", gap: 14 }}>
        <form action={searchAction} style={{ display: "grid", gap: 8 }}>
          <input type="hidden" name="matterId" value={matterId} />
          <div style={{ display: "flex", gap: 8 }}>
            <input className="lx-input" name="q" placeholder="Search by name or email" aria-label="Search contacts" style={{ flex: 1, minWidth: 0 }} />
            <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {search.error && (
            <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
              {search.error}
            </p>
          )}
          {search.tooShort && (
            <p className="lx-note" style={{ margin: 0 }}>
              Type at least 2 characters to search.
            </p>
          )}
          {search.hits && search.hits.length === 0 && !search.tooShort && (
            <p className="lx-note" style={{ margin: 0 }}>
              No contacts match. Add a new contact below.
            </p>
          )}
        </form>
        {search.hits && search.hits.length > 0 && (
          <ul className="lx-list">
            {search.hits.map((h) => (
              <li key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>
                  <b>{h.name}</b>
                  <span className="lx-note" style={{ display: "block", overflowWrap: "anywhere" }}>
                    {[h.email, h.phone].filter(Boolean).join(" · ") || "No email or phone"}
                  </span>
                </span>
                {h.linked ? <span className="lx-pill lx-pill-mute">Already linked</span> : <LinkContactButton matterId={matterId} contactId={h.id} name={h.name} />}
              </li>
            ))}
          </ul>
        )}
        <form ref={formRef} action={addAction} className="lx-form-grid">
          <input type="hidden" name="matterId" value={matterId} />
          <div className="lx-label" style={{ gridColumn: "1 / -1" }}>
            Add a new contact
          </div>
          <Field name="firstName" label="First name" />
          <Field name="lastName" label="Last name" />
          <Field name="businessName" label="Business name" />
          <Field name="email" label="Email" type="email" />
          <Field name="phone" label="Phone" type="tel" />
          <Field name="companyName" label="Company" />
          <div style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={adding}>
                {adding ? "Adding…" : "Add and link contact"}
              </button>
              <span className="lx-note">Links as the client. Sends nothing.</span>
            </div>
            <Msg state={added} />
            <Err state={added} />
          </div>
        </form>
      </div>
    </details>
  );
}

// ── Timeline composer ─────────────────────────────────────────────────────────

/** Note / Call / Email (logged) / Meeting, on the matter timeline. Records what happened; sends nothing. */
export function MatterNoteComposer({ matterId }: { matterId: string }) {
  const [kind, setKind] = useState("note");
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const res = await addMatterNoteAction(prev, fd);
    if (!res.error) (document.getElementById("lx-matter-note-body") as HTMLTextAreaElement | null)?.form?.reset();
    return res;
  }, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="matterId" value={matterId} />
      <div className="lx-segs" role="radiogroup" aria-label="Entry type">
        {NOTE_KIND_OPTIONS.map(([k, label]) => (
          <label key={k} className={kind === k ? "on" : undefined}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="lx-sr" />
            {label}
          </label>
        ))}
      </div>
      {kind === "email_sent" && <input className="lx-input" name="subject" placeholder="Subject" aria-label="Subject" />}
      <textarea id="lx-matter-note-body" className="lx-input" name="body" rows={3} placeholder="What happened?" aria-label="What happened" />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Add to timeline"}
        </button>
        <span className="lx-note">Records something that happened. Nothing is sent.</span>
      </div>
      <Err state={state} />
    </form>
  );
}

// ── Deleting, with a second click ─────────────────────────────────────────────

/**
 * A Delete button that asks first. The first click shows what will be deleted
 * and a "Yes, delete" button; nothing is removed until that second click.
 * `defaultOpen` shows the question straight away (used by the render tests).
 */
export function ConfirmDelete(props: { action: Action; hidden: Record<string, string>; question: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(props.action, {});
  if (!open) {
    return (
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(true)}>
        Delete
      </button>
    );
  }
  return (
    <form action={formAction} className="lx-inline-form" style={{ flexWrap: "wrap" }}>
      {Object.entries(props.hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <span className="lx-note" style={{ color: "var(--ink)" }}>
        {props.question}
      </span>
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" style={{ color: "var(--wine)" }} disabled={pending}>
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </button>
      <Err state={state} />
    </form>
  );
}

// ── Deadlines ─────────────────────────────────────────────────────────────────

/** Edit an open deadline's title and date. Moving a confirmed date clears the confirmation, and says so. */
export function DeadlineEdit(props: {
  matterId: string;
  deadlineId: string;
  title: string | null;
  dueDate: string;
  confirmed: boolean;
  defaultOpen?: boolean;
}) {
  const [editing, setEditing] = useState(props.defaultOpen ?? false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateDeadlineAction, {});
  if (!editing) {
    return (
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setEditing(true)}>
        Edit
      </button>
    );
  }
  return (
    <form action={action} className="lx-form-grid" style={{ flexBasis: "100%" }}>
      <input type="hidden" name="matterId" value={props.matterId} />
      <input type="hidden" name="deadlineId" value={props.deadlineId} />
      <Field name="title" label="Title" defaultValue={props.title} placeholder="Optional" />
      <label className="lx-field">
        <span className="lx-label">Due</span>
        <input className="lx-input" type="date" name="dueDate" defaultValue={props.dueDate} required />
      </label>
      {props.confirmed && (
        <p className="lx-banner lx-banner-warn" style={{ gridColumn: "1 / -1", margin: 0 }}>
          An attorney has confirmed this date. If you move it, the attorney will need to confirm it again.
        </p>
      )}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save deadline"}
        </button>
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
        <Err state={state} />
      </div>
    </form>
  );
}

/** Delete, for an unconfirmed deadline and a viewer allowed to (the page decides). */
export function DeadlineDelete(props: { matterId: string; deadlineId: string; label: string; dueDate: string; defaultOpen?: boolean }) {
  return (
    <ConfirmDelete
      action={deleteDeadlineAction}
      hidden={{ matterId: props.matterId, deadlineId: props.deadlineId }}
      question={`Delete this deadline? ${props.label}, due ${props.dueDate}, will be removed from the docket.`}
      defaultOpen={props.defaultOpen}
    />
  );
}

/** The controls on a closed deadline's row: Reopen, and Delete where the viewer may. */
export function ClosedDeadlineActions(props: {
  matterId: string;
  deadlineId: string;
  label: string;
  dueDate: string;
  canDelete: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <RowButton action={reopenDeadlineAction} hidden={{ matterId: props.matterId, deadlineId: props.deadlineId }} label="Reopen" />
      {props.canDelete && <DeadlineDelete matterId={props.matterId} deadlineId={props.deadlineId} label={props.label} dueDate={props.dueDate} />}
    </span>
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskItem = { id: string; title: string; dueDate: string | null; assigneeId: string | null };

/**
 * Edit and Delete for one open task. `members` is null when the team list
 * couldn't be read: the assignee choice is then left out (it would refuse to
 * save anyway) and the form says why.
 */
export function TaskControls(props: {
  matterId: string;
  task: TaskItem;
  members: { userId: string; name: string }[] | null;
  defaultOpen?: boolean;
}) {
  const { task } = props;
  const [editing, setEditing] = useState(props.defaultOpen ?? false);
  const [state, action, pending] = useActionState<ActionState, FormData>(updateTaskAction, {});
  return (
    <div className="lx-row-actions">
      {editing ? (
        <form action={action} style={{ display: "grid", gap: 8, flexBasis: "100%" }}>
          <input type="hidden" name="matterId" value={props.matterId} />
          <input type="hidden" name="taskId" value={task.id} />
          <input className="lx-input" name="title" defaultValue={task.title} aria-label="Task title" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="lx-input" type="date" name="dueAt" defaultValue={task.dueDate ?? ""} aria-label="Task due date" style={{ width: "auto" }} />
            {props.members ? (
              <select className="lx-input" name="assigneeId" defaultValue={task.assigneeId ?? ""} aria-label="Assign to" style={{ flex: 1, minWidth: 140 }}>
                <option value="">Unassigned</option>
                {props.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="lx-note">The team list couldn&apos;t be loaded, so this task can&apos;t be reassigned right now.</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
              {pending ? "Saving…" : "Save task"}
            </button>
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
            <Err state={state} />
          </div>
        </form>
      ) : (
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
      <ConfirmDelete action={deleteTaskAction} hidden={{ matterId: props.matterId, taskId: task.id }} question={`Delete the task "${task.title}"?`} />
    </div>
  );
}
