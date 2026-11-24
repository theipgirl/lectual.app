"use client";

import Popover from "@/components/list-page/Popover";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";
import type { PrefsAction, SectionPrefs, SheetColumn, SheetSectionId } from "@/lib/review/sheet-columns";
import { COLUMNS_ALWAYS_SHOWN, COLUMNS_BUTTON, COLUMNS_KEPT_HERE, COLUMNS_MENU_LABEL, COLUMNS_MOVE_DOWN, COLUMNS_MOVE_UP, COLUMNS_RESET, columnsMoveDown, columnsMoveUp, columnsSectionLabel, columnsShow } from "@/lib/ui/words";
import { useColumnPrefs } from "./use-column-prefs";

export type ChooserSection = { id: SheetSectionId; title: string; /** What `columnsFor` allowed this viewer, in default order. */ columns: SheetColumn[] };

/** One section's rows. Presentational: the prefs and the callbacks come from outside, so a test can draw any state. */
export function ColumnChooserSection({ title, columns, prefs, onChange }: { title: string; columns: readonly SheetColumn[]; prefs: SectionPrefs; onChange: (action: PrefsAction) => void }) {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const order = prefs.order.map((id) => byId.get(id)).filter((c): c is SheetColumn => !!c);
  return (
    <fieldset className="rv-cols-sec" data-section-columns={title}>
      <legend className="rv-cols-legend">{columnsSectionLabel(title)}</legend>
      <ul className="rv-cols-list">
        {order.map((c, i) => {
          const hidden = prefs.hidden.includes(c.id);
          return (
            <li key={c.id} className="rv-cols-row" data-column={c.id}>
              {c.pinned ? (
                <span className="rv-cols-name">
                  {c.header} <span className="lx-note">{COLUMNS_ALWAYS_SHOWN}</span>
                </span>
              ) : (
                <>
                  <label className="rv-cols-name">
                    <input type="checkbox" checked={!hidden} onChange={() => onChange({ type: "toggle", id: c.id })} aria-label={columnsShow(c.header)} /> {c.header}
                    {c.kind && c.title ? (
                      <>
                        {" "}
                        <span className="lx-note" data-column-kind={c.kind}>
                          {c.title}
                        </span>
                      </>
                    ) : null}
                  </label>
                  <span className="rv-cols-moves">
                    <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" aria-label={columnsMoveUp(c.header)} disabled={i <= 1} onClick={() => onChange({ type: "move", id: c.id, dir: -1 })}>
                      {COLUMNS_MOVE_UP}
                    </button>
                    <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" aria-label={columnsMoveDown(c.header)} disabled={i >= order.length - 1} onClick={() => onChange({ type: "move", id: c.id, dir: 1 })}>
                      {COLUMNS_MOVE_DOWN}
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => onChange({ type: "reset" })}>
        {COLUMNS_RESET}
      </button>
    </fieldset>
  );
}

function Section({ section, initial }: { section: ChooserSection; initial?: PrefsDocument }) {
  const { prefs, change } = useColumnPrefs(section.id, section.columns, initial);
  return <ColumnChooserSection title={section.title} columns={section.columns} prefs={prefs} onChange={change} />;
}

/** The panel's contents, drawn in the shared Popover below and drawn directly by a test (a static render never opens a popover). */
export function ColumnChooserPanel({ sections, initial }: { sections: readonly ChooserSection[]; initial?: PrefsDocument }) {
  return (
    <div className="rv-cols-panel">
      {sections.map((s) => (
        <Section key={s.id} section={s} initial={initial} />
      ))}
      <p className="lx-note rv-cols-note">{COLUMNS_KEPT_HERE}</p>
    </div>
  );
}

/** "Columns" in the List's toolbar: which columns to show and in what order, per section, for this browser only. */
export function ColumnChooser({ sections }: { sections: readonly ChooserSection[] }) {
  return (
    <Popover
      label={COLUMNS_MENU_LABEL}
      align="right"
      width={340}
      trigger={(p) => (
        <button type="button" className="lx-btn lx-btn-sec" ref={p.ref} onClick={p.onClick} aria-haspopup={p["aria-haspopup"]} aria-expanded={p["aria-expanded"]} aria-controls={p["aria-controls"]} aria-label={p["aria-label"]}>
          {COLUMNS_BUTTON}
        </button>
      )}
    >
      {() => <ColumnChooserPanel sections={sections} />}
    </Popover>
  );
}

