"use client";

import { useActionState, useState } from "react";
import { SIGNAL_IDS, SIGNAL_LABEL, type SignalId } from "@/lib/stage-keeper/signals";
import { createBrainEntryAction, type ActionState } from "../actions";
import { ENTRY_TYPES, type EntryTypeValue } from "../enums";

export type StageChoice = { id: string; name: string };

/**
 * Collapsible "New entry" form, admin-only (rendered by the page). The person picks a plain Type; the
 * action maps it to a category and makes the key. A stage rule chooses what happened and which of the
 * firm's stages it means from lists, so nothing the Stage Keeper reads is ever typed.
 * `stages` is null when the firm's stages could not be read.
 */
export default function NewEntryForm({
  stages,
  ruledSignals = [],
}: {
  stages: StageChoice[] | null;
  ruledSignals?: SignalId[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(createBrainEntryAction, {});
  const [type, setType] = useState<EntryTypeValue | "">("");
  const isStageRule = type === "stage_rules";
  const stageRulesOff = stages === null || stages.length === 0;

  return (
    <details className="lx-card lx-disclosure">
      <summary>New entry</summary>
      <form action={formAction} className="lx-brain-form">
        <label className="lx-field">
          <span className="lx-label">Type</span>
          <select
            name="entryType"
            required
            value={type}
            onChange={(e) => setType(e.target.value as EntryTypeValue)}
            className="lx-input"
          >
            <option value="" disabled>
              Choose a type…
            </option>
            {ENTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value} disabled={t.value === "stage_rules" && stageRulesOff}>
                {t.label}
              </option>
            ))}
          </select>
          {stageRulesOff && (
            <span className="lx-note">
              {stages === null
                ? "Stage rules are unavailable because your stages couldn't be loaded."
                : "Stage rules are unavailable because your firm has no stages yet."}
            </span>
          )}
        </label>

        {isStageRule && (
          <>
            <label className="lx-field">
              <span className="lx-label">When this happens</span>
              <select name="signal" required defaultValue="" className="lx-input">
                <option value="" disabled>
                  Choose what happened…
                </option>
                {SIGNAL_IDS.map((id) => (
                  <option key={id} value={id} disabled={ruledSignals.includes(id)}>
                    {SIGNAL_LABEL[id]}
                    {ruledSignals.includes(id) ? " (already has a rule)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="lx-field">
              <span className="lx-label">Use this stage</span>
              <select name="stageId" required defaultValue="" className="lx-input">
                <option value="" disabled>
                  Choose a stage…
                </option>
                {(stages ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="lx-field">
          <span className="lx-label">Title{isStageRule ? " (optional)" : ""}</span>
          <input
            name="title"
            type="text"
            required={!isStageRule}
            placeholder={isStageRule ? "Left blank, it is named after the rule" : "e.g. Brand voice — tone"}
            className="lx-input"
          />
        </label>

        {!isStageRule && (
          <label className="lx-field">
            <span className="lx-label">Body</span>
            <textarea name="body" rows={4} placeholder="Notes, guidance, or a template body…" className="lx-input" />
          </label>
        )}

        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending} style={{ justifySelf: "start" }}>
          {pending ? "Creating…" : "Create entry"}
        </button>

        {state.error && <p role="alert" className="lx-brain-error">{state.error}</p>}
      </form>
    </details>
  );
}
