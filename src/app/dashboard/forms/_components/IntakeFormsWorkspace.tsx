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
import { NOT_LIVE_MESSAGE, shareState } from "@/lib/intake-forms/share";
import { intakeEmbedSnippet, intakePublicUrl } from "@/lib/intake-forms/links";
import type { IntakeFormRecord } from "@/lib/intake-forms/store";
import { DETAIL_LIMITS, type IntakeDetails } from "@/lib/intake-forms/details";
import { saveIntakeFormAction } from "../actions";
import { IntakePreview } from "./IntakePreview";
import { IntakeQrButton } from "./IntakeQr";
import { IntakeLinksForChannels } from "./IntakeLinksForChannels";
import { AssessmentPreview, AssessmentSettingsCard } from "./AssessmentSettings";
import { OptionsEditor, QuestionTypeSelect } from "./ChoiceEditor";
import { isChoice, questionType } from "@/lib/intake-forms/choice";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { Icon, Notice, PageHeader, PageTabs, Pill, Toast } from "@/components/ui";
import { MoreMenu } from "@/components/list-page/MoreMenu";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import { formatDay } from "@/lib/ui/dates";
import { FORMS_NAME, SAVING } from "@/lib/ui/words";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";

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
 * The Performance and Results tabs are rendered on the server and handed in as
 * `performance` and `results`, so switching tabs (a soft navigation to
 * `?tab=performance` or `?tab=results`) keeps unsaved edits: this component
 * stays mounted and its state with it.
 *
 * Read-only for everyone below senior_admin: every control sits in a disabled
 * <fieldset>, and the Save action refuses them regardless.
 */

export type WorkspacePackage = { id: string; name: string; price: string; includes: string };

type Props = {
  form: IntakeFormRecord;
  /** The firm's time zone, for the dates on this page. */
  timeZone?: string;
  orgName: string;
  packages: { status: "ok"; items: WorkspacePackage[] } | { status: "unavailable" };
  origin: string;
  canEdit: boolean;
  tab: "setup" | "performance" | "results";
  range: number;
  performance: ReactNode;
  results: ReactNode;
};

type Snapshot = { config: IntakeFormConfig; domains: string[]; details: IntakeDetails };

const detailsOf = (f: IntakeFormRecord): IntakeDetails => ({ name: f.name, slug: f.slug, sourceTag: f.sourceTag });

const LOCK = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  </svg>
);
const CHECK = <Icon name="check" size={12} />;

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
  const [details, setDetails] = useState<IntakeDetails>(() => detailsOf(form));
  const [saved, setSaved] = useState<Snapshot>({ config: form.config, domains: form.allowedDomains, details: detailsOf(form) });
  const [status, setStatus] = useState(form.status);
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [domInput, setDomInput] = useState("");
  const [pvTheme, setPvTheme] = useState<"light" | "dark">(form.config.theme === "dark" ? "dark" : "light");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = useMemo(
    () => JSON.stringify({ config, domains, details }) !== JSON.stringify({ config: saved.config, domains: saved.domains, details: saved.details }),
    [config, domains, details, saved],
  );

  // The link as saved: an unsaved rename isn't live yet.
  const publicUrl = intakePublicUrl(props.origin, saved.details.slug);
  const embed = intakeEmbedSnippet(props.origin, saved.details.slug);
  const isAssessment = form.kind === "assessment";
  const items = goLiveChecklist(config, {
    receivesReferrals: form.receivesReferrals,
    agreementSigned: form.agreementSignedAt !== null,
    kind: form.kind,
  });
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
      const res = await saveIntakeFormAction({ id: form.id, config, allowedDomains: domains, details });
      if (!res.ok) {
        setSaveError(res.error);
        flash("Not saved");
        return;
      }
      const next = { config: res.form.config, domains: res.form.allowedDomains, details: detailsOf(res.form) };
      setConfig(next.config);
      setDomains(next.domains);
      setDetails(next.details);
      setSaved(next);
      setStatus(res.form.status);
      setShowErrors(res.remaining > 0);
      flash(res.remaining ? `Saved as draft · ${res.remaining} left to go live` : res.form.status === "live" ? "Saved · live" : "Saved");
    });
  };

  const discard = () => {
    setConfig(saved.config);
    setDomains(saved.domains);
    setDetails(saved.details);
    setShowErrors(false);
    setSaveError(null);
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
  const archived = status === "archived";
  const shareable = shareState(status).canShare;
  const base = `/dashboard/forms/?form=${encodeURIComponent(form.id)}`;
  const tabHref = (t: "setup" | "performance" | "results") => (t === "setup" ? base : `${base}&tab=${t}&range=${props.range}`);
  const firmDisplay = config.firmName.trim() || props.orgName;
  const agreementSigned = form.agreementSignedAt !== null;

  return (
    <div className="ifm-root">
      <PageHeader
        className="ifm-head"
        back={{ href: "/dashboard/forms/", label: FORMS_NAME }}
        title={saved.details.name}
        sub={saved.details.sourceTag ? `Leads from it are tagged “${saved.details.sourceTag}”.` : "How it looks, what it asks, and where it lives."}
        actions={
          <>
            <Pill tone={live ? "ok" : "mute"}>{live ? "Live" : archived ? "Archived" : "Draft"}</Pill>
            <a className="lx-btn lx-btn-sec" href="#ifm-sec-share">
              Share
            </a>
            {canEdit && (
              <button type="button" className="lx-btn lx-btn-pri" onClick={save} disabled={saving || !dirty} aria-busy={saving}>
                {saving ? SAVING : "Save changes"}
              </button>
            )}
          </>
        }
      />

      <PageTabs
        label="Forms"
        tabs={[
          { href: tabHref("setup"), label: "Setup", current: props.tab === "setup", scroll: false },
          { href: tabHref("results"), label: "Results", current: props.tab === "results", scroll: false },
          { href: tabHref("performance"), label: "Performance", current: props.tab === "performance", scroll: false },
        ]}
      />

      {props.tab === "performance" ? (
        props.performance
      ) : props.tab === "results" ? (
        props.results
      ) : (
        <div className="ifm-setup">
          <div className="ifm-editor-col">
          <fieldset className="ifm-editor" disabled={!canEdit}>
            {!canEdit && (
              <Notice tone="mute">You can look but not change. {ADMIN_TIER_PHRASE} can edit the intake.</Notice>
            )}
            {saveError && (
              <Notice tone="risk" role="alert">
                {saveError}
              </Notice>
            )}

            <section id="ifm-sec-details" className="ifm-card">
              <h2 className="ifm-title">Name, link and source</h2>
              <label className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label ifm-grow">
                    Name
                  </span>
                  <Counter n={details.name.length} max={DETAIL_LIMITS.name} />
                </span>
                <input
                  className="ifm-input"
                  value={details.name}
                  maxLength={DETAIL_LIMITS.name}
                  placeholder="e.g. UGW 2026 booth"
                  onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                />
                <span className="ifm-help">Only your firm sees this name.</span>
              </label>
              <label className="ifm-field">
                <span className="ifm-field-label">Link</span>
                <span className="ifm-slug">
                  <span className="ifm-slug-prefix">{`${props.origin.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/i/`}</span>
                  <input
                    className="ifm-input ifm-slug-input"
                    value={details.slug}
                    maxLength={60}
                    spellCheck={false}
                    autoCapitalize="off"
                    aria-label="Link name"
                    onChange={(e) =>
                      setDetails((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "") }))
                    }
                  />
                </span>
                <span className="ifm-help">
                  {details.slug !== saved.details.slug
                    ? `Saving moves the link. The old one (/i/${saved.details.slug}) keeps working, so printed QR codes still land here.`
                    : "Letters, numbers and hyphens, like ugw-2026."}
                </span>
              </label>
              <label className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label ifm-grow">
                    Source tag
                  </span>
                  <Counter n={(details.sourceTag ?? "").length} max={DETAIL_LIMITS.sourceTag} />
                </span>
                <input
                  className="ifm-input"
                  value={details.sourceTag ?? ""}
                  maxLength={DETAIL_LIMITS.sourceTag}
                  placeholder="e.g. UGW 2026"
                  onChange={(e) => setDetails((d) => ({ ...d, sourceTag: e.target.value || null }))}
                />
                <span className="ifm-help">Every lead from this intake shows this as its source, so you know which event or page they came from.</span>
              </label>
            </section>

            {archived ? (
              <Notice tone="mute">Archived: the link doesn&apos;t take new people. Its leads and numbers are kept. Restore it from the Forms list.</Notice>
            ) : allDone ? (
              <Notice tone="ok">
                <Icon name="check" size={18} />
                <span className="ifm-grow">{live && !dirty ? `Live at ${publicUrl.replace(/^https?:\/\//, "")}` : "Ready to go live. Save to publish."}</span>
                {live && !dirty && (
                  <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => copy(publicUrl, "Link copied")}>
                    Copy
                  </button>
                )}
              </Notice>
            ) : (
              <div className="ifm-card ifm-checklist">
                <div className="ifm-checklist-head">
                  <div className="ifm-title ifm-grow">
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

            {isAssessment ? (
              <AssessmentSettingsCard settings={config.assessment} onChange={(assessment) => edit({ assessment })} />
            ) : (
              <>
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
              {/* "What the assistant knows" is saved with the form but nothing reads it yet (no screening or chat code uses it), so it is not offered; any stored text is left as it is. */}
            </section>

              </>
            )}

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

            {!isAssessment && (
              <>
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
                <FilterChips label="IP packs">
                  {IP_TYPES.map((p) => {
                    const on = config.packs.includes(p);
                    return (
                      <Chip key={p} active={on} pressed={on} onClick={() => onPack(p)}>{p}</Chip>
                    );
                  })}
                </FilterChips>
              </div>

              {config.questions.length > 0 ? (
                <ol className="ifm-qlist">
                  {config.questions.map((q, i) => (
                    <li
                      key={q.id}
                      className={`ifm-q${isChoice(q) ? " has-options" : ""}${justAdded.has(q.id) ? " added" : ""}${drag === q.id ? " dragging" : ""}${over === q.id && drag && drag !== q.id ? " over" : ""}`}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", q.id);
                        setDrag(q.id);
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
                      <QuestionTypeSelect
                        type={questionType(q)}
                        label={`Question ${i + 1}`}
                        disabled={!canEdit}
                        onChange={(fields) => edit((c) => ({ questions: c.questions.map((x) => (x.id === q.id ? { id: x.id, text: x.text, required: x.required, pack: x.pack, edited: true, ...fields } : x)) }))}
                      />
                      {q.pack && <span className="ifm-q-pack">{q.pack}</span>}
                      <span className="ifm-q-req">
                        <span className="ifm-help">Required</span>
                        <Toggle on={q.required} label={`Question ${i + 1} required`} onClick={() => editQ(q.id, { required: !q.required })} />
                      </span>
                      <span className="ifm-q-more">
                        <MoreMenu
                          items={[
                            { label: "Move up", disabled: i === 0, onSelect: () => edit((c) => ({ questions: moveQuestion(c.questions, i, -1) })) },
                            { label: "Move down", disabled: i === config.questions.length - 1, onSelect: () => edit((c) => ({ questions: moveQuestion(c.questions, i, 1) })) },
                            { label: "Remove", tone: "danger", onSelect: () => edit((c) => ({ questions: c.questions.filter((x) => x.id !== q.id) })) },
                          ]}
                        />
                      </span>
                      {isChoice(q) && (
                        <div className="ifm-q-options">
                          <OptionsEditor options={q.options ?? []} label={`Question ${i + 1}`} disabled={!canEdit} onChange={(options) => editQ(q.id, { options, edited: true })} />
                        </div>
                      )}
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
                <span className="ifm-field-label ifm-grow">
                  Show my flat-fee packages in the intake.
                </span>
                <Toggle on={config.feesOn} label="Show fee packages" onClick={() => edit({ feesOn: !config.feesOn })} />
              </div>
              {props.packages.status === "unavailable" ? (
                <Notice tone="warn">Your packages couldn&apos;t be loaded just now, so none are listed here. Your saved choices are kept.</Notice>
              ) : packages.length > 0 ? (
                <>
                  <ul className={`ifm-pkgs${config.feesOn ? "" : " off"}`}>
                    {packages.map((p) => {
                      const shown = config.visiblePackageIds.includes(p.id);
                      return (
                        <li key={p.id}>
                          <div className="ifm-grow">
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
                  <span className="ifm-grow">No packages yet.</span>
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

              </>
            )}

            <section id="ifm-sec-screening" className="ifm-card">
              <h2 className="ifm-title">{isAssessment ? "After they finish" : "Screening"}</h2>
              {!isAssessment && (
              <div className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label">Fit criteria</span>
                  <span className="ifm-private">{LOCK} Only you see this</span>
                </span>
                <span className="ifm-help">IP type</span>
                <FilterChips label="IP type">
                  {IP_TYPES.map((p) => {
                    const on = config.fitIp.includes(p);
                    return (
                      <Chip key={p} active={on} pressed={on} onClick={() => edit((c) => ({ fitIp: on ? c.fitIp.filter((x) => x !== p) : IP_TYPES.filter((x) => x === p || c.fitIp.includes(x)) }))}>{p}</Chip>
                    );
                  })}
                </FilterChips>
                <span className="ifm-help">Jurisdiction</span>
                <FilterChips label="Jurisdiction">
                  {JURS.map((p) => {
                    const on = config.fitJur.includes(p);
                    return (
                      <Chip key={p} active={on} pressed={on} onClick={() => edit((c) => ({ fitJur: on ? c.fitJur.filter((x) => x !== p) : JURS.filter((x) => x === p || c.fitJur.includes(x)) }))}>{p}</Chip>
                    );
                  })}
                </FilterChips>
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
              )}
              <label className="ifm-field">
                <span className="ifm-field-head">
                  <span className="ifm-field-label ifm-grow">
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
                <p className="ifm-help">This applies because your firm receives referred founders from Lectual.</p>
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
                    <Pill tone={agreementSigned ? "ok" : "warn"}>
                      {agreementSigned ? `Signed ${formatDay(form.agreementSignedAt as string, { tz: props.timeZone ?? DEFAULT_TIME_ZONE }) ?? ""}`.trim() : "Not signed"}
                    </Pill>
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
                <div className="vs-switch" role="group" aria-label="Theme">
                  {(["light", "dark", "auto"] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={config.theme === t} onClick={() => setTheme(t)}>
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
                <span className="ifm-field-label ifm-grow">
                  Show &lsquo;Powered by Lectual&rsquo;
                </span>
                <Toggle on={config.powered} label="Show Powered by Lectual" onClick={() => edit({ powered: !config.powered })} />
              </div>
              <p className="ifm-help">Applies to your public link and the embedded widget.</p>
            </section>
          </fieldset>

          <section id="ifm-sec-share" className="ifm-card">
              <h2 className="ifm-title">Share</h2>
              {shareable ? (
                <>
                  <div className="ifm-field">
                    <span className="ifm-field-label">Direct link</span>
                    <div className="ifm-row ifm-row-wrap">
                      <input className="ifm-input ifm-readonly" value={publicUrl} readOnly aria-label="Direct link" />
                      <button type="button" className="lx-btn lx-btn-sec" onClick={() => copy(publicUrl, "Link copied")}>
                        Copy link
                      </button>
                      <IntakeQrButton url={publicUrl} name={saved.details.name} slug={saved.details.slug} />
                      <a className="lx-btn lx-btn-sec" href={publicUrl} target="_blank" rel="noopener noreferrer">
                        Preview
                      </a>
                    </div>
                  </div>
                  <IntakeLinksForChannels slug={saved.details.slug} name={saved.details.name} sourceTag={saved.details.sourceTag} origin={props.origin} shareable />
                  <details className="ifm-field ifm-embed">
                    <summary className="ifm-field-label">Embed on a website (for your web person)</summary>
                    <span className="ifm-field-head">
                      <span className="ifm-field-label ifm-grow">
                        Put this on your website
                      </span>
                      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => copy(embed, "Website code copied")}>
                        Copy
                      </button>
                    </span>
                    <pre className="ifm-code">{embed}</pre>
                  </details>
                </>
              ) : (
                <>
                  <p id="ifm-notlive" className="ifm-help" role="status">
                    {NOT_LIVE_MESSAGE}
                  </p>
                  <div className="ifm-row">
                    <button type="button" className="lx-btn lx-btn-sec" disabled aria-describedby="ifm-notlive">
                      Copy link
                    </button>
                    <IntakeQrButton url={publicUrl} name={saved.details.name} slug={saved.details.slug} shareable={false} describedBy="ifm-notlive" />
                    <button type="button" className="lx-btn lx-btn-sec" disabled aria-describedby="ifm-notlive">
                      Preview
                    </button>
                  </div>
                  <IntakeLinksForChannels slug={saved.details.slug} name={saved.details.name} sourceTag={saved.details.sourceTag} origin={props.origin} shareable={false} />
                </>
              )}
              <fieldset className="ifm-bare" disabled={!canEdit}>
              <div className="ifm-field">
                <span className="ifm-field-label">Websites allowed to show this form</span>
                <div className="ifm-domains">
                  {domains.map((d) => (
                    <span key={d} className="ifm-domain">
                      <span>{d}</span>
                      <button type="button" aria-label={`Remove ${d}`} onClick={() => setDomains(domains.filter((x) => x !== d))}>
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={domInput}
                    placeholder="yourfirm.com"
                    aria-label="Add a website"
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
                <span className="ifm-help">Leave empty to allow any website. Add your own website to stop others from embedding it.</span>
              </div>
              </fieldset>
            </section>
              {canEdit && (
                <div className="ifm-row ifm-save-row">
                  <button type="button" className="lx-btn lx-btn-pri" onClick={save} disabled={saving || !dirty} aria-busy={saving}>
                    {saving ? SAVING : "Save changes"}
                  </button>
                </div>
              )}

          </div>

          {isAssessment ? (
            <AssessmentPreview settings={config.assessment} />
          ) : (
            <IntakePreview config={config} orgName={props.orgName} packages={config.feesOn ? visiblePkgs : []} theme={pvTheme} onTheme={setPvTheme} />
          )}
        </div>
      )}

      {canEdit && (dirty || saving) && (
        <div className="lx-unsaved" data-save-bar role="region" aria-label="Unsaved changes">
          <span className="ifm-grow">Unsaved changes</span>
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={discard} disabled={saving}>
            Discard
          </button>
          <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" onClick={save} disabled={saving}>
            {saving ? SAVING : "Save"}
          </button>
        </div>
      )}

      {toast && <Toast>{toast}</Toast>}
    </div>
  );
}
