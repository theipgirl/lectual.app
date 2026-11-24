import type { ColumnsSettingsState, SettingsField } from "@/lib/custom-columns/settings-load";
import { CUSTOM_KIND_WORDS } from "@/lib/review/sheet-columns";
import {
  CANT_SHOW,
  COLUMNS_ADD,
  COLUMNS_AT_LIMIT,
  COLUMNS_NONE,
  COLUMNS_SETTINGS_NAME,
  CUSTOM_COLUMNS_NOT_READY,
  CUSTOM_SECTION_WORDS,
  archivedHeading,
  archivedShownNote,
  columnsCount,
} from "@/lib/ui/words";
import { AddColumnForm, ArchiveColumn, ChoicesForm, MoveColumn, RenameForm, RestoreColumn } from "./ColumnsSettingsForms";
import "./columns-settings.css";

/**
 * Settings -> Columns' body, drawn from props only (the page gates the role, reads, and draws the one h1). Three states, never two: not
 * switched on (the sentence, no form, no alert), couldn't load (an alert, no form), and the firm's ONE list of live columns in List
 * order, then the archived ones, then "Add a column". `initialConfirm` opens one Archive question (a test or preview).
 */
export function ColumnsSettings({ state, initialConfirm }: { state: ColumnsSettingsState; initialConfirm?: string }) {
  if (state.status === "not-set-up") {
    return (
      <p className="lx-note cs-note">{CUSTOM_COLUMNS_NOT_READY}</p>
    );
  }
  if (state.status === "unavailable") {
    return (
      <p className="lx-note cs-note" role="alert">
        {CANT_SHOW}
      </p>
    );
  }
  const { live, archived, use } = state;
  return (
    <>
      <p className="lx-note cs-note" data-columns-count="">
        {columnsCount(live.length)}
      </p>
      <section className="lx-card cs-card" aria-label={COLUMNS_SETTINGS_NAME}>
        {live.length === 0 ? (
          <p className="lx-note cs-note">{COLUMNS_NONE}</p>
        ) : (
          <ol className="cs-list">
            {live.map((f, i) => (
              <li key={f.id} className="cs-row" data-column-row={f.id}>
                <ColumnFacts field={f} />
                <div className="cs-acts">
                  <MoveColumn id={f.id} label={f.label} first={i === 0} last={i === live.length - 1} />
                  <RenameForm id={f.id} label={f.label} updatedAt={f.updatedAt} />
                  {f.kind === "choice" && (
                    <ChoicesForm id={f.id} label={f.label} options={f.options} updatedAt={f.updatedAt} use={use.status === "ok" ? (use.counts[f.id] ?? {}) : null} />
                  )}
                  <ArchiveColumn id={f.id} label={f.label} initial={initialConfirm === f.id ? "asking" : "idle"} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      {archived.length > 0 && (
        <details className="lx-card cs-card cs-archived">
          <summary className="cs-summary">{archivedHeading(archived.length)}</summary>
          {state.archivedMore && <p className="lx-note cs-note" data-archived-more="">{archivedShownNote(archived.length)}</p>}
          <ol className="cs-list">
            {archived.map((f) => (
              <li key={f.id} className="cs-row" data-column-row={f.id}>
                <ColumnFacts field={f} />
                <div className="cs-acts">
                  <RestoreColumn id={f.id} label={f.label} />
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}
      <section className="lx-card cs-card" aria-labelledby="cs-add-title">
        <h2 id="cs-add-title" className="lx-h3 cs-h">
          {COLUMNS_ADD}
        </h2>
        {live.length >= 40 ? <p className="lx-note cs-note">{COLUMNS_AT_LIMIT}</p> : <AddColumnForm />}
      </section>
    </>
  );
}

function ColumnFacts({ field }: { field: SettingsField }) {
  return (
    <div className="cs-facts">
      <span className="cs-label">{field.label}</span>
      <span className="lx-note cs-meta">
        {CUSTOM_SECTION_WORDS[field.section]} · {CUSTOM_KIND_WORDS[field.kind]}
      </span>
      {field.kind === "choice" && <span className="lx-note cs-choices">{field.options.join(", ")}</span>}
    </div>
  );
}
