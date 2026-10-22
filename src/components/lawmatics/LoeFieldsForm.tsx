"use client";

import { saveLoeFieldsAction } from "@/app/dashboard/settings/integrations/lawmatics/loe-fields-actions";
import { ActionForm, Outcome } from "@/components/proposal-editor/ActionForm";
import { LOE_FIELD_NAMES } from "@/lib/proposals/loe-adapter";
import type { LoeFieldsConfig } from "@/lib/proposals/loe-fields";
import type { LawmaticsFieldOption } from "@/lib/proposals/loe-fields-load";

/**
 * The "LOE fields" setting: match each of the six names to one of the firm's own Lawmatics
 * custom fields, and switch writing them on or off. When the Lawmatics list couldn't be loaded
 * (`options` null) the saved matches are listed as they are and kept: only the switch can change.
 */
export function LoeFieldsForm({ config, options }: { config: LoeFieldsConfig; options: LawmaticsFieldOption[] | null }) {
  return (
    <ActionForm action={saveLoeFieldsAction} className="pe-fieldset">
      {({ state, pending }) => (
        <>
          <label className="pe-check">
            <input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Write these fields to the matter when a proposal is marked paid
          </label>
          {options === null && <input type="hidden" name="mapping" value="keep" />}
          <div className="pe-rows">
            {LOE_FIELD_NAMES.map((name) => {
              const saved = config.map[name] ?? "";
              const listed = options?.some((o) => o.id === saved) ?? false;
              return (
                <label key={name} className="lx-field">
                  <span className="lx-label">{name}</span>
                  {options === null ? (
                    <span className="lx-note">{saved ? `Matched to field ${saved}` : "Not matched"}</span>
                  ) : (
                    <select name={`map.${name}`} className="lx-input" defaultValue={saved}>
                      <option value="">Not matched</option>
                      {saved && !listed && <option value={saved}>{`Field ${saved} (no longer in the list)`}</option>}
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
          </div>
          <div className="pe-save">
            <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            <Outcome state={state} pending={pending} />
          </div>
        </>
      )}
    </ActionForm>
  );
}
