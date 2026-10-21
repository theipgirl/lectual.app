import { toggleLabel } from "@/lib/intake-forms/choice";

/**
 * One choice control for every place a choice question is drawn: the public
 * form, the conversation, the matter request form, the assessment's extra
 * questions and the editor's live preview. Native radios (single choice) and
 * checkboxes (multi choice) inside labels, so a keyboard and a screen reader
 * work with no extra code. No hooks: its state comes in as props, so it
 * renders the same on the server and is checked with a static render.
 *
 * The browser sends LABELS back, not positions; the server matches each one
 * against the stored question's options (public-submit.ts / choice.ts).
 */

export type ChoiceControlProps = {
  name: string;
  type: "single" | "multi";
  options: readonly string[];
  /** The labels chosen now. */
  value: readonly string[];
  /** Called with the new chosen labels. Absent in the editor's preview, which only draws. */
  onChange?: (next: string[]) => void;
  /**
   * Single choice only: the person confirmed the option, by tapping or clicking it, or by pressing Enter on it.
   * Arrow keys and Space only select (onChange), so a keyboard user can reach every option before going on.
   */
  onCommit?: (next: string[]) => void;
  /** The question, for the group's accessible name. */
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  /** "chat" lays the options out as tappable bubbles in the thread. */
  layout?: "form" | "chat";
  /** "preview" uses the editor preview's classes; the public page uses its own. */
  scope?: "public" | "preview";
};

const noop = () => {};

export function ChoiceControl(props: ChoiceControlProps) {
  const { name, type, options, value, onChange, onCommit, label, invalid, disabled, layout = "form", scope = "public" } = props;
  const root = scope === "preview" ? "ifm-pv-choice" : "ipub-choice";
  const single = type === "single";
  return (
    <div
      className={`${root}${layout === "chat" ? " chat" : ""}${invalid ? " bad" : ""}`}
      role={single ? "radiogroup" : "group"}
      aria-label={label}
      aria-invalid={invalid || undefined}
    >
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <label
            key={o}
            className={`${root}-opt${on ? " on" : ""}`}
            // The commit lives on the label: a tap or click on the option's text or padding reaches the radio as a click
            // forwarded by the browser with detail 0, so only the label sees the pointer's own click (detail > 0).
            // Arrow keys and Space click the radio itself and never reach here with a pointer, so they only select.
            onClick={single && onCommit ? (e) => { if (e.detail > 0) onCommit([o]); } : undefined}
          >
            <input
              type={single ? "radio" : "checkbox"}
              name={name}
              value={o}
              checked={on}
              disabled={disabled}
              // A radio's click fires for the option already chosen too, which "tap to go on" needs. It only selects:
              // committing is the label's job (above), since a label click forwarded to the radio carries detail 0.
              onClick={single && onChange ? () => onChange([o]) : undefined}
              onKeyDown={
                single && onCommit
                  ? (e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      onChange?.([o]);
                      onCommit([o]);
                    }
                  : undefined
              }
              onChange={single ? noop : () => onChange?.(toggleLabel(options, value, o))}
            />
            <span>{o}</span>
          </label>
        );
      })}
    </div>
  );
}
