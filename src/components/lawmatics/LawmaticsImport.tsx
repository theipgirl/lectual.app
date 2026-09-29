"use client";

import { useActionState, type ReactNode } from "react";
import {
  applyMattersImportAction,
  connectLawmaticsAction,
  disconnectLawmaticsAction,
  importAction,
  previewMattersImportAction,
  type ConnectState,
  type ImportState,
  type MattersImportState,
  type PreviewView,
} from "@/app/dashboard/settings/integrations/lawmatics/actions";

const IDLE: ImportState = { phase: "idle" };
const MATTERS_IDLE: MattersImportState = { phase: "idle" };

function Err({ text }: { text?: string }) {
  return text ? (
    <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
      {text}
    </p>
  ) : null;
}

function name(first?: string | null, last?: string | null, fallback?: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || fallback || "Unnamed";
}

// ── Connect ─────────────────────────────────────────────────────────────────

export function ConnectLawmatics({ reconnect }: { reconnect: boolean }) {
  const [state, action, pending] = useActionState<ConnectState, FormData>(connectLawmaticsAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <label className="lx-field">
        <span className="lx-label">Lawmatics API token</span>
        <input
          className="lx-input"
          name="token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the token from Lawmatics"
          required
        />
      </label>
      <p className="lx-note" style={{ margin: 0 }}>
        We check the token with one read-only request, then store it encrypted. No one at your firm can see it again, including you.
        Lectual only ever reads from Lawmatics; it never changes anything there.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Checking…" : reconnect ? "Replace token" : "Connect Lawmatics"}
        </button>
        {state.ok && (
          <span className="lx-note" style={{ color: "var(--ok)" }}>
            Connected.
          </span>
        )}
      </div>
      <Err text={state.error} />
    </form>
  );
}

export function DisconnectLawmatics() {
  const [state, action, pending] = useActionState<ConnectState, FormData>(disconnectLawmaticsAction, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Disconnect Lawmatics? The token is deleted. Records already imported stay.")) e.preventDefault();
      }}
      className="lx-inline-form"
    >
      <button type="submit" className="lx-btn lx-btn-danger lx-btn-sm" disabled={pending}>
        {pending ? "…" : "Disconnect"}
      </button>
      <Err text={state.error} />
    </form>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Totals({ items }: { items: Array<[string, number, string?]> }) {
  return (
    <div className="lx-lm-totals">
      {items.map(([label, n, tone]) => (
        <div key={label} className="lx-lm-total">
          <span className="lx-lm-n" style={tone ? { color: tone } : undefined}>
            {n}
          </span>
          <span className="lx-note">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, count, omitted, children }: { title: string; count: number; omitted?: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="lx-lm-section">
      <summary>
        {title} <span className="lx-chip-count">{count}</span>
      </summary>
      <ul className="lx-list">{children}</ul>
      {omitted ? <p className="lx-note">…and {omitted} more, not listed here. They are counted above and included in the import.</p> : null}
    </details>
  );
}

function Row({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <li style={{ padding: "8px 0", display: "grid", gap: 2 }}>
      <span style={{ color: "var(--ink)" }}>{title}</span>
      {detail && <span className="lx-note">{detail}</span>}
    </li>
  );
}

function Notices({ truncated, truncatedReason, includeDropped, includeDroppedReason }: { truncated: boolean; truncatedReason?: string; includeDropped?: boolean; includeDroppedReason?: string }) {
  return (
    <>
      {truncated && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          Not everything was read from Lawmatics. {truncatedReason ?? ""} Run it again after this import to pick up the rest.
        </p>
      )}
      {includeDropped && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          Stages and linked contacts couldn&apos;t be read this time, so records may look stage-less. {includeDroppedReason ?? ""}
        </p>
      )}
    </>
  );
}

function Acknowledge({ label }: { label: string }) {
  return (
    <label className="lx-proposal-row">
      <input type="checkbox" name="acknowledge" />
      <span>{label}</span>
    </label>
  );
}

// ── Clients (leads) ─────────────────────────────────────────────────────────

function OptionBoxes({ options }: { options?: PreviewView["options"] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label className="lx-proposal-row">
        <input type="checkbox" name="trademarkOnly" defaultChecked={options ? options.practiceAreaFilter === "Trademark" : true} />
        <span>Trademark matters only</span>
      </label>
      <label className="lx-proposal-row">
        <input type="checkbox" name="moveExistingStages" defaultChecked={options?.moveExistingStages ?? false} />
        <span>Move existing leads to the stage Lawmatics has them in</span>
      </label>
      <label className="lx-proposal-row">
        <input type="checkbox" name="overwriteEditedFields" defaultChecked={options?.overwriteEditedFields ?? false} />
        <span>Overwrite details someone here has already edited</span>
      </label>
    </div>
  );
}

export function ClientsImport() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, IDLE);
  const p = state.preview;
  const r = state.report;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {state.phase !== "preview" && (
        <form action={action} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="intent" value="preview" />
          <OptionBoxes />
          <div>
            <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
              {pending ? "Reading Lawmatics…" : r ? "Preview again" : "Preview import"}
            </button>
          </div>
        </form>
      )}

      {state.notice && <p className="lx-banner lx-banner-ok" style={{ margin: 0 }}>{state.notice}</p>}
      <Err text={state.error} />

      {p && state.phase === "preview" && (
        <>
          <p className="lx-note" style={{ margin: 0 }}>
            Read {p.counts.prospects} records and {p.counts.contacts} contacts from Lawmatics. Nothing has been written yet.
          </p>
          <Notices truncated={p.truncated} truncatedReason={p.truncatedReason} includeDropped={p.includeDropped} includeDroppedReason={p.includeDroppedReason} />
          <Totals
            items={[
              ["new leads", p.totals.create, "var(--ox)"],
              ["updated", p.totals.update],
              ["already current", p.totals.unchanged],
              ["stage differs", p.totals.divergent],
              ["no matching stage", p.totals.unmapped],
              ["skipped", p.totals.skipped],
            ]}
          />
          <Section title="New leads" count={p.totals.create} omitted={p.omitted.creates}>
            {p.creates.map((c) => (
              <Row key={c.lawmaticsId} title={name(c.fields.first_name, c.fields.last_name, c.fields.email)} detail={[c.fields.business_name, c.fields.email, `→ ${c.stageName}`].filter(Boolean).join(" · ")} />
            ))}
          </Section>
          <Section title="Updates to existing leads" count={p.totals.update} omitted={p.omitted.updates}>
            {p.updates.map((u) => (
              <Row
                key={u.lawmaticsId}
                title={u.matterName ?? u.lawmaticsId}
                detail={[u.linksRecord ? "links the record" : null, ...u.changes.map((c) => `${c.field.replaceAll("_", " ")}: ${c.from ?? "—"} → ${c.to}`), u.stageWillMove ? `stage → ${u.targetStageName}` : null].filter(Boolean).join(" · ")}
              />
            ))}
          </Section>
          <Section title="Stage differs (left as is)" count={p.totals.divergent} omitted={p.omitted.divergences}>
            {p.divergences.map((d) => (
              <Row key={d.lawmaticsId} title={d.matterName ?? d.lawmaticsId} detail={`Lawmatics: ${d.sourceStageName ?? "—"} · here: ${d.targetStageName ?? "—"}`} />
            ))}
          </Section>
          <Section title="Details kept because someone edited them here" count={p.totals.withheld} omitted={p.omitted.withheld}>
            {p.withheld.map((w) => (
              <Row key={w.lawmaticsId} title={w.matterName ?? w.lawmaticsId} detail={w.changes.map((c) => `${c.field.replaceAll("_", " ")}: keeps ${c.from ?? "—"}`).join(" · ")} />
            ))}
          </Section>
          <Section title="No matching stage" count={p.totals.unmapped} omitted={p.omitted.unmapped}>
            {p.unmapped.map((u) => (
              <Row key={u.lawmaticsId} title={u.name ?? u.matterName ?? u.lawmaticsId} detail={`${u.sourceStageName ?? "No stage"} · ${u.reason}`} />
            ))}
          </Section>
          <Section title="Skipped" count={p.totals.skipped} omitted={p.omitted.skipped}>
            {p.skipped.map((s) => (
              <Row key={s.lawmaticsId} title={s.name ?? s.matterName ?? s.lawmaticsId} detail={s.reason} />
            ))}
          </Section>

          <form action={action} className="lx-lm-confirm">
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="fingerprint" value={p.fingerprint} />
            {p.options.practiceAreaFilter === "Trademark" && <input type="hidden" name="trademarkOnly" value="on" />}
            {p.options.moveExistingStages && <input type="hidden" name="moveExistingStages" value="on" />}
            {p.options.overwriteEditedFields && <input type="hidden" name="overwriteEditedFields" value="on" />}
            <Acknowledge label={`Write ${p.totals.create} new and ${p.totals.update} updated leads into Lectual.`} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
                {pending ? "Importing…" : "Import"}
              </button>
            </div>
          </form>
          <div>
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending} onClick={() => location.reload()}>
              Change options
            </button>
          </div>
        </>
      )}

      {r && state.phase === "done" && (
        <>
          <Totals
            items={[
              ["created", r.created, "var(--ok)"],
              ["updated", r.updated],
              ["linked", r.linked],
              ["stages moved", r.stageMoves],
              ["failed", r.failures.length, r.failures.length ? "var(--wine)" : undefined],
            ]}
          />
          {r.partial && (
            <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
              The import stopped at its time limit. Everything counted above was written. Run it again to finish the other {r.remaining.creates + r.remaining.updates}.
            </p>
          )}
          <Notices truncated={r.truncated} truncatedReason={r.truncatedReason} />
          <Section title="Failed" count={r.failures.length}>
            {r.failures.map((f, i) => (
              <Row key={i} title={f.lawmaticsId} detail={f.message} />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

// ── Matters (reconcile existing) ────────────────────────────────────────────

export function MattersImport() {
  const [previewState, previewAction, previewing] = useActionState<MattersImportState, FormData>(previewMattersImportAction, MATTERS_IDLE);
  const [applyState, applyAction, applying] = useActionState<MattersImportState, FormData>(applyMattersImportAction, MATTERS_IDLE);
  // The apply action can hand back a fresh preview (plan changed, box unticked).
  const state = applyState.phase !== "idle" ? applyState : previewState;
  const p = state.phase === "preview" ? state.preview : undefined;
  const r = state.phase === "done" ? state.report : undefined;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p className="lx-note" style={{ margin: 0 }}>
        Links your existing matters to their Lawmatics records and fills in blanks: the Lawmatics id, referral source, notes, opened date. It never creates a matter and never overwrites a value someone entered here.
      </p>
      <form action={previewAction}>
        <button type="submit" className="lx-btn lx-btn-sec" disabled={previewing || applying}>
          {previewing ? "Reading Lawmatics…" : "Preview matter updates"}
        </button>
      </form>

      {state.notice && <p className="lx-banner lx-banner-ok" style={{ margin: 0 }}>{state.notice}</p>}
      <Err text={state.error} />

      {p && (
        <>
          <Notices truncated={p.truncated} truncatedReason={p.truncatedReason} />
          <Totals
            items={[
              ["matters to update", p.totals.update, "var(--ox)"],
              ["already current", p.totals.unchanged],
              ["no match here", p.totals.unmapped],
              ["skipped", p.totals.skipped],
            ]}
          />
          <Section title="Updates" count={p.totals.update} omitted={p.omitted.updates}>
            {p.updates.map((u) => (
              <Row
                key={u.lawmaticsId}
                title={`${u.matterName ?? u.matterNumber} · ${u.matterNumber}`}
                detail={[`matched by ${u.matchedBy.replaceAll("_", " ")}`, ...u.changes.map((c) => `${c.field.replaceAll("_", " ")} → ${c.to}`)].join(" · ")}
              />
            ))}
          </Section>
          <Section title="No matching matter here" count={p.totals.unmapped} omitted={p.omitted.unmapped}>
            {p.unmapped.map((u) => (
              <Row key={u.lawmaticsId} title={u.matterName ?? u.lawmaticsId} detail={u.reason} />
            ))}
          </Section>
          <Section title="Skipped" count={p.totals.skipped} omitted={p.omitted.skipped}>
            {p.skipped.map((s) => (
              <Row key={s.lawmaticsId} title={s.matterName ?? s.lawmaticsId} detail={s.reason} />
            ))}
          </Section>
          {p.totals.update > 0 && (
            <form action={applyAction} className="lx-lm-confirm">
              <input type="hidden" name="fingerprint" value={p.fingerprint} />
              <Acknowledge label={`Update ${p.totals.update} matters in Lectual.`} />
              <div>
                <button type="submit" className="lx-btn lx-btn-pri" disabled={applying}>
                  {applying ? "Updating…" : "Update matters"}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {r && (
        <>
          <Totals
            items={[
              ["updated", r.updated, "var(--ok)"],
              ["linked", r.linked],
              ["already current", r.unchanged],
              ["failed", r.failures.length, r.failures.length ? "var(--wine)" : undefined],
            ]}
          />
          {r.partial && (
            <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
              The update stopped at its time limit. Everything counted above was written. Run it again to finish.
            </p>
          )}
          <Section title="Failed" count={r.failures.length}>
            {r.failures.map((f, i) => (
              <Row key={i} title={f.lawmaticsId} detail={f.message} />
            ))}
          </Section>
        </>
      )}
    </div>
  );
}
