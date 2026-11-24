"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Stage } from "@/lib/pipeline";
import type { MemberIdentity } from "@/lib/members/directory";
import { memberLabel, stageCodeFor, stageLabelFor } from "@/lib/intake/views";
import { createLeadAction, type CreateLeadState } from "@/app/dashboard/leads/actions";
import { ButtonLabel } from "@/components/list-page/ListToolbar";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { ADD_A_LEAD, CANCEL, OWNER_COLUMN, SAVING, UNASSIGNED } from "@/lib/ui/words";

function TextField({
  label,
  name,
  error,
  defaultValue,
  optional,
  type = "text",
  inputRef,
}: {
  label: string;
  name: string;
  error?: string;
  defaultValue?: string;
  optional?: boolean;
  type?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const errorId = `add-lead-${name}-error`;
  return (
    <Field
      label={label}
      optional={optional}
      hint={
        error ? (
          <span id={errorId} className="ix-field-error">
            {error}
          </span>
        ) : undefined
      }
    >
      <input
        ref={inputRef}
        name={name}
        type={type}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="lx-input"
      />
    </Field>
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
  const firstRef = useRef<HTMLInputElement>(null);

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

  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <>
      <button
        type="button"
        className="lp-btn lp-btn-primary"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ADD_A_LEAD}
      >
        <ButtonLabel icon="+" label={ADD_A_LEAD} short="Add" />
      </button>

      {open && (
        <Dialog
          title={ADD_A_LEAD}
          titleId="add-lead-title"
          describedById="add-lead-about"
          onClose={() => setOpen(false)}
          initialFocus={firstRef}
          footer={
            <>
              <button type="button" className="lx-btn lx-btn-sec" onClick={() => setOpen(false)}>
                {CANCEL}
              </button>
              <button type="submit" form="add-lead-form" disabled={pending} className="lx-btn lx-btn-pri">
                {pending ? SAVING : ADD_A_LEAD}
              </button>
            </>
          }
        >
          <p id="add-lead-about" className="lx-note">
            Someone who has reached out but isn&apos;t a client yet. They land in intake and show up on this list straight away.
          </p>

          <form id="add-lead-form" action={action} className="ix-add-form">
            <div className="ix-add-grid">
              <TextField label="First name" name="firstName" inputRef={firstRef} defaultValue={values.firstName} error={errors.firstName} />
              <TextField label="Last name" name="lastName" defaultValue={values.lastName} error={errors.lastName} />
              <TextField label="Email" name="email" type="email" defaultValue={values.email} error={errors.email} />
              <TextField label="Phone" name="phone" optional defaultValue={values.phone} error={errors.phone} />
              <TextField label="Business" name="businessName" optional defaultValue={values.businessName} error={errors.businessName} />
              <TextField label="Website" name="website" optional defaultValue={values.website} error={errors.website} />

              <Field label="Stage">
                <select name="currentStageId" defaultValue={values.currentStageId ?? ""} className="lx-input">
                  <option value="">First stage</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stageCodeFor(stage)} · {stageLabelFor(stage)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={OWNER_COLUMN}>
                <select name="assignedTo" defaultValue={values.assignedTo ?? ""} className="lx-input">
                  <option value="">{UNASSIGNED}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {memberLabel(member)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {state.error && (
              <Notice tone="risk" role="status">
                {state.error}
              </Notice>
            )}
          </form>
        </Dialog>
      )}
    </>
  );
}
