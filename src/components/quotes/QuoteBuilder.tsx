"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  addLineAction,
  applyServiceItemAction,
  deleteLineAction,
  deletePackageAction,
  duplicatePackageAction,
  editLineAction,
  renamePackageAction,
  sendQuoteAction,
  setAddOnOfferedAction,
  setChargeAtAction,
  setPackageOfferedAction,
  withdrawQuoteAction,
} from "@/app/dashboard/quotes/[id]/actions";
import type { ActionState } from "@/app/dashboard/quotes/errors";
// Pure modules only — never the store, which is server-only.
import { chargeBucket, fullProjectCost, type QuoteTotals } from "@/lib/quotes/pricing";
import { normalizePackageName, offerProblems, readOffer } from "@/lib/quotes/packages";
import { moneyFor } from "@/lib/quotes/staff-money";
import { quotePillTone } from "@/lib/quotes/labels";
import { PageHeader } from "@/components/ui/PageHeader";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { Toast } from "@/components/ui/Toast";
import { CANCEL, PROPOSALS_NAME, yesVerb, DELETE } from "@/lib/ui/words";
import { QuoteDetailsForm } from "./QuoteForms";

/**
 * The quote builder — design/Quote_Builder_Prototype.dc.html in the app's own
 * system. Packages offered to the client (tabs with an offer switch), the
 * selected package's lines (inline label/amount, the Charged pill), the
 * government-fee notice, add-ons, the service library, the totals and the
 * activity log.
 *
 * Every change is a server action in `app/dashboard/quotes/[id]/actions.ts`
 * that re-checks attorney+ and the store's role gate on its own; nothing here
 * is a boundary. After an action the route is revalidated and this component
 * re-renders from the database's answer — nothing is optimistic, so the
 * figures on screen are always the stored ones.
 *
 * `packages.ts` holds the mapping onto `crm_quote_line` (a package is the
 * `tier_option` lines sharing a `tier_group`; its offer switch is their
 * `selected`), and every total here comes from `pricing.ts` through it.
 */

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export type BuilderLine = {
  id: string;
  kind: string;
  charge_at: string;
  selection: string;
  tier_group: string | null;
  selected: boolean;
  label: string;
  quantity: number;
  unit_amount_cents: number;
};

export type BuilderEvent = { id: string; time: string; text: string; actor: string };

export type BuilderProps = {
  quoteId: string;
  reference: string;
  title: string;
  /** The EFFECTIVE status (expiry applied). */
  status: string;
  statusLabel: string;
  editable: boolean;
  /** `live`: the rows. `signed`: an accepted quote read from its snapshot.
   * `signed-missing`: accepted, but no readable snapshot — the rows, flagged. */
  mode: "live" | "signed" | "signed-missing";
  client: { label: string; href: string | null } | null;
  expiry: { short: string; days: string } | null;
  details: { introBody: string | null; expiresInput: string };
  publicUrl: string;
  currency: string;
  lines: BuilderLine[];
  drift: string[];
  signed: {
    name: string | null;
    acceptedOn: string;
    packageName: string | null;
    dueAtSigning: number;
    dueAtFiling: number;
    fullProjectCost: number;
  } | null;
  library: { id: string; label: string; unitAmountCents: number; kind: string }[];
  canManageLibrary: boolean;
  events: BuilderEvent[];
  eventsError: boolean;
  termsAttached: boolean;
  matter: { href: string; number: string } | null;
  /** The pre-filled engagement letter for this signed quote (Document Center),
   * or null when the quote isn't signed to a matter or the firm has no Document Center. */
  letterHref?: string | null;
};

type Target = { kind: "package"; name: string } | { kind: "common" };

const GOV_EXPLAINER =
  "Government fees can only be charged at filing — USPTO fees are collected when the application is filed, never at signing.";

function amountInput(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return abs % 100 === 0 ? String(abs / 100) : `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function shortMoney(cents: number, currency: string): string {
  return moneyFor(cents, currency);
}

export function QuoteBuilder(props: BuilderProps) {
  const { quoteId, currency, editable } = props;
  const offer = useMemo(() => readOffer(props.lines, currency), [props.lines, currency]);
  const problems = useMemo(() => (props.mode === "live" && editable ? offerProblems(props.lines) : []), [props.lines, props.mode, editable]);

  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  function note(text: string, tone: "info" | "error" = "info") {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 4200 : 2600);
  }

  function run(action: Action, fields: Record<string, string>, success?: string, after?: () => void) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.append(key, value);
    startTransition(async () => {
      const result = await action({}, fd);
      if (result.error) {
        note(result.error, "error");
        return;
      }
      if (success) note(success);
      after?.();
    });
  }

  /* ── what is being edited ─────────────────────────────────────────────── */

  // A package that exists only on screen until its first line is added —
  // there is no row for an empty package (a package IS its lines). A brand-new
  // quote starts with one, so the first library click has somewhere to go.
  const [draftPackage, setDraftPackage] = useState<string | null>(() =>
    editable && offer.packages.length === 0 && offer.common.length === 0 ? "Package 1" : null,
  );
  const persistedNames = offer.packages.map((pkg) => pkg.name);
  // Once its first line is saved the draft is simply a package like any other.
  const showDraft = draftPackage !== null && !persistedNames.includes(draftPackage) && editable;
  const firstTarget = (): Target =>
    offer.packages[0]
      ? { kind: "package", name: offer.packages[0].name }
      : offer.common.length === 0 && showDraft && draftPackage
        ? { kind: "package", name: draftPackage }
        : { kind: "common" };
  const [target, setTarget] = useState<Target>(firstTarget);

  // After a rename, a removal or a revalidation, never edit a package that is
  // no longer there.
  const targetExists =
    target.kind === "common" ? true : persistedNames.includes(target.name) || (showDraft && target.name === draftPackage);
  const current: Target = targetExists ? target : firstTarget();
  const currentPkg = current.kind === "package" ? offer.packages.find((pkg) => pkg.name === current.name) ?? null : null;
  const targetName = current.kind === "common" ? "every package" : current.name;
  const targetLines = current.kind === "common" ? offer.common : currentPkg?.lines ?? [];
  const targetTotals: QuoteTotals = currentPkg ? currentPkg.totals : offer.commonTotals;
  const placement: Record<string, string> =
    current.kind === "common" ? { placement: "common" } : { placement: "package", packageName: current.name };

  const frozenNote = props.mode === "live" ? "This quote can no longer be edited." : "Accepted quotes are frozen.";

  /* ── panels open/closed ───────────────────────────────────────────────── */
  const [showDetails, setShowDetails] = useState(false);
  const [pkgForm, setPkgForm] = useState<null | "new" | "rename" | "duplicate" | "remove">(null);
  const [pkgName, setPkgName] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [addOnOpen, setAddOnOpen] = useState(false);

  function openPkgForm(kind: "new" | "rename" | "duplicate" | "remove") {
    setPkgForm(kind);
    const n = offer.packages.length + (showDraft ? 1 : 0) + 1;
    setPkgName(kind === "new" ? `Package ${n}` : kind === "duplicate" ? `${current.kind === "package" ? current.name : ""} (copy)` : current.kind === "package" ? current.name : "");
  }

  function submitPkgForm() {
    if (current.kind !== "package" && pkgForm !== "new") return;
    const name = normalizePackageName(pkgName);
    if (pkgForm === "remove") {
      const fallback = (gone: string): Target => {
        const next = offer.packages.find((pkg) => pkg.name !== gone);
        return next ? { kind: "package", name: next.name } : { kind: "common" };
      };
      if (current.kind !== "package") return setPkgForm(null);
      const removed = current.name;
      if (!currentPkg) {
        setDraftPackage(null);
        setPkgForm(null);
        setTarget(fallback(removed));
        return;
      }
      run(deletePackageAction, { quoteId, packageName: removed }, `“${removed}” removed`, () => {
        if (draftPackage === removed) setDraftPackage(null);
        setPkgForm(null);
        setTarget(fallback(removed));
      });
      return;
    }
    if (!name) {
      note("A package needs a name of 1-120 characters.", "error");
      return;
    }
    const taken = persistedNames.includes(name) || (showDraft && draftPackage === name);
    if (pkgForm === "new") {
      if (taken) return note(`There's already a package called “${name}”.`, "error");
      setDraftPackage(name);
      setTarget({ kind: "package", name });
      setPkgForm(null);
      note(`“${name}” started — click a service to add its first line.`);
      return;
    }
    if (current.kind !== "package") return;
    if (pkgForm === "rename") {
      if (name === current.name) return setPkgForm(null);
      if (taken) return note(`There's already a package called “${name}”.`, "error");
      if (!currentPkg) {
        setDraftPackage(name);
        setTarget({ kind: "package", name });
        setPkgForm(null);
        return;
      }
      run(renamePackageAction, { quoteId, packageName: current.name, newName: name }, `Renamed to “${name}”`, () => {
        setTarget({ kind: "package", name });
        setPkgForm(null);
      });
      return;
    }
    if (pkgForm === "duplicate") {
      if (taken) return note(`There's already a package called “${name}”.`, "error");
      run(duplicatePackageAction, { quoteId, packageName: current.name, newName: name }, `“${name}” added as a copy`, () => {
        setTarget({ kind: "package", name });
        setPkgForm(null);
      });
    }
  }

  function toggleOffer(name: string, offered: boolean, mixed: boolean) {
    if (!editable) return note(frozenNote);
    const turningOff = offered && !mixed;
    if (turningOff && !offer.packages.some((pkg) => pkg.name !== name && pkg.offered)) {
      return note("At least one package has to be offered.", "error");
    }
    run(
      setPackageOfferedAction,
      { quoteId, packageName: name, offered: String(!turningOff) },
      turningOff ? `“${name}” withheld — the client won't see it` : `“${name}” offered to the client`,
    );
  }

  function addFromLibrary(item: BuilderProps["library"][number]) {
    if (!editable) return note(frozenNote);
    run(applyServiceItemAction, { quoteId, serviceItemId: item.id, ...placement }, `${item.label} added to ${targetName}`);
  }

  /* ── the send / copy controls (bar and totals panel share them) ───────── */

  function send() {
    if (props.status === "draft") {
      const blocking = problems.find((p) => p.blocksSending);
      if (blocking) return note(blocking.message, "error");
      run(sendQuoteAction, { quoteId }, "Quote sent. The client link is live — nothing was emailed.");
      return;
    }
    if (props.status === "sent") return note("Already sent — the link is live.");
    note(props.mode === "live" ? `This quote is ${props.statusLabel.toLowerCase()}.` : "Accepted — this quote is frozen.");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(props.publicUrl);
      note(props.status === "draft" ? "Link copied — it opens for the client once you send the quote." : "Link copied.");
    } catch {
      note(`Copy this link: ${props.publicUrl}`);
    }
  }

  const sendLabel =
    props.status === "draft"
      ? "Send to client"
      : props.status === "sent"
        ? "Sent · awaiting client"
        : props.status === "accepted"
          ? props.matter
            ? "Accepted · matter open"
            : "Accepted"
          : props.statusLabel;
  const sendIsLive = props.status === "draft";

  const sendButton = (tall: boolean) => (
    <button
      type="button"
      className={`lx-btn ${sendIsLive ? "lx-btn-pri" : "lx-btn-sec"}${tall ? " qb-btn-tall" : ""}`}
      onClick={send}
      disabled={pending && sendIsLive}
      aria-disabled={!sendIsLive}
    >
      {sendLabel}
    </button>
  );
  const copyButton = (tall: boolean) => (
    <button type="button" className={`lx-btn lx-btn-sec${tall ? " qb-btn-tall" : ""}`} onClick={copyLink}>
      Copy client link
    </button>
  );

  const addOnsOffered = offer.addOns.some((addOn) => addOn.offered);
  const chosenName = props.signed?.packageName ?? null;

  return (
    <div className="qb-root">
      <PageHeader
        back={{ href: "/dashboard/quotes/", label: PROPOSALS_NAME }}
        title={props.title}
        count={<Pill tone={quotePillTone(props.status)}>{props.statusLabel}</Pill>}
        sub={props.reference}
        actions={
          <>
            {copyButton(false)}
            {sendButton(false)}
          </>
        }
      />

      <section className="qb-card" aria-label="Quote builder">
        <header className="qb-head">
          {editable && (
            <button type="button" className="lx-link" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              {showDetails ? "Close" : "Edit title, intro & expiry"}
            </button>
          )}
          <div className="qb-head-gap" />
          <span className="qb-head-meta">
            {props.client ? (
              props.client.href ? (
                <Link href={props.client.href}>{props.client.label}</Link>
              ) : (
                props.client.label
              )
            ) : (
              "No client linked"
            )}
            {" · "}
            {props.expiry ? `Expires ${props.expiry.short}${props.expiry.days ? ` · ${props.expiry.days}` : ""}` : "No expiry"}
          </span>
        </header>

        {showDetails && editable && (
          <div className="qb-details">
            <QuoteDetailsForm
              quoteId={quoteId}
              title={props.title}
              introBody={props.details.introBody}
              expiresInput={props.details.expiresInput}
              isLive={props.status === "sent"}
            />
          </div>
        )}

        {props.mode === "signed-missing" && (
          <Notice tone="warn" role="status">
            This quote was accepted, but no readable signed copy is stored. The lines below are the quote&rsquo;s{" "}
            <strong>current</strong> rows, not the signed record.
          </Notice>
        )}
        {props.drift.length > 0 && (
          <Notice tone="warn" role="status">
            <strong>The live lines no longer match what was signed.</strong> The signed copy is
            unchanged and is what governs.
            <ul className="lx-flags">
              {props.drift.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </Notice>
        )}
        {props.mode === "live" && !editable && (
          <Notice tone={props.status === "declined" ? "risk" : "mute"} role="status">
            {props.status === "declined"
              ? "The client declined this proposal. Nothing was signed."
              : props.status === "withdrawn"
                ? "You withdrew this proposal. Its link now shows the client that it isn't available."
                : "This proposal expired before it was signed. Its link now shows the client that it isn't available."}
          </Notice>
        )}

        <div className="qb-cols">
          {/* ── packages, lines, notice, add-ons ── */}
          <div className="qb-main">
            <div>
              <div className="lx-label">Packages offered to the client</div>
              <div className="qb-tabs" role="group" aria-label="Packages">
                {offer.packages.map((pkg) => {
                  const on = current.kind === "package" && current.name === pkg.name;
                  return (
                    <div
                      key={pkg.name}
                      role="button"
                      tabIndex={0}
                      className="qb-tab"
                      aria-pressed={on}
                      onClick={() => setTarget({ kind: "package", name: pkg.name })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setTarget({ kind: "package", name: pkg.name });
                        }
                      }}
                    >
                      <span className="qb-tab-text">
                        <span className="qb-tab-name">{pkg.name}</span>
                        <span className="qb-tab-sum">
                          {shortMoney(pkg.totals.dueAtSigning, currency)} + {shortMoney(pkg.totals.dueAtFiling, currency)} at filing
                        </span>
                      </span>
                      {props.mode === "live" ? (
                        <button
                          type="button"
                          role="switch"
                          className="qb-switch"
                          aria-checked={pkg.offered}
                          aria-label={`Offer ${pkg.name} to the client`}
                          title={pkg.mixed ? "Some lines are switched off — click to offer the whole package" : "Offer this package to the client"}
                          disabled={!editable || pending}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleOffer(pkg.name, pkg.offered, pkg.mixed);
                          }}
                        />
                      ) : (
                        chosenName === pkg.name && <span className="qb-chosen">Chosen</span>
                      )}
                    </div>
                  );
                })}
                {showDraft && draftPackage && (
                  <button
                    type="button"
                    className="qb-tab"
                    aria-pressed={current.kind === "package" && current.name === draftPackage}
                    onClick={() => setTarget({ kind: "package", name: draftPackage })}
                  >
                    <span className="qb-tab-text">
                      <span className="qb-tab-name">{draftPackage}</span>
                      <span className="qb-tab-sum">new · add its first line</span>
                    </span>
                  </button>
                )}
                {(offer.common.length > 0 || current.kind === "common") && (
                  <button type="button" className="qb-tab" aria-pressed={current.kind === "common"} onClick={() => setTarget({ kind: "common" })}>
                    <span className="qb-tab-text">
                      <span className="qb-tab-name">{offer.packages.length > 0 ? "In every package" : "Included"}</span>
                      <span className="qb-tab-sum">
                        {shortMoney(offer.commonTotals.dueAtSigning, currency)} + {shortMoney(offer.commonTotals.dueAtFiling, currency)} at filing
                      </span>
                    </span>
                  </button>
                )}
                {editable && (
                  <button type="button" className="qb-tab qb-tab-add" onClick={() => openPkgForm("new")}>
                    + Package
                  </button>
                )}
              </div>

              {editable && pkgForm === null && (
                <div className="qb-pkg-actions">
                  {current.kind === "package" && (
                    <>
                      <button type="button" className="lx-link" onClick={() => openPkgForm("rename")}>
                        Rename
                      </button>
                      {currentPkg && (
                        <button type="button" className="lx-link" onClick={() => openPkgForm("duplicate")}>
                          Duplicate
                        </button>
                      )}
                      <button type="button" className="lx-link" onClick={() => openPkgForm("remove")}>
                        {currentPkg ? "Remove package" : DELETE}
                      </button>
                    </>
                  )}
                  {current.kind !== "common" && offer.common.length === 0 && (
                    <button type="button" className="lx-link" onClick={() => setTarget({ kind: "common" })}>
                      Add lines every package includes
                    </button>
                  )}
                </div>
              )}
              {editable && pkgForm !== null && (
                <form
                  className="qb-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitPkgForm();
                  }}
                >
                  {pkgForm === "remove" ? (
                    <span className="qb-confirm-q">
                      {currentPkg
                        ? `Remove “${current.kind === "package" ? current.name : ""}” and its ${currentPkg.lines.length} line${currentPkg.lines.length === 1 ? "" : "s"}?`
                        : "Discard this empty package?"}
                    </span>
                  ) : (
                    <input
                      className="lx-input"
                      value={pkgName}
                      onChange={(e) => setPkgName(e.target.value)}
                      maxLength={120}
                      aria-label="Package name"
                      autoFocus
                    />
                  )}
                  <button type="submit" className={`lx-btn lx-btn-sm ${pkgForm === "remove" ? "lx-btn-danger" : "lx-btn-pri"}`} disabled={pending}>
                    {pkgForm === "new" ? "Start package" : pkgForm === "rename" ? "Rename" : pkgForm === "duplicate" ? "Copy package" : "Remove"}
                  </button>
                  <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setPkgForm(null)}>
                    {CANCEL}
                  </button>
                </form>
              )}
            </div>

            <div className="qb-table">
              <div className="qb-row qb-row-head">
                <div>Line · {current.kind === "common" ? (offer.packages.length > 0 ? "In every package" : "Included") : current.name}</div>
                <div className="qb-right">Amount</div>
                <div className="qb-right">Charged</div>
                <div />
              </div>
              {targetLines.length === 0 && (
                <div className="qb-empty">
                  {editable ? "No lines yet. Click a service in the library, or add a custom line." : "No lines."}
                </div>
              )}
              {targetLines.map((line) => (
                <LineRow
                  key={`${line.id}:${line.label}:${line.unit_amount_cents}:${line.charge_at}`}
                  line={line}
                  quoteId={quoteId}
                  editable={editable}
                  pending={pending}
                  currency={currency}
                  run={run}
                  note={note}
                  frozenNote={frozenNote}
                />
              ))}
              {editable && (
                <div className="qb-table-foot">
                  <span>Add a line from the service library</span>
                  <button type="button" className="lx-link" onClick={() => setCustomOpen((v) => !v)}>
                    {customOpen ? "Close" : "+ Custom line"}
                  </button>
                </div>
              )}
              {editable && customOpen && (
                <CustomLineForm
                  pending={pending}
                  onAdd={(fields) => run(addLineAction, { quoteId, ...placement, ...fields }, `${fields.label} added to ${targetName}`)}
                />
              )}
            </div>

            <Notice tone="warn">
              Government fees can only be charged at filing. The charge schedule on those lines is fixed — clicking the
              pill tells you so.
            </Notice>

            {problems.length > 0 && (
              <Notice tone="warn" role="status">
                <strong>Before the client can sign</strong>
                <ul className="qb-problems">
                  {problems.map((p, i) => (
                    <li key={`${p.reason}-${p.lineId ?? p.packageName ?? i}`}>{p.message}</li>
                  ))}
                </ul>
              </Notice>
            )}

            <div>
              <div className="lx-label">Optional add-ons · client chooses</div>
              {offer.addOns.length === 0 && (
                <p className="lx-note qb-note">
                  No add-ons. {editable ? "Add one the client can tick on their page." : ""}
                </p>
              )}
              <div className="qb-addons">
                {offer.addOns.map(({ line, offered }) => (
                  <AddOnCard
                    key={`${line.id}:${line.unit_amount_cents}:${line.selected}`}
                    line={line}
                    offered={props.mode === "live" ? offered : line.selected}
                    mode={props.mode}
                    quoteId={quoteId}
                    editable={editable}
                    pending={pending}
                    currency={currency}
                    run={run}
                    note={note}
                    frozenNote={frozenNote}
                  />
                ))}
              </div>
              {editable && (
                <AddOnForm
                  open={addOnOpen}
                  setOpen={setAddOnOpen}
                  library={props.library}
                  pending={pending}
                  currency={currency}
                  onLibrary={(item) => run(applyServiceItemAction, { quoteId, serviceItemId: item.id, placement: "add_on" }, `${item.label} added as an add-on`)}
                  onCustom={(fields) => run(addLineAction, { quoteId, placement: "add_on", kind: "legal_fee", ...fields }, `${fields.label} added as an add-on`)}
                />
              )}
            </div>
          </div>

          {/* ── service library ── */}
          <aside className="qb-lib" aria-label="Service library">
            <div className="lx-label">Service library</div>
            {props.library.length === 0 ? (
              <p className="lx-note qb-note">
                No services yet.{" "}
                {props.canManageLibrary ? (
                  <Link href="/dashboard/settings/services/">Add them in Settings</Link>
                ) : (
                  "Owners and admins add them in Settings."
                )}
              </p>
            ) : (
              <div className="qb-lib-list">
                {props.library.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="qb-lib-item"
                    data-gov={item.kind === "government_fee"}
                    onClick={() => addFromLibrary(item)}
                    disabled={pending && editable}
                    title={item.kind === "government_fee" ? "Government fee — charged at filing" : undefined}
                  >
                    <span className="qb-lib-label">{item.label}</span>
                    <span className="qb-lib-price">{shortMoney(item.unitAmountCents, currency)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="qb-lib-foot">{editable ? `Click to add to ${targetName}.` : frozenNote}</div>
          </aside>

          {/* ── totals ── */}
          <aside className="qb-totals" aria-label="Totals">
            <div className="lx-label">Totals · {current.kind === "common" ? (offer.packages.length > 0 ? "every package" : "included") : current.name}</div>
            <div>
              <div className="qb-big">{moneyFor(targetTotals.dueAtSigning, currency)}</div>
              <div className="qb-sum-label">Due at signing</div>
              <div className="qb-sum-note">
                Legal fees, due when the client signs.
                {addOnsOffered && props.mode === "live" ? " Add-ons the client picks are added to this." : ""}
              </div>
            </div>
            <div className="qb-rule" />
            <div>
              <div className="qb-mid">{moneyFor(targetTotals.dueAtFiling, currency)}</div>
              <div className="qb-sum-label">Due at filing (USPTO)</div>
              <div className="qb-sum-note">Government fees. Collected when the applications are filed.</div>
            </div>
            <div className="qb-project">Full project cost {moneyFor(fullProjectCost(targetTotals), currency)}</div>
            {props.signed && (
              <div className="qb-frozen">
                <div className="qb-frozen-kicker">Accepted · frozen</div>
                <p>
                  {props.signed.name ?? "The client"} accepted {props.signed.packageName ? `“${props.signed.packageName}”` : "this quote"} on{" "}
                  {props.signed.acceptedOn} — {moneyFor(props.signed.dueAtSigning, currency)} due at signing,{" "}
                  {moneyFor(props.signed.dueAtFiling, currency)} held for filing. This quote is now read-only.
                </p>
                {props.matter && (
                  <p>
                    Matter <Link href={props.matter.href}>{props.matter.number}</Link> opened automatically.
                  </p>
                )}
                {props.letterHref && (
                  <p>
                    <Link href={props.letterHref}>Draft engagement letter</Link>, pre-filled from this signed copy.
                  </p>
                )}
              </div>
            )}
            <div className="qb-grow" />
            <div className="qb-actions">
              <div className="qb-terms-line">
                {termsLine(editable, props.status === "accepted", props.termsAttached)}
              </div>
              {sendButton(true)}
              {copyButton(true)}
              {props.status === "sent" && props.mode === "live" && (
                <InlineConfirm
                  label="Withdraw quote"
                  question="Withdraw? The link stops working."
                  confirmLabel={yesVerb("withdraw")}
                  className="lx-link qb-withdraw"
                  pending={pending}
                  onConfirm={() => run(withdrawQuoteAction, { quoteId }, "Quote withdrawn.")}
                />
              )}
            </div>
          </aside>
        </div>

        <footer className="qb-activity">
          <div className="lx-label">Activity</div>
          {props.eventsError ? (
            <Notice tone="risk" role="alert">
              Can&rsquo;t show this quote&rsquo;s activity right now. Refresh to try again.
            </Notice>
          ) : props.events.length === 0 ? (
            <p className="lx-note">No activity yet.</p>
          ) : (
            props.events.map((event) => (
              <div key={event.id} className="qb-event" data-actor={event.actor}>
                <span className="qb-event-time">{event.time}</span>
                <span className="qb-event-text">{event.text}</span>
              </div>
            ))
          )}
        </footer>
      </section>

      {toast &&
        (toast.tone === "error" ? (
          <div className="lx-toast qb-toast-error" role="alert" data-tone="error">
            {toast.text}
          </div>
        ) : (
          <Toast>{toast.text}</Toast>
        ))}
    </div>
  );
}

/** The design's "Terms:" line, true to the quote's state. Nothing is ever
 * charged through Lectual, so no line here promises a payment step. */
function termsLine(editable: boolean, accepted: boolean, attached: boolean): string {
  if (editable) {
    return attached
      ? "Terms: engagement letter signed with the quote · nothing is charged on the client's page"
      : "Terms: no engagement letter yet — add one below";
  }
  if (accepted) return attached ? "Terms: the engagement letter below was signed with the quote" : "Terms: signed without an engagement letter";
  return attached ? "Terms: engagement letter below — never signed" : "Terms: no engagement letter was attached";
}

/* ── one line of the table ─────────────────────────────────────────────── */

type RunFn = (action: Action, fields: Record<string, string>, success?: string, after?: () => void) => void;
type NoteFn = (text: string, tone?: "info" | "error") => void;

function LineRow(props: {
  line: BuilderLine;
  quoteId: string;
  editable: boolean;
  pending: boolean;
  currency: string;
  run: RunFn;
  note: NoteFn;
  frozenNote: string;
}) {
  const { line, quoteId, editable } = props;
  const bucket = chargeBucket(line);
  const gov = line.kind === "government_fee";
  const hidden = { quoteId, lineId: line.id };
  const whenLabel = bucket === "filing" ? "At filing" : bucket === "signing" ? "At signing" : "No charge";

  function onPill() {
    if (gov) return props.note(GOV_EXPLAINER);
    if (!editable) return props.note(props.frozenNote);
    const next = bucket === "signing" ? "filing" : "signing";
    props.run(setChargeAtAction, { ...hidden, chargeAt: next }, next === "filing" ? `${line.label} moved to filing` : `${line.label} moved to signing`);
  }

  function commitLabel(value: string) {
    const label = value.trim();
    if (label === line.label) return;
    if (!label) return props.note("A line needs a label.", "error");
    props.run(editLineAction, { ...hidden, label });
  }

  function commitAmount(value: string) {
    if (value.trim() === amountInput(line.unit_amount_cents)) return;
    props.run(editLineAction, { ...hidden, kind: line.kind, amount: value });
  }

  return (
    <div className="qb-row">
      <input
        className="qb-cell-input"
        defaultValue={line.label}
        disabled={!editable}
        aria-label="Line label"
        maxLength={300}
        onBlur={(e) => commitLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <div className="qb-amount">
        {line.quantity > 1 && <span className="qb-qty">{line.quantity} ×</span>}
        <span>{line.kind === "discount" ? "−$" : "$"}</span>
        <input
          className="qb-cell-input"
          defaultValue={amountInput(line.unit_amount_cents)}
          disabled={!editable}
          inputMode="decimal"
          aria-label={`Amount for ${line.label}`}
          onBlur={(e) => commitAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
      <div className="qb-right">
        <button
          type="button"
          className="qb-pill"
          data-when={bucket}
          data-locked={gov}
          onClick={onPill}
          title={gov ? "Government fees are fixed to filing" : editable ? `Click to charge ${bucket === "signing" ? "at filing" : "at signing"}` : undefined}
        >
          {whenLabel}
        </button>
      </div>
      <button
        type="button"
        className="qb-remove"
        aria-label={`Remove ${line.label}`}
        title="Remove line"
        disabled={!editable || props.pending}
        onClick={() => props.run(deleteLineAction, hidden, `${line.label} removed`)}
      />
    </div>
  );
}

/* ── a custom line ─────────────────────────────────────────────────────── */

function CustomLineForm({ pending, onAdd }: { pending: boolean; onAdd: (fields: { label: string; kind: string; amount: string }) => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("legal_fee");
  const [amount, setAmount] = useState("");
  return (
    <form
      className="qb-inline-form"
      data-flush="true"
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        onAdd({ label: label.trim(), kind, amount });
        setLabel("");
        setAmount("");
      }}
    >
      <input className="lx-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="New line label" maxLength={300} required />
      <select className="lx-input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
        <option value="legal_fee">Legal fee</option>
        <option value="government_fee">Government fee (USPTO)</option>
        <option value="expense">Expense</option>
        <option value="discount">Discount</option>
      </select>
      <input
        className="lx-input"
        style={{ flex: "0 1 110px" }}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount"
        inputMode="decimal"
        aria-label="New line amount"
        required
      />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        Add line
      </button>
    </form>
  );
}

/* ── add-ons ───────────────────────────────────────────────────────────── */

function AddOnCard(props: {
  line: BuilderLine;
  offered: boolean;
  mode: BuilderProps["mode"];
  quoteId: string;
  editable: boolean;
  pending: boolean;
  currency: string;
  run: RunFn;
  note: NoteFn;
  frozenNote: string;
}) {
  const { line, offered, editable } = props;
  const hidden = { quoteId: props.quoteId, lineId: line.id };
  const when = chargeBucket(line) === "filing" ? "At filing" : "At signing";
  const status = props.mode === "live" ? (offered ? `${when} · offered` : "Not offered") : offered ? `${when} · taken` : "Not taken";
  return (
    <div className="qb-addon" data-offered={offered}>
      <div className="qb-addon-head">
        <div className="qb-addon-label">{line.label}</div>
        {props.mode === "live" && (
          <button
            type="button"
            role="switch"
            className="qb-switch"
            aria-checked={offered}
            aria-label={`Offer ${line.label}`}
            title="Offer this add-on"
            disabled={!editable || props.pending}
            onClick={() =>
              props.run(
                setAddOnOfferedAction,
                { ...hidden, offered: String(!offered) },
                offered ? `${line.label} withheld` : `${line.label} offered`,
              )
            }
          />
        )}
      </div>
      <div className="qb-amount">
        <span>$</span>
        <input
          className="qb-cell-input"
          defaultValue={amountInput(line.unit_amount_cents)}
          disabled={!editable}
          inputMode="decimal"
          aria-label={`Amount for ${line.label}`}
          onBlur={(e) => {
            if (e.target.value.trim() === amountInput(line.unit_amount_cents)) return;
            props.run(editLineAction, { ...hidden, kind: line.kind, amount: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
      <div className="qb-addon-foot">
        <span>{status}</span>
        <button
          type="button"
          className="qb-remove"
          aria-label={`Remove ${line.label}`}
          title="Remove add-on"
          disabled={!editable || props.pending}
          onClick={() => props.run(deleteLineAction, hidden, `${line.label} removed`)}
        />
      </div>
    </div>
  );
}

function AddOnForm(props: {
  open: boolean;
  setOpen: (open: boolean) => void;
  library: BuilderProps["library"];
  pending: boolean;
  currency: string;
  onLibrary: (item: BuilderProps["library"][number]) => void;
  onCustom: (fields: { label: string; amount: string }) => void;
}) {
  const [choice, setChoice] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  if (!props.open) {
    return (
      <button type="button" className="lx-link qb-add-addon" onClick={() => props.setOpen(true)}>
        + Add-on
      </button>
    );
  }
  const custom = choice === "custom";
  return (
    <form
      className="qb-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (custom) {
          if (!label.trim()) return;
          props.onCustom({ label: label.trim(), amount });
          setLabel("");
          setAmount("");
        } else {
          const item = props.library.find((i) => i.id === choice);
          if (item) props.onLibrary(item);
        }
        setChoice("");
        props.setOpen(false);
      }}
    >
      <select className="lx-input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Add-on" required>
        <option value="" disabled>
          Choose a service…
        </option>
        {props.library.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label} — {shortMoney(item.unitAmountCents, props.currency)}
          </option>
        ))}
        <option value="custom">Something else…</option>
      </select>
      {custom && (
        <>
          <input className="lx-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Add-on label" maxLength={300} required />
          <input
            className="lx-input"
            style={{ flex: "0 1 110px" }}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            inputMode="decimal"
            aria-label="Add-on amount"
            required
          />
        </>
      )}
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={props.pending}>
        Add add-on
      </button>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => props.setOpen(false)}>
        {CANCEL}
      </button>
    </form>
  );
}
