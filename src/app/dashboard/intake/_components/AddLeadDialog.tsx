"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { memberLabel, stageCodeFor, stageLabelFor } from "@/lib/intake/views";
import { createLeadAction, type CreateLeadState } from "@/app/dashboard/leads/actions";
import { PRIMARY_BUTTON } from "./styles";

const fieldStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "inherit",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  width: "100%",
  boxSizing: "border-box",
};

function Field({
  label,
  name,
  error,
  defaultValue,
  required,
  type = "text",
  autoFocus,
}: {
  label: string;
  name: string;
  error?: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
  autoFocus?: boolean;
}) {
  const errorId = `add-lead-${name}-error`;
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span className="intake-eyebrow">
        {label}
        {required && <span aria-hidden> *</span>}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        style={{ ...fieldStyle, borderColor: error ? "var(--crit)" : "var(--line)" }}
      />
      {error && (
        <span id={errorId} style={{ fontSize: 11.5, color: "var(--crit)" }}>
          {error}
        </span>
      )}
    </label>
  );
}

/**
 * "Add a lead" (canvas 10a–10c) — the product's front door, in the intake skin.
 *
 * It posts to the SAME `createLeadAction` the pipeline board's dialog uses, so
 * there is one validated, role-gated, RLS-scoped write path for a new lead and
 * not a second one that will drift. What is not shared is the chrome: that
 * dialog is written in the `--rpb-*` tokens, which are defined under
 * `.rpb-root` and so resolve to nothing inside `.intake-root`.
 *
 * A rejected submit comes back with per-field messages and the values the user
 * typed, so nothing they entered is lost.
 */
export default function AddLeadDialog({
  stages,
  members,
}: {
  /** Intake stages, in order. "First stage" leaves the choice to the data layer. */
  stages: Stage[];
  members: MemberIdentity[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CreateLeadState, FormData>(createLeadAction, {});
  const router = useRouter();

  // Collapse the moment a submit comes back successful — React's documented
  // "adjust state while rendering" pattern, against the previously-seen state
  // object, so it fires once per successful create and doesn't fight the user
  // reopening the dialog. Same approach as the pipeline's NewLeadDialog.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.ok) setOpen(false);
  }

  // Navigation IS an external system, so it belongs in an effect: after a
  // create, go straight to the new lead — working it is the next thing anyone
  // wants.
  useEffect(() => {
    if (state.ok && state.leadId) router.push(`/dashboard/leads/${state.leadId}`);
  }, [state.ok, state.leadId, router]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <>
      <button
        type="button"
        style={PRIMARY_BUTTON}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Add a lead
      </button>

      {open && (
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(20,4,8,.34)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "6vh 16px 16px",
            overflowY: "auto",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add a lead"
            style={{
              width: "min(520px, 100%)",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 14,
              boxShadow: "var(--shadow)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div>
              <h2 className="intake-serif" style={{ margin: 0, fontSize: 26, lineHeight: 1.1 }}>
                Add a lead
              </h2>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.5 }}>
                Someone who has reached out but isn&apos;t a client yet. They land in intake and
                show up on this list straight away.
              </p>
            </div>

            <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                <Field
                  label="First name"
                  name="firstName"
                  required
                  autoFocus
                  defaultValue={values.firstName}
                  error={errors.firstName}
                />
                <Field
                  label="Last name"
                  name="lastName"
                  required
                  defaultValue={values.lastName}
                  error={errors.lastName}
                />
                <Field
                  label="Email"
                  name="email"
                  type="email"
                  required
                  defaultValue={values.email}
                  error={errors.email}
                />
                <Field label="Phone" name="phone" defaultValue={values.phone} error={errors.phone} />
                <Field
                  label="Business"
                  name="businessName"
                  defaultValue={values.businessName}
                  error={errors.businessName}
                />
                <Field
                  label="Website"
                  name="website"
                  defaultValue={values.website}
                  error={errors.website}
                />

                <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
                  <span className="intake-eyebrow">Stage</span>
                  <select name="currentStageId" defaultValue={values.currentStageId ?? ""} style={fieldStyle}>
                    <option value="">First stage</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stageCodeFor(stage)} · {stageLabelFor(stage)}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
                  <span className="intake-eyebrow">Owner</span>
                  <select name="assignedTo" defaultValue={values.assignedTo ?? ""} style={fieldStyle}>
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {memberLabel(member)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {state.error && (
                <p
                  role="status"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--crit)",
                    background: "var(--critbg)",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  {state.error}
                </p>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{
                    height: 36,
                    padding: "0 14px",
                    borderRadius: 9,
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    color: "var(--ink2)",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  style={{ ...PRIMARY_BUTTON, opacity: pending ? 0.6 : 1 }}
                >
                  {pending ? "Adding…" : "Add lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
