"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  IP_TYPES,
  JURS,
  LIMITS,
  INTRO_DEFAULTS,
  moveQuestion,
  newQuestionId,
  normalizeDomain,
  referralDisclosure,
  reorderQuestion,
  togglePack,
  type IntakeColors,
  type IntakeFormConfig,
  type IntakeQuestion,
  type IntakeTheme,
} from "@/lib/intake-forms/config";
import { checklistComplete, goLiveChecklist, type ChecklistSection } from "@/lib/intake-forms/checklist";
import { intakeEmbedSnippet, intakePublicUrl } from "@/lib/intake-forms/links";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { saveIntakeFormAction } from "../actions";
import { IntakePreview } from "./IntakePreview";

/**
 * Intake → Forms (design/Intake_Forms.dc.html): the header, the two tabs,
 * the setup editor with its live preview, the go-live checklist and the
 * unsaved-changes bar.
 *
 * All edits are local until Save. Save sends the whole config; the SERVER
 * validates it, decides draft/live from the same checklist drawn here, and
 * answers with the stored form, which becomes the new "saved" snapshot that
 * Discard returns to.
 *
 * The Performance tab is rendered on the server and handed in as `performance`,
 * so switching tabs (a soft navigation to `?tab=performance`) keeps unsaved
 * edits: this component stays mounted and its state with it.
 *
 * Read-only for everyone below senior_admin: every control sits in a disabled
 * <fieldset>, and the Save action refuses them regardless.
 */

export type WorkspacePackage = { id: string; name: string; price: string; includes: string };

type Props = {
  form: IntakeFormRecord;
  orgName: string;
  packages: { status: "ok"; items: WorkspacePackage[] } | { status: "unavailable" };
  origin: string;
  canEdit: boolean;
  tab: "setup" | "performance";
  range: number;
  performance: ReactNode;
};

type Snapshot = { config: IntakeFormConfig; domains: string[] };

const LOCK = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);
const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5 9-10" />
  </svg>
);

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`ifm-switch${on ? " on" : ""}`} onClick={onClick}>
      <i />
    </button>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className="ifm-count">
      {n.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </span>
  );
}

/** A colour swatch plus its hex text. The text commits only when it's a valid #rrggbb. */
function ColorField({ name, aria, value, onChange }: { name: string; aria: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  return (
    <div className="ifm-swatch">
      <input type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={aria} />
      <div className="ifm-swatch-text">
        <span className="ifm-help">{name}</span>
        <input
          type="text"
          className="ifm-hex"
          value={text}
          maxLength={7}
          aria-label={`${aria} hex`}
          onChange={(e) => {
            let v = e.target.value.trim();
            if (v && v[0] !== "#") v = `#${v}`;
            setText(v);
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase());
          }}
          onBlur={() => setText(value)}
        />
      </div>
    </div>
  );
}

export function IntakeFormsWorkspace(props: Props) {
  const { form, canEdit } = props;
  const [config, setConfig] = useState<IntakeFormConfig>(form.config);
  const [domains, setDomains] = useState<string[]>(form.allowedDomains);
  const [saved, setSaved] = useState<Snapshot>({ config: form.config, domains: form.allowedDomains });
  const [status, setStatus] = useState(form.status);
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [domInput, setDomInput] = useState("");
  const [pvTheme, setPvTheme] = useState<"light" | "dark">(form.config.theme === "dark" ? "dark" : "light");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = useMemo(
    () => JSON.stringify({ config, domains }) !== JSON.stringify({ config: saved.config, domains: saved.domains }),
    [config, domains, saved],
  );

  const publicUrl = intakePublicUrl(props.origin, form.slug);
  const embed = intakeEmbedSnippet(props.origin, form.slug);
  const items = goLiveChecklist(config, { receivesReferrals: form.receivesReferrals, agreementSigned: form.agreementSignedAt !== null });
  const done = items.filter((i) => i.ok).length;
  const allDone = checklistComplete(items);
  const err = (key: string) => showErrors && items.some((i) => i.key === key && !i.ok);
  const packages = props.packages.status === "ok" ? props.packages.items : [];
  const visiblePkgs = packages.filter((p) => config.visiblePackageIds.includes(p.id));

  const flash = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  // Leaving the page with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // The question "More" menu closes on any click outside it.
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-qmenu]")) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const edit = (patch: Partial<IntakeFormConfig> | ((c: IntakeFormConfig) => Partial<IntakeFormConfig>)) =>
    setConfig((c) => ({ ...c, ...(typeof patch === "function" ? patch(c) : patch) }));
  const editQ = (id: string, patch: Partial<IntakeQuestion>) =>
    edit((c) => ({ questions: c.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));

  const copy = (text: string, msg: string) => {
    navigator.clipboard?.writeText(text).then(
      () => flash(msg),
      () => flash("Couldn't copy. Select the text and copy it instead."),
    );
  };

  const save = () => {
    if (!canEdit || saving) return;
    setSaveError(null);
    startSaving(async () => {
      const res = await saveIntakeFormAction({ config, allowedDomains: domains });
      if (!res.ok) {
        setSaveError(res.error);
        flash("Not saved");
        return;
      }
      const next = { config: res.form.config, domains: res.form.allowedDomains };
      setConfig(next.config);
      setDomains(next.domains);
      setSaved(next);
      setStatus(res.form.status);
      setShowErrors(res.remaining > 0);
      flash(res.remaining ? `Saved as draft · ${res.remaining} left to go live` : res.form.status === "live" ? "Saved · live" : "Saved");
    });
  };

  const discard = () => {
    setConfig(saved.config);
    setDomains(saved.domains);
    setShowErrors(false);
    setSaveError(null);
    setMenu(null);
    flash("Changes discarded");
  };

  const scrollTo = (sec: ChecklistSection) => {
    document.getElementById(`ifm-sec-${sec}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setShowErrors(true);
  };

  const onPack = (pack: (typeof IP_TYPES)[number]) => {
    const r = togglePack(config, pack);
    setConfig(r.config);
    if (r.added.length) {
      setJustAdded(new Set(r.added));
      if (addedTimer.current) clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setJustAdded(new Set()), 1400);
      flash(`Added ${r.added.length} ${pack} question${r.added.length === 1 ? "" : "s"}`);
    } else if (config.packs.includes(pack)) {
      flash(`Removed ${r.removed} from ${pack}${r.kept ? ` · kept ${r.kept} you edited` : ""}`);
    } else {
      flash(`${pack} questions are already in your list`);
    }
  };

  const addDomain = () => {
    const raw = domInput.trim();
    if (!raw) return;
    const d = normalizeDomain(raw);
    if (!d) {
      flash("Use a domain like example.com or *.example.com");
      return;
    }
    if (domains.length >= LIMITS.domains && !domains.includes(d)) {
      flash(`Allow at most ${LIMITS.domains} domains`);
      return;
    }
    if (!domains.includes(d)) setDomains([...domains, d]);
    setDomInput("");
  };

  const setTheme = (t: IntakeTheme) => {
    edit({ theme: t });
    if (t !== "auto") setPvTheme(t);
  };
  const setColor = (k: keyof IntakeColors, v: string) => edit((c) => ({ colors: { ...c.colors, [k]: v } }));

  const live = status === "live";
  const tabHref = (t: "setup" | "performance") => (t === "setup" ? "/dashboard/forms/" : `/dashboard/forms/?tab=performance&range=${props.range}`);
  const firmDisplay = config.firmName.trim() || props.orgName;
  const agreementSigned = form.agreementSignedAt !== null;

  return (
    <div className="ifm-root">
      <div className="lx-page-head ifm-head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="lx-label">Intake</div>
          <h1 className="lx-h1">Intake forms</h1>
          <p className="lx-sub">Your public intake, how it looks, and where it lives.</p>
        </div>
        <div className="ifm-head-actions">
          <span className={`ifm-status${live ? " live" : ""}`}>
            <i />
            {live ? "Live" : "Draft"}
          </span>
          <button type="button" className="lx-btn lx-btn-sec" onClick={() => copy(publicUrl, "Link copied")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </svg>
            Copy link
          </button>
          <a className="lx-btn lx-btn-sec" href={publicUrl} target="_blank" rel="noopener noreferrer">
            Preview
          </a>
          {canEdit && (
            <button type="button" className="lx-btn lx-btn-pri" onClick={save} disabled={saving || !dirty} aria-busy={saving}>
              {saving && <span className="ifm-spin" aria-hidden />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </div>
      </div>

      <nav className="ifm-tabs" aria-label="Intake forms">
        <Link href={tabHref("setup")} scroll={false} aria-current={props.tab === "setup" ? "page" : undefined}>
          Form setup
        </Link>
        <Link href={tabHref("performance")} scroll={false} aria-current={props.tab === "performance" ? "page" : undefined}>
          Performance
        </Link>
      </nav>

      {props.tab === "performance" ? (
        props.performance
      ) : (
        <div className="ifm-setup">
          <fieldset className="ifm-editor" disabled={!canEdit}>
            {!canEdit && (
              <div className="lx-banner lx-banner-mute" style={{ fontSize: 14 }}>
                You can look but not change. Owners, admins and senior admins edit the intake.
              </div>
            )}
            {saveError && (
              <div role="alert" className="lx-banner lx-banner-risk" style={{ fontSize: 14 }}>
                {saveError}
              </div>
            )}

            {allDone ? (
              <div className="ifm-live-banner">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6" />
                </svg>
                <div className="ifm-live-text">
                  {live && !dirty ? `Live at ${publicUrl.replace(/^https?:\/\//, "")}` : "Ready to go live. Save to publish."}
                </div>
                {live && !dirty && (
                  <button type="button" className="ifm-live-copy" onClick={() => copy(publicUrl, "Link copied")}>
                    Copy
                  </button>
                )}
              </div>
            ) : (
              <div className="ifm-card ifm-checklist">
                <div className="ifm-checklist-head">
                  <div className="ifm-title" style={{ flex: 1 }}>
                    Finish these to go live.
                  </div>
                  <span className="ifm-count">
                    {done} of {items.length}
                  </span>
                </div>
                <div className="ifm-progress">
                  <div style={{ width: `${(done / items.length) * 100}%` }} />
                </div>
                <ul className="ifm-checklist-items">
                  {items.map((i) => {
                    const bad = !i.ok && showErrors;
                    return (
                      <li key={i.key} className={i.ok ? "ok" : bad ? "bad" : ""}>
                        <span className="ifm-check-icon" aria-hidden>
                          {i.ok ? CHECK : bad ? "!" : null}
                        </span>
                        <span className="ifm-check-label">
                          {i.label}
                          <span className="lx-sr">{i.ok ? " (done)" : " (to do)"}</span>
                        </span>
                        {!i.ok && (
                          <button type="button" className="ifm-link" onClick={() => scrollTo(i.section)}>
                            Fix
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {live && <p className="ifm-help">Your intake is live. Saving with items open takes it back to draft.</p>}
              </div>
            )}

            <section id="ifm-sec-mode" className="ifm-card">
              <h2 className="ifm-title">What visitors see first</h2>
              <div className="ifm-modes">
                {(
                  [
                    { k: "conversation", title: "Conversation", desc: "An assistant asks your questions one at a time.", d: "M21 12a8 8 0 1 1-3.4-6.5L21 4l-1 4.5A7.9 7.9 0 0 1 21 12z" },
                    { k: "form", title: "Form", desc: "Every question on one page, filled in at their pace.", d: "M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" },
                  ] as const
                ).map((m) => (
                  <button key={m.k} type="button" className={`ifm-mode${config.mode === m.k ? " on" : ""}`} aria-pressed={config.mode === m.k} onClick={() => edit({ mode: m.k })}>
                    <span className="ifm-mode-head">
                      <span className="ifm-mode-icon">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d={m.d} />
                        </svg>
                      </span>
                      <span className="ifm-mode-title">{m.title}</span>
                      {config.mode === m.k && <span className="ifm-mode-tick">{CHECK}</span>}
                    </span>
                    <span className="ifm-help">{m.desc}</span>
                  </button>
                ))}
              </div>
              <p className="ifm-help">Visitors can switch modes either way.</p>
            </section>

            <section id="ifm-sec-assistant" className="ifm-card">
              <h2 className="ifm-title">Assistant</h2>
              <label className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label">Opening message</span>
                  <Counter n={config.opening.length} max={LIMITS.opening} />
                </span>
                <input
                  className="ifm-input"
                  value={config.opening}
                  maxLength={LIMITS.opening}
                  placeholder="Hi — tell me about what you're building."
                  onChange={(e) => edit({ opening: e.target.value })}
                />
              </label>
              <label className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label">What the assistant knows about your firm</span>
                  <span className="ifm-private">{LOCK} Only you see this</span>
                  <span style={{ flex: 1 }} />
                  <Counter n={config.knows.length} max={LIMITS.knows} />
                </span>
                <textarea
                  className="ifm-input"
                  rows={5}
                  value={config.knows}
                  maxLength={LIMITS.knows}
                  placeholder="e.g. We're a trademark boutique. We file US federal trademarks and handle office actions. Consults are 30 minutes by video."
                  onChange={(e) => edit({ knows: e.target.value })}
                />
                <span className="ifm-help">
                  Practice areas, how consults work, response times. The assistant never gives legal advice: case-specific questions go to
                  your attorneys. Today it asks your questions in order and doesn&apos;t chat freely.
                </span>
              </label>
            </section>

            <section id="ifm-sec-intro" className="ifm-card">
              <h2 className="ifm-title">Introduction</h2>
              <div className="ifm-grid2">
                <label className="ifm-field">
                  <span className="ifm-field-label">Firm name</span>
                  <input className="ifm-input" value={config.firmName} maxLength={LIMITS.firmName} placeholder={props.orgName} onChange={(e) => edit({ firmName: e.target.value })} />
                </label>
                <label className="ifm-field">
                  <span className="ifm-field-label">Headline</span>
                  <input className="ifm-input" value={config.headline} maxLength={LIMITS.headline} placeholder={INTRO_DEFAULTS.headline} onChange={(e) => edit({ headline: e.target.value })} />
                </label>
              </div>
              <label className="ifm-field">
                <span className="ifm-field-label">Disclaimer</span>
                <textarea className="ifm-input" rows={3} value={config.disclaimer} maxLength={LIMITS.disclaimer} placeholder={INTRO_DEFAULTS.disclaimer} onChange={(e) => edit({ disclaimer: e.target.value })} />
              </label>
              <label className="ifm-field">
                <span className="ifm-field-label">Consent notice</span>
                <textarea className="ifm-input" rows={2} value={config.consent} maxLength={LIMITS.consent} placeholder={INTRO_DEFAULTS.consent} onChange={(e) => edit({ consent: e.target.value })} />
              </label>
              <p className="ifm-help">Leave blank to use the standard wording.</p>
            </section>

            <section id="ifm-sec-questions" className="ifm-card">
              <h2 className="ifm-title">Questions</h2>
              <div className="ifm-contact">
                <span className="ifm-contact-lock">{LOCK}</span>
                <div>
                  <div className="ifm-field-label">Contact details · Always asked first</div>
                  <div className="ifm-help">Full name · Email · Phone · Company</div>
                </div>
              </div>

              <div className="ifm-field">
                <span className="ifm-field-label">Start from an IP pack.</span>
                <div className="ifm-chips">
                  {IP_TYPES.map((p) => {
                    const on = config.packs.includes(p);
                    return (
                      <button key={p} type="button" className={`ifm-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => onPack(p)}>
                        {on && CHECK}
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {config.questions.length > 0 ? (
                <ol className="ifm-qlist">
                  {config.questions.map((q, i) => (
                    <li
                      key={q.id}
                      className={`ifm-q${justAdded.has(q.id) ? " added" : ""}${drag === q.id ? " dragging" : ""}${over === q.id && drag && drag !== q.id ? " over" : ""}`}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", q.id);
                        setDrag(q.id);
                        setMenu(null);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (over !== q.id) setOver(q.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (drag && drag !== q.id) edit((c) => ({ questions: reorderQuestion(c.questions, drag, q.id) }));
                        setDrag(null);
                        setOver(null);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                    >
                      <span className="ifm-grip" title="Drag to reorder" aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="9" cy="6" r="1.6" />
                          <circle cx="15" cy="6" r="1.6" />
                          <circle cx="9" cy="12" r="1.6" />
                          <circle cx="15" cy="12" r="1.6" />
                          <circle cx="9" cy="18" r="1.6" />
                          <circle cx="15" cy="18" r="1.6" />
                        </svg>
                      </span>
                      <input
                        className="ifm-input ifm-q-text"
                        value={q.text}
                        maxLength={LIMITS.question}
                        placeholder="e.g. Have you used this name publicly yet?"
                        aria-label={`Question ${i + 1}`}
                        onChange={(e) => editQ(q.id, { text: e.target.value, edited: true })}
                      />
                      {q.pack && <span className="ifm-q-pack">{q.pack}</span>}
                      <span className="ifm-q-req">
                        <span className="ifm-help">Required</span>
                        <Toggle on={q.required} label={`Question ${i + 1} required`} onClick={() => editQ(q.id, { required: !q.required })} />
                      </span>
                      <span className="ifm-q-more" data-qmenu>
                        <button type="button" className="ifm-icon-btn" aria-label={`More for question ${i + 1}`} aria-expanded={menu === q.id} onClick={() => setMenu(menu === q.id ? null : q.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <circle cx="5" cy="12" r="1.8" />
                            <circle cx="12" cy="12" r="1.8" />
                            <circle cx="19" cy="12" r="1.8" />
                          </svg>
                        </button>
                        {menu === q.id && (
                          <span className="ifm-menu" role="menu">
                            <button type="button" role="menuitem" disabled={i === 0} onClick={() => { edit((c) => ({ questions: moveQuestion(c.questions, i, -1) })); setMenu(null); }}>
                              Move up
                            </button>
                            <button type="button" role="menuitem" disabled={i === config.questions.length - 1} onClick={() => { edit((c) => ({ questions: moveQuestion(c.questions, i, 1) })); setMenu(null); }}>
                              Move down
                            </button>
                            <button type="button" role="menuitem" className="danger" onClick={() => { edit((c) => ({ questions: c.questions.filter((x) => x.id !== q.id) })); setMenu(null); }}>
                              Remove
                            </button>
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={`ifm-empty${err("questions") ? " bad" : ""}`}>No questions yet. Prospects will only share contact details.</div>
              )}

              <button
                type="button"
                className="ifm-add"
                disabled={config.questions.length >= LIMITS.questions}
                onClick={() => edit((c) => ({ questions: [...c.questions, { id: newQuestionId(), text: "", required: false, pack: null, edited: true }] }))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add question
              </button>
            </section>

            <section id="ifm-sec-fees" className="ifm-card">
              <h2 className="ifm-title">Fee packages</h2>
              <div className="ifm-row">
                <span className="ifm-field-label" style={{ flex: 1 }}>
                  Show my flat-fee packages in the intake.
                </span>
                <Toggle on={config.feesOn} label="Show fee packages" onClick={() => edit({ feesOn: !config.feesOn })} />
              </div>
              {props.packages.status === "unavailable" ? (
                <div className="lx-banner lx-banner-warn" style={{ fontSize: 14 }}>
                  Your packages couldn&apos;t be loaded just now, so none are listed here. Your saved choices are kept.
                </div>
              ) : packages.length > 0 ? (
                <>
                  <ul className={`ifm-pkgs${config.feesOn ? "" : " off"}`}>
                    {packages.map((p) => {
                      const shown = config.visiblePackageIds.includes(p.id);
                      return (
                        <li key={p.id}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="ifm-pkg-head">
                              <span className="ifm-pkg-name">{p.name}</span>
                              <span className="ifm-pkg-price">{p.price}</span>
                            </div>
                            {p.includes && <div className="ifm-help">{p.includes}</div>}
                          </div>
                          <span className="ifm-q-req">
                            <span className="ifm-help">{shown ? "Shown" : "Hidden"}</span>
                            <Toggle
                              on={shown}
                              label={`Show ${p.name}`}
                              onClick={() =>
                                edit((c) => ({
                                  visiblePackageIds: shown ? c.visiblePackageIds.filter((x) => x !== p.id) : [...c.visiblePackageIds, p.id],
                                }))
                              }
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="ifm-help">Prices come from your packages exactly as written. The assistant never estimates fees.</p>
                </>
              ) : (
                <div className="ifm-empty ifm-empty-row">
                  <span style={{ flex: 1 }}>No packages yet.</span>
                  {canEdit ? (
                    <Link href="/dashboard/settings/services/" className="ifm-link">
                      Add packages
                    </Link>
                  ) : (
                    <span>An admin adds them in Settings.</span>
                  )}
                </div>
              )}
            </section>

            <section id="ifm-sec-screening" className="ifm-card">
              <h2 className="ifm-title">Screening</h2>
              <div className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label">Fit criteria</span>
                  <span className="ifm-private">{LOCK} Only you see this</span>
                </span>
                <span className="ifm-help">IP type</span>
                <div className="ifm-chips">
                  {IP_TYPES.map((p) => {
                    const on = config.fitIp.includes(p);
                    return (
                      <button key={p} type="button" className={`ifm-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => edit((c) => ({ fitIp: on ? c.fitIp.filter((x) => x !== p) : IP_TYPES.filter((x) => x === p || c.fitIp.includes(x)) }))}>
                        {p}
                      </button>
                    );
                  })}
                </div>
                <span className="ifm-help">Jurisdiction</span>
                <div className="ifm-chips">
                  {JURS.map((p) => {
                    const on = config.fitJur.includes(p);
                    return (
                      <button key={p} type="button" className={`ifm-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => edit((c) => ({ fitJur: on ? c.fitJur.filter((x) => x !== p) : JURS.filter((x) => x === p || c.fitJur.includes(x)) }))}>
                        {p}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  className={`ifm-input${err("fit") ? " bad" : ""}`}
                  rows={4}
                  value={config.fitText}
                  maxLength={LIMITS.fitText}
                  aria-label="Fit criteria"
                  placeholder="e.g. Founders and small brands filing their first US trademark. Not litigation, not patents."
                  onChange={(e) => edit({ fitText: e.target.value })}
                />
                {err("fit") && <span className="ifm-err">Describe who you take on, so intakes can be screened.</span>}
                <span className="ifm-help">Prospects are screened against this and never see it.</span>
              </div>
              <label className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label" style={{ flex: 1 }}>
                    Closing message
                  </span>
                  <Counter n={config.closing.length} max={LIMITS.closing} />
                </span>
                <textarea
                  className={`ifm-input${err("closing") ? " bad" : ""}`}
                  rows={3}
                  value={config.closing}
                  maxLength={LIMITS.closing}
                  onChange={(e) => edit({ closing: e.target.value })}
                />
                {err("closing") && <span className="ifm-err">Add a closing message. Everyone sees it after they submit.</span>}
                <span className="ifm-help">Everyone sees this, not just people outside your fit. Say what happens next.</span>
              </label>
            </section>

            {form.receivesReferrals && (
              <section id="ifm-sec-compliance" className="ifm-card">
                <h2 className="ifm-title">Compliance</h2>
                <label className="ifm-field">
                  <span className="ifm-field-label">Office location</span>
                  <input
                    className={`ifm-input${err("office") ? " bad" : ""}`}
                    value={config.office}
                    maxLength={LIMITS.office}
                    placeholder="Street, city, state, ZIP"
                    onChange={(e) => edit({ office: e.target.value })}
                  />
                  {err("office") && <span className="ifm-err">An office address is required for referred founders.</span>}
                </label>
                <div className="ifm-field">
                  <span className="ifm-field-label">Participation agreement</span>
                  <div className="ifm-row">
                    <span className={`ifm-badge ${agreementSigned ? "ok" : "warn"}`}>
                      {agreementSigned ? `Signed ${new Date(form.agreementSignedAt as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "Not signed"}
                    </span>
                  </div>
                  {err("agreement") && <span className="ifm-err">The participation agreement must be signed before referrals can reach you.</span>}
                  <span className="ifm-help">Lectual records this when your firm signs the agreement. It can&apos;t be changed here.</span>
                </div>
                <div className="ifm-field">
                  <span className="ifm-field-head">
                    <span className="ifm-field-label">4-7.22 disclosure</span>
                    <span className="ifm-help">Shown to every referred founder.</span>
                  </span>
                  <div className="ifm-quote">{referralDisclosure(firmDisplay)}</div>
                </div>
              </section>
            )}

            <section id="ifm-sec-appearance" className="ifm-card">
              <h2 className="ifm-title">Appearance</h2>
              <div className="ifm-field">
                <span className="ifm-field-label">Theme</span>
                <div className="ifm-seg" role="group" aria-label="Theme">
                  {(["light", "dark", "auto"] as const).map((t) => (
                    <button key={t} type="button" className={config.theme === t ? "on" : ""} aria-pressed={config.theme === t} onClick={() => setTheme(t)}>
                      {t === "light" ? "Light" : t === "dark" ? "Dark" : "Auto"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ifm-field">
                <span className="ifm-field-label">Colors</span>
                {(
                  [
                    ["Light", "lightBg", "lightAcc"],
                    ["Dark", "darkBg", "darkAcc"],
                  ] as const
                ).map(([label, bg, acc]) => (
                  <div key={label} className="ifm-colors">
                    <span className="ifm-help">{label}</span>
                    <ColorField name="Background" aria={`${label} background`} value={config.colors[bg]} onChange={(v) => setColor(bg, v)} />
                    <ColorField name="Accent" aria={`${label} accent`} value={config.colors[acc]} onChange={(v) => setColor(acc, v)} />
                  </div>
                ))}
              </div>
              <div className="ifm-row">
                <span className="ifm-field-label" style={{ flex: 1 }}>
                  Show &lsquo;Powered by Lectual&rsquo;
                </span>
                <Toggle on={config.powered} label="Show Powered by Lectual" onClick={() => edit({ powered: !config.powered })} />
              </div>
              <p className="ifm-help">Applies to your public link and the embedded widget.</p>
            </section>

            <section id="ifm-sec-share" className="ifm-card">
              <h2 className="ifm-title">Share</h2>
              <div className="ifm-field">
                <span className="ifm-field-label">Direct link</span>
                <div className="ifm-row">
                  <input className="ifm-input ifm-readonly" value={publicUrl} readOnly aria-label="Direct link" />
                  <button type="button" className="lx-btn lx-btn-sec" onClick={() => copy(publicUrl, "Link copied")}>
                    Copy
                  </button>
                </div>
              </div>
              <div className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label" style={{ flex: 1 }}>
                    Embed snippet
                  </span>
                  <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => copy(embed, "Embed snippet copied")}>
                    Copy
                  </button>
                </span>
                <pre className="ifm-code">{embed}</pre>
              </div>
              <div className="ifm-field">
                <span className="ifm-field-label">Allowed domains</span>
                <div className="ifm-domains">
                  {domains.map((d) => (
                    <span key={d} className="ifm-domain">
                      <span>{d}</span>
                      <button type="button" aria-label={`Remove ${d}`} onClick={() => setDomains(domains.filter((x) => x !== d))}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  <input
                    value={domInput}
                    placeholder="example.com or *.example.com"
                    aria-label="Add domain"
                    onChange={(e) => setDomInput(e.target.value)}
                    onBlur={() => domInput.trim() && addDomain()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addDomain();
                      } else if (e.key === "Backspace" && !domInput && domains.length) {
                        setDomains(domains.slice(0, -1));
                      }
                    }}
                  />
                </div>
                {domains.length === 0 && <span className="ifm-help">Any site can embed this.</span>}
              </div>
            </section>
          </fieldset>

          <IntakePreview config={config} orgName={props.orgName} packages={config.feesOn ? visiblePkgs : []} theme={pvTheme} onTheme={setPvTheme} />
        </div>
      )}

      {canEdit && (dirty || saving) && (
        <div className="ifm-unsaved" role="region" aria-label="Unsaved changes">
          <i />
          <span style={{ flex: 1, minWidth: 0 }}>Unsaved changes</span>
          <button type="button" className="ifm-unsaved-discard" onClick={discard} disabled={saving}>
            Discard
          </button>
          <button type="button" className="ifm-unsaved-save" onClick={save} disabled={saving}>
            {saving && <span className="ifm-spin dark" aria-hidden />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {toast && (
        <div className="ifm-toast" role="status">
          {CHECK}
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
