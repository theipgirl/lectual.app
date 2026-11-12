"use client";

import { useMemo, useState, type ReactNode } from "react";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import {
  DESCRIBE_BEFORE_ACCEPT,
  MAX_CLIENT_TEXT_CHARS,
  clientAddMax,
  quoteForAcceptance,
  quoteWithClientClasses,
  type ClientAddedEntry,
  type ClientClassInput,
} from "@/lib/proposals/client-classes";
import { classLock, markWithoutClass } from "@/lib/proposals/class-lock";
import {
  chosenMarkPackage,
  chosenPackage,
  defaultSelection,
  isFixedOffer,
  offerPricing,
  packageChoiceOptions,
  lockedSelectionIds,
  normalizeSelection,
  priceForClassCount,
  quoteHasItems,
  quoteProposal,
  usesMarkPackages,
} from "@/lib/proposals/pricing";
import {
  MARK_KIND_DEFAULT_DESC,
  MARK_KIND_LABEL,
  type PackageOffer,
  type ProposalContent,
  type ProposalInclude,
  type ProposalPricing,
  type ProposalQuote,
  type Selection,
} from "@/lib/proposals/types";
import { commitmentSentence } from "@/lib/proposals/commitment";
import { chosenPackageNames } from "@/lib/proposals/chosen-packages";
import { isGeneralContent } from "@/lib/proposals/types";
import { GeneralProposalDocument } from "./GeneralProposalDocument";
import { usptoLine } from "@/lib/proposals/uspto-line";
import { MARK_PACKAGE_WORDS, packageLineTitle } from "@/lib/proposals/name-package";
import { markDisplayPrices } from "./display";
import { ATTORNEY_FOOTER_LETTER_LINE, DOWNLOAD_REVIEW_LABEL, LETTER_HEADING, LETTER_INTRO, READ_LETTER_FIRST, SIGN_MESSAGES } from "@/lib/loe/client-words";
import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import type { SignerDetails, SigningInput } from "@/lib/loe/signing";
import { LoeDetailsForm } from "./LoeDetailsForm";
import { LoeIncludesLink } from "./LoeIncludesLink";
import { letterLogoForBrand } from "@/lib/loe/letter-logo";
import { LoeLetterPanel } from "./LoeLetterPanel";
import { DownloadPdfButton, LoeSignedLetter } from "./LoeReceipt";
import { LoeSideAction } from "./LoeSideAction";
import { LoeSignPanel } from "./LoeSignPanel";
import { LoeStepBar } from "./LoeStepBar";
import { saveDetailsInBackground, useLoeFlow, type LoeLetterData, type LoeStep } from "./loe-flow";
import { RPB_FONT_VARS } from "./fonts";
import {
  brandForSlug,
  formatCivilDate,
  money,
  paragraphs,
  richSegments,
  safeHttpsUrl,
  type ProposalBrand,
} from "./format";
import "./proposal.css";

/**
 * The client's whole proposal view: one component for the public page
 * (`/p/[token]`) and the dashboard editor's live preview.
 *
 * Every price on screen comes from `quoteProposal` (the function the server
 * runs again at acceptance); this file formats, it does not calculate. All
 * firm and client text is rendered as text, never HTML (`format.ts#richSegments`
 * is the only markup, and it produces React elements, not strings).
 *
 * Modes:
 *  - live:     boxes work, the Accept button calls `onAccept`.
 *  - preview:  boxes work, Accept is disabled and labelled "Preview".
 *  - accepted: a receipt of what was accepted, with the "Pay my legal fee" link.
 *              A live page switches to this view itself once `onAccept` succeeds.
 */

/**
 * `signedLine` ("Signed November 12, 2026 at 2:14 PM EST by ..."), `letterDate` (the letter's date as the server stamped it) and
 * `textSha256` (the sha256 of the agreement text that was stored) come back only when the acceptance was a signing.
 */
export type ProposalAcceptResult = { ok: true; payUrl: string; signedLine?: string; letterDate?: string; textSha256?: string } | { ok: false; message: string };

export type ProposalDocumentProps = {
  content: ProposalContent;
  title: string;
  clientName: string;
  /** Civil date, "YYYY-MM-DD". */
  expiresOn: string | null;
  firm: {
    name: string;
    slug: string;
    /** What the commitment sentence calls the firm (the profile's display name). Defaults to `name`. */
    displayName?: string;
    /** From the firm's profile; absent = no contact line. */
    contactLine?: string | null;
  };
  mode: "live" | "preview" | "accepted";
  /** Starting ticks (accepted mode: what was accepted). Defaults to the firm's preselected offer. */
  initialSelection?: Selection;
  /** accepted mode: the frozen quote the client agreed to. */
  acceptedQuote?: ProposalQuote;
  /** accepted mode: where the legal fee is paid. Additive to the original prop list. */
  payUrl?: string | null;
  /** What the client has written when the page opens (open-class descriptions, added classes). The page starts with none; tests may start with some. */
  initialClientClasses?: ClientClassInput;
  /**
   * live mode: records the acceptance on the server. Receives the ticks and what the client wrote
   * (`{ entries: { classId: text }, added: { nameId: [{ text, on }] } }`) only, never a price.
   */
  onAccept?: (selection: Selection, clientClasses: ClientClassInput, signing?: SigningInput) => Promise<ProposalAcceptResult>;
  /**
   * Engagement letter (content with `loe`) only. The letter's date and the proposal's own client email (merge fields), and, on a
   * receipt, the letter as signed. Absent on a proposal without a letter, which then renders exactly as it always did.
   */
  letter?: LoeLetterData | null;
  /** live, with a letter: the review-copy PDF (token only, bound server-side) from the client's selection and details. */
  onDownloadReview?: (selection: Selection, clientClasses: ClientClassInput, details: SignerDetails) => Promise<LetterPdfResult>;
  /**
   * With a letter: the signed PDF (token only). Passed on the LIVE page as well as the receipt, so the download is there the
   * moment signing succeeds, with no reload; the button is drawn only in the accepted state, and the action itself refuses
   * until the proposal is signed.
   */
  onDownloadSigned?: () => Promise<LetterPdfResult>;
  /**
   * live, with a letter: called when the client presses Continue on "Your details" with every required detail given. The server
   * writes the address to the firm's Lawmatics after its response; the page neither waits for it nor shows the outcome.
   */
  onSaveDetails?: (details: SignerDetails) => Promise<void>;
  /** accepted, with a letter: "Signed November 12, 2026 at 2:14 PM EST by ..." for the receipt. */
  signedLine?: string | null;
  /** Starting step and typed values: for tests and the staff preview, never set by the public page. */
  initialLoe?: { step?: LoeStep; details?: SignerDetails; typedName?: string; agree?: boolean };
  /** The state right after a successful accept or signing (what `onAccept` returned): for tests only, never set by the public page. */
  initialDone?: { payUrl: string | null; opened?: boolean; signedLine?: string | null; letterDate?: string | null; letterVerified?: boolean };
};

const DEFAULT_TITLE = "Trademark Proposal";

/** Shown on a card whose last mark or class is held on, so a client can't untick to $0. */
export const KEEP_ONE_HINT = "At least one class and one mark must stay selected.";

function Rich({ text }: { text: string | undefined }): ReactNode {
  return richSegments(text).map((seg, i) => (seg.bold ? <b key={i}>{seg.text}</b> : seg.text));
}

function addedCount(content: ProposalContent, selection: Selection, nameId: string): number {
  return (content.names.find((n) => n.id === nameId)?.classes ?? []).filter((c) => c.client_added === true && selection[c.id] === true).length;
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * In words, what one more class costs on this package. Display only: the next-class legal figure is the
 * difference between two `priceForClassCount` runs (the engine itself), so the words cannot disagree with the total.
 */
function classPriceWords(pricing: ProposalPricing, perClassCents: number, picked: number): string {
  const included = pricing.included_classes;
  const effective: ProposalPricing = { ...pricing, per_class_cents: perClassCents };
  const nextLegal = priceForClassCount(effective, picked + 1) - priceForClassCount(effective, picked);
  const head = `${pricing.package} includes ${plural(included, "class", "classes")}.`;
  const left = Math.max(0, included - picked);
  const tail = `${money(pricing.gov_per_class_cents)} USPTO per class`;
  if (nextLegal <= 0) return `${head} ${left} more included at no extra legal fee; after that ${money(perClassCents)} legal + ${tail}.`;
  return left > 0
    ? `${head} The next class adds ${money(nextLegal)} legal + ${tail}.`
    : `${head} Each class past that is ${money(nextLegal)} legal + ${tail}.`;
}

/** "includes 2 classes, each additional class $825": the package's own terms, in words. */
export function packageTermsWords(p: ProposalPricing): string {
  return `includes ${plural(p.included_classes, "class", "classes")}, each additional class ${money(p.per_class_cents)}`;
}

/** Every package some brand name (Spec 7: or mark) offers, in the order they first appear (Spec 6). */
export function offeredPackages(content: ProposalContent): PackageOffer[] {
  const seen = new Set<string>();
  const out: PackageOffer[] = [];
  for (const nm of content.names ?? []) {
    const owners: unknown[] = usesMarkPackages(content, nm) ? (nm.marks ?? []) : [nm];
    for (const owner of owners) {
      for (const offer of packageChoiceOptions(content, owner)) {
        if (seen.has(offer.package)) continue;
        seen.add(offer.package);
        out.push(offer);
      }
    }
  }
  return out;
}

/** Spec 7: what an add-on mark's checkbox says: "Add the design mark (logo)". */
export function addMarkLabel(kind: keyof typeof MARK_PACKAGE_WORDS): string {
  return kind === "logo" ? "Add the design mark (logo)" : `Add the ${MARK_PACKAGE_WORDS[kind] ?? kind}`;
}

/**
 * Spec 6: one comparison table, a column per package and a row per "what's included" label (in the order they first
 * appear). With `packageNames` (the packages the client has chosen, `chosenPackageNames`), the columns are those
 * packages only, in that order, and `mode` is "chosen"; when none is given, none matches an offer, or no chosen package
 * has includes rows, every offered package is a column (`mode` "all"), as before. `null` when no offered package has
 * includes rows, so the page keeps its single-package table.
 */
export function includesComparison(
  content: ProposalContent,
  packageNames?: readonly string[],
): { mode: "chosen" | "all"; packages: string[]; rows: { label: string; value?: string; note?: string; highlight?: boolean; cells: string[] }[] } | null {
  const offered = offeredPackages(content);
  const listed = (o: PackageOffer): ProposalInclude[] =>
    Array.isArray(o.includes) ? o.includes.filter((r) => r && typeof r.label === "string" && r.label.trim()) : [];
  if (!offered.some((o) => listed(o).length > 0)) return null;
  const chosen = (packageNames ?? [])
    .map((name) => offered.find((o) => o.package === name))
    .filter((o): o is PackageOffer => !!o);
  const useChosen = chosen.some((o) => listed(o).length > 0);
  const offers = useChosen ? chosen : offered;
  const labels: ProposalInclude[] = [];
  for (const o of offers) for (const r of listed(o)) if (!labels.some((l) => l.label === r.label)) labels.push(r);
  return {
    mode: useChosen ? "chosen" : "all",
    packages: offers.map((o) => o.package),
    rows: labels.map((l) => ({
      label: l.label,
      value: l.value,
      note: l.note,
      highlight: l.highlight,
      cells: offers.map((o) => listed(o).find((r) => r.label === l.label)?.included?.trim() || "—"),
    })),
  };
}

/** The heading and sub-line over the comparison table: one chosen package, several chosen, or every offered one. */
export function comparisonHeading(comparison: { mode: "chosen" | "all"; packages: string[] }): { title: string; sub: string } {
  if (comparison.mode === "chosen" && comparison.packages.length === 1) {
    return { title: "What your package includes", sub: `${comparison.packages[0]}\u2122, with each trademark you choose` };
  }
  if (comparison.mode === "chosen") return { title: "Compare your packages", sub: "The packages you have chosen, side by side" };
  return { title: "What each package includes", sub: "Compare the packages you can choose from" };
}

/**
 * The client's proposal page. Spec 9: a general (flat-fee) proposal has its own view (`GeneralProposalDocument`);
 * every other proposal is the trademark view below, unchanged.
 */
export function ProposalDocument(props: ProposalDocumentProps) {
  if (isGeneralContent(props.content)) return <GeneralProposalDocument {...props} />;
  return <TrademarkProposalDocument {...props} />;
}

function TrademarkProposalDocument(props: ProposalDocumentProps) {
  const { content, title, clientName, expiresOn, firm, mode, initialSelection, acceptedQuote, payUrl, onAccept, initialClientClasses, letter, onDownloadReview, onDownloadSigned, onSaveDetails } = props;
  const brand: ProposalBrand = brandForSlug(firm.slug);
  /** The firm's logo above its engagement letter: decided by the same brand signal as the rest of the page. */
  const letterLogo = letterLogoForBrand(brand);

  // Ticks the visitor changed. Layered over the firm's defaults (and any given
  // starting ticks), so editing the content in the preview never loses a tick
  // the viewer made and never keeps a tick for a mark that no longer exists.
  const [overrides, setOverrides] = useState<Selection>({});
  // What the visitor wrote: a description for each open class (by class id) and the classes they added (by brand
  // name id). Text only; the server cleans and checks all of it again (`parseClientClassInput`).
  const [entries, setEntries] = useState<Record<string, string>>(initialClientClasses?.entries ?? {});
  const [added, setAdded] = useState<Record<string, ClientAddedEntry[]>>(initialClientClasses?.added ?? {});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ payUrl: string | null; opened: boolean; signedLine?: string | null; letterDate?: string | null; letterVerified?: boolean } | null>(() =>
    props.initialDone
      ? {
          payUrl: props.initialDone.payUrl,
          opened: props.initialDone.opened ?? false,
          signedLine: props.initialDone.signedLine ?? null,
          letterDate: props.initialDone.letterDate ?? null,
          letterVerified: props.initialDone.letterVerified === true,
        }
      : null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  const accepted = mode === "accepted" || done !== null;
  const readOnly = accepted;

  const selection = useMemo<Selection>(() => {
    const start = defaultSelection(content);
    const merged: Selection = { ...start, ...(initialSelection ?? {}) };
    // Kept after a live acceptance (toggle() is off by then): the receipt must
    // show what the client ticked and accepted, not the firm's pre-ticked offer.
    // Only a server-rendered receipt starts from `initialSelection` alone.
    if (mode !== "accepted") Object.assign(merged, overrides);
    // Package picks (Spec 6) merge per brand name; normalizeSelection keeps only real options.
    merged.packages = { ...(start.packages ?? {}), ...(initialSelection?.packages ?? {}), ...(mode !== "accepted" ? overrides.packages ?? {} : {}) };
    return normalizeSelection(content, merged);
  }, [content, initialSelection, overrides, mode]);

  // The page's own total: the SAME helper the accept path runs, over the stored content plus what the
  // visitor wrote (the effective content). A receipt shows the content it was accepted with (already
  // carrying the client's words and classes) and the frozen quote, so nothing is added twice.
  const priced = useMemo(() => {
    // An accepted snapshot is ALREADY the effective content (its open classes carry the client's words), so it is
    // shown as stored and not rebuilt; its totals are the frozen quote below.
    if (mode === "accepted") return { content, selection, quote: quoteProposal(content, selection), missing: [] as string[] };
    const input: ClientClassInput = { entries, added };
    const result = quoteWithClientClasses(content, selection, input);
    if (!result.ok) throw new Error("unreachable: repair is off");
    return result;
  }, [mode, content, selection, entries, added]);
  const shown = priced.content;
  const shownSelection = priced.selection;
  const quote = useMemo<ProposalQuote>(
    () => (mode === "accepted" && acceptedQuote ? acceptedQuote : priced.quote),
    [mode, acceptedQuote, priced],
  );
  const display = useMemo(() => markDisplayPrices(shown, shownSelection), [shown, shownSelection]);
  // What a SIGNING is made over. The letter's Exhibit A, and so the fingerprint the page sends, must be built from exactly what
  // the server will sign: the same content with the client's own class words CLEANED the way the server cleans them
  // (`quoteForAcceptance`, the function the accept path calls). The cards above show what the client typed as typed; the
  // exhibit shows it as it will be stored, so a class description with a double or trailing space can never read as "stale".
  const signBasis = useMemo(() => {
    if (mode === "accepted") return { content: shown, quote };
    const basis = quoteForAcceptance(content, selection, { entries, added });
    return basis.ok ? { content: basis.content, quote: basis.quote } : { content: shown, quote };
  }, [mode, content, selection, entries, added, shown, quote]);
  // Engagement letter: a proposal whose content carries one adds Your details, the letter and signing to today's page.
  // Content without `loe` runs none of it and renders exactly as before.
  const loeBlock = typeof content.loe?.body === "string" && content.loe.body.length > 0 ? { title: content.loe.title || LETTER_HEADING, body: content.loe.body } : null;
  const loeFlow = useLoeFlow({
    loe: loeBlock,
    clientName: clientName ?? "",
    company: content.client?.company ?? "",
    letter: letter ?? null,
    shown: signBasis.content,
    quote: signBasis.quote,
    initialStep: props.initialLoe?.step,
    initialDetails: props.initialLoe?.details,
    initialTypedName: props.initialLoe?.typedName,
    initialAgree: props.initialLoe?.agree,
    // Once signed, the letter on the page carries the date the server stamped, not the date the page was opened with.
    signedDateText: done?.letterDate ?? null,
  });
  const loeOn = loeFlow.enabled;
  const stepOne = !loeOn || accepted || loeFlow.step === 1;
  // The letter shown as SIGNED: the server's verified copy on a receipt; on the just-signed page the page's own letter, and only
  // when its text hashed to the sha256 the server stored (`letterVerified`). Otherwise nothing is shown under that label.
  const signedView = letter?.signed ?? (done?.letterVerified ? loeFlow.agreement : null);
  // One name, one mark, one class: nothing to choose, so no checkboxes at all. A class the client describes or room to
  // add classes is a choice, so such a proposal is never fixed (`isFixedOffer`).
  const fixed = isFixedOffer(content);
  // Boxes the client may not untick because doing so would leave nothing to accept (the whole proposal,
  // over the content AS SHOWN, so a class the client added counts). Separate from the per-name class lock below.
  const locked = useMemo(
    () => (readOnly || fixed ? new Set<string>() : lockedSelectionIds(shown, shownSelection)),
    [readOnly, fixed, shown, shownSelection],
  );
  /** Ids held on by either rule: the whole-proposal $0 lock or "one class is always included" per brand name. */
  const held = useMemo(() => {
    const ids = new Set(locked);
    if (!readOnly) {
      for (const nm of shown.names) {
        const lock = classLock(nm, shownSelection);
        if (lock) ids.add(lock.classId);
      }
    }
    return ids;
  }, [locked, readOnly, shown, shownSelection]);

  /** One mark or class row: a checkbox when the client has a choice, a plain row for a fixed offer. */
  function option(nameId: string, id: string, on: boolean, body: ReactNode, onToggle?: (on: boolean) => void, label?: string) {
    if (fixed) {
      return (
        <div className="cp-opt cp-fixed" key={id}>
          {body}
        </div>
      );
    }
    return (
      <label className={`cp-opt${on ? "" : " cp-off"}`} key={id}>
        <input
          type="checkbox"
          checked={on}
          disabled={readOnly || held.has(id)}
          aria-describedby={locked.has(id) ? `cp-keep-${nameId}` : undefined}
          aria-label={label}
          onChange={(e) => (onToggle ? onToggle(e.target.checked) : toggle(id, e.target.checked))}
        />
        <span className="cp-box" aria-hidden="true" />
        {body}
      </label>
    );
  }

  // A ticked mark with no class is warned about on the card and cannot be accepted (the server would
  // repair it to the first class, which is not the price the visitor was looking at).
  const missingClass = shown.names.some((nm) => markWithoutClass(nm, shownSelection));
  // A ticked class the client describes needs their words first (the server refuses it the same way).
  const missingText = !readOnly && priced.missing.length > 0;
  const missingIds = new Set(readOnly ? [] : priced.missing);
  const canAccept = quoteHasItems(quote) && !missingClass && !missingText;
  const pricing = content.pricing;
  // Spec 6: a brand name with a package choice shows its chosen package's terms; the rest show the proposal's pricing.
  // Spec 7: a name that prices per mark shows its first mark's package (each mark's own terms sit beside that mark).
  const pricingFor = (nameId: string): ProposalPricing => {
    const nm = shown.names.find((n) => n.id === nameId);
    if (!nm) return pricing;
    const offer = chosenPackage(shown, nm, shownSelection) ?? markPricingOffer(nm);
    return offer ? offerPricing(offer) : pricing;
  };
  /** Spec 7: the package of a name's first ticked mark with its own choice (else its first such mark), or null. */
  function markPricingOffer(nm: ProposalContent["names"][number]): PackageOffer | null {
    const withChoice = (nm.marks ?? []).filter((m) => chosenMarkPackage(shown, nm, m, shownSelection));
    const first = withChoice.find((m) => shownSelection[m.id] === true) ?? withChoice[0];
    return first ? chosenMarkPackage(shown, nm, first, shownSelection) : null;
  }
  /** The terms a mark's price follows: its own package (Spec 7), else its brand name's. */
  const markPricing = (nameId: string, markId: string): ProposalPricing => {
    const nm = shown.names.find((n) => n.id === nameId);
    const m = nm?.marks.find((x) => x.id === markId);
    const offer = nm && m ? chosenMarkPackage(shown, nm, m, shownSelection) : null;
    return offer ? offerPricing(offer) : pricingFor(nameId);
  };
  const hasChoices = offeredPackages(content).length > 0;
  const offeredPerMark = (content.names ?? []).some((nm) => usesMarkPackages(content, nm));
  const chosenNames = useMemo(() => chosenPackageNames(shown, shownSelection), [shown, shownSelection]);
  const comparison = useMemo(() => includesComparison(content, chosenNames), [content, chosenNames]);
  const comparisonTitle = comparison ? comparisonHeading(comparison) : null;
  const govRates = new Set(quote.names.filter((q) => q.included).map((q) => pricingFor(q.id).gov_per_class_cents));
  const govShown = govRates.size === 1 ? [...govRates][0] : pricing.gov_per_class_cents;
  const firstName = content.client?.first_name?.trim() || "";
  const who = clientName?.trim() || content.client?.full_name || "";
  const company = content.client?.company?.trim();
  const expires = formatCivilDate(expiresOn);
  const finalPayUrl = safeHttpsUrl(done ? done.payUrl : payUrl);
  const heading = !title || title === DEFAULT_TITLE ? "Your Trademark Proposal" : title;
  const recHeading = brand === "rpb" ? "Rebecca’s recommendation" : "Our recommendation";

  function toggle(id: string, on: boolean) {
    if (readOnly || fixed) return;
    if (!on && held.has(id)) return;
    setOverrides((prev) => ({ ...prev, [id]: on }));
  }

  /** The client picked a package for a brand name: a NAME only, re-checked by `normalizeSelection` and again on the server. */
  function setPackage(nameId: string, name: string) {
    if (readOnly) return;
    setOverrides((prev) => ({ ...prev, packages: { ...(prev.packages ?? {}), [nameId]: name } }));
  }

  function setEntry(classId: string, value: string) {
    if (readOnly) return;
    setEntries((prev) => ({ ...prev, [classId]: value.slice(0, MAX_CLIENT_TEXT_CHARS) }));
  }

  /** One more open class on this brand name, ticked, with an empty description to fill in. */
  function addClass(nameId: string, max: number) {
    if (readOnly) return;
    setAdded((prev) => {
      const have = prev[nameId] ?? [];
      return have.length >= max ? prev : { ...prev, [nameId]: [...have, { text: "", on: true }] };
    });
  }

  function setAddedRow(nameId: string, index: number, patch: Partial<ClientAddedEntry>) {
    if (readOnly) return;
    setAdded((prev) => ({ ...prev, [nameId]: (prev[nameId] ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  }

  function toggleAdded(nameId: string, index: number, id: string | undefined, on: boolean) {
    if (!on && id && held.has(id)) return;
    setAddedRow(nameId, index, { on });
  }

  function removeAdded(nameId: string, index: number) {
    if (readOnly) return;
    const id = shown.names.find((n) => n.id === nameId)?.classes.filter((c) => c.client_added === true)[index]?.id;
    if (id && held.has(id)) return;
    setAdded((prev) => ({ ...prev, [nameId]: (prev[nameId] ?? []).filter((_, i) => i !== index) }));
  }

  async function accept() {
    if (mode !== "live" || !onAccept || pending || done || !canAccept) return;
    // Engagement letter: the click is a signing, and only when the typed name and the tick are given.
    if (loeOn && !loeFlow.signable) return;
    setError(null);
    setPending(true);
    // Open the tab NOW, inside the click, or the browser's popup blocker treats
    // the later (post-await) open as unsolicited. It is pointed at the payment
    // page once the server has recorded the acceptance.
    let tab: Window | null = null;
    try {
      tab = window.open("about:blank", "_blank");
      if (tab) tab.document.body.textContent = "Opening your secure payment page…";
    } catch {
      tab = null;
    }
    try {
      // The fingerprint is hashed now (async), after the tab is open, over what is on screen (the date aside: the server stamps its own).
      const signing: SigningInput | null = loeOn ? await loeFlow.signingPayload() : null;
      if (loeOn && !signing) {
        tab?.close();
        setError(SIGN_MESSAGES.generic);
        return;
      }
      const result = signing ? await onAccept(selection, { entries, added }, signing) : await onAccept(selection, { entries, added });
      if (!result.ok) {
        tab?.close();
        setError(result.message);
        return;
      }
      const url = safeHttpsUrl(result.payUrl);
      let opened = false;
      if (url && tab && !tab.closed) {
        try {
          tab.opener = null;
          tab.location.href = url;
          opened = true;
        } catch {
          opened = false;
        }
      }
      if (!opened) tab?.close();
      // Before anything is shown as "signed": does this page's letter, with the server's date, hash to what the server stored?
      const letterVerified = loeOn ? await loeFlow.signedTextVerified(result.letterDate, result.textSha256) : false;
      setDone({ payUrl: url, opened, signedLine: result.signedLine ?? null, letterDate: result.letterDate ?? null, letterVerified });
    } catch {
      tab?.close();
      setError("We couldn’t record your acceptance. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const rootClass = ["cp-root", brand === "rpb" ? RPB_FONT_VARS : ""].filter(Boolean).join(" ");
  const gutter = "cp-gut";
  const greetingParas = paragraphs(content.greeting);

  return (
    <div className={rootClass} data-brand={brand} data-mode={mode}>
      <header className={`cp-band ${gutter}`}>
        <div className="cp-wrap cp-band-in">
          {brand === "rpb" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 30px brand strip; the optimizer buys nothing.
            <img className="cp-logo" src="/brand/rpb-logo-cream.png" alt="RPB Law Firm, Est 2024" width={984} height={168} />
          ) : (
            <span className="cp-firm">{firm.name}</span>
          )}
          <span className="cp-who">
            {who ? `Prepared for ${who}${company ? ` · ${company}` : ""}` : null}
          </span>
        </div>
      </header>

      <main className={`cp-main ${gutter}`}>
        {loeOn ? (
          <div className="cp-wrap cp-steps-wrap">
            <LoeStepBar current={accepted ? 4 : loeFlow.step} onGo={(n) => loeFlow.setStep(n)} locked={accepted || pending} />
          </div>
        ) : null}
        <div className="cp-wrap cp-layout">
          <div className="cp-left">
            {loeOn && !accepted && loeFlow.step === 2 ? (
              <>
                <LoeIncludesLink onBackToStepOne={() => loeFlow.setStep(1)} />
                <LoeDetailsForm details={loeFlow.details} onChange={loeFlow.setDetail} savedWith={onSaveDetails ? (firm.displayName ?? firm.name) : null} />
              </>
            ) : null}
            {loeOn && !accepted && loeFlow.step === 3 ? (
              <section className="cp-choose cp-letter-step" aria-labelledby="cp-letter-h">
                <div className="cp-step-h">
                  <span className="cp-n" aria-hidden="true">
                    3
                  </span>
                  <div>
                    <h2 id="cp-letter-h">{LETTER_HEADING}</h2>
                    <p>{LETTER_INTRO}</p>
                  </div>
                </div>
                <LoeIncludesLink onBackToStepOne={() => loeFlow.setStep(1)} />
                {loeFlow.agreement ? (
                  <LoeLetterPanel agreement={loeFlow.agreement} title={loeBlock?.title ?? LETTER_HEADING} id="cp-letter" logo={letterLogo} />
                ) : (
                  <p className="cp-warn" role="status">
                    {SIGN_MESSAGES.letter_unavailable}
                  </p>
                )}
                <DownloadPdfButton
                  label={DOWNLOAD_REVIEW_LABEL}
                  onDownload={onDownloadReview ? () => onDownloadReview(selection, { entries, added }, loeFlow.cleaned) : undefined}
                />
                <LoeSignPanel
                  typedName={loeFlow.typedName}
                  onName={loeFlow.setTypedName}
                  agree={loeFlow.agree}
                  onAgree={loeFlow.setAgree}
                />
              </section>
            ) : null}
            {stepOne ? (
            <>
            <section className="cp-intro">
              {expires ? <p className="cp-date">Available through {expires}</p> : null}
              <h1>{heading}</h1>
              {greetingParas.map((p, i) => (
                <p key={i} className="cp-hi">
                  <Rich text={p} />
                </p>
              ))}
              {content.recommendation?.trim() ? (
                <div className="cp-rec">
                  <h2>{recHeading}</h2>
                  <p>
                    <Rich text={content.recommendation} />
                  </p>
                </div>
              ) : null}
            </section>

            <section className="cp-terms" aria-label="Types of trademarks">
              {(["word", "logo"] as const).map((kind) => (
                <div className="cp-term" key={kind}>
                  <h3>{MARK_KIND_LABEL[kind]}</h3>
                  <p>{MARK_KIND_DEFAULT_DESC[kind]}</p>
                </div>
              ))}
            </section>

            <section aria-labelledby="cp-s1" className="cp-choose">
              <div className="cp-step-h">
                <span className="cp-n" aria-hidden="true">
                  1
                </span>
                <div>
                  <h2 id="cp-s1">
                    {accepted ? "What you accepted" : fixed ? "Your trademark" : "Select your trademarks"}
                  </h2>
                  <p>
                    {accepted
                      ? "These are the marks and classes in your accepted proposal."
                      : fixed
                        ? "This is the mark and class in your proposal."
                        : "Please select the marks you would like to protect and the corresponding classes."}
                  </p>
                </div>
              </div>

              <div className="cp-cards">
                {shown.names.map((nm) => {
                  const qn = quote.names.find((q) => q.id === nm.id);
                  const pickedMarks = nm.marks.filter((m) => shownSelection[m.id] === true).length;
                  const pickedClasses = nm.classes.filter((c) => shownSelection[c.id] === true).length;
                  const lock = readOnly ? null : classLock(nm, shownSelection);
                  const mine = nm.classes.filter((c) => c.client_added === true);
                  const staffClasses = nm.classes.filter((c) => c.client_added !== true);
                  const choices = packageChoiceOptions(content, nm);
                  const offer = chosenPackage(shown, nm, shownSelection);
                  // Spec 7: the marks carry the packages; the card's class terms follow the first mark's.
                  const perMark = usesMarkPackages(content, nm);
                  const markOffer = perMark ? markPricingOffer(nm) : null;
                  const namePr = offer ? offerPricing(offer) : markOffer ? offerPricing(markOffer) : pricing;
                  const perClass = offer || markOffer ? namePr.per_class_cents : nm.price_override?.per_class_cents ?? pricing.per_class_cents;
                  // The firm's content decides (an explicit max, else 5, else 0 on a fixed offer), never what was added.
                  const addMax = clientAddMax(content, nm);
                  const holdsLast = [...nm.marks, ...nm.classes].some((x) => locked.has(x.id));
                  return (
                    <article className="cp-card" key={nm.id} aria-labelledby={`cp-h-${nm.id}`}>
                      <div className="cp-card-h">
                        <div>
                          <h3 id={`cp-h-${nm.id}`}>{nm.name}</h3>
                          {nm.what ? <p className="cp-what">{nm.what}</p> : null}
                        </div>
                        <div className="cp-sub">
                          <span className="cp-k">Legal fee for {nm.name}</span>
                          <span className="cp-v cp-num">{money(qn?.legal_cents ?? 0)}</span>
                        </div>
                      </div>
                      {nm.note?.trim() ? (
                        <p className="cp-note">
                          <Rich text={nm.note} />
                        </p>
                      ) : null}

                      {choices.length > 0 && offer ? (
                        <div className="cp-part cp-pkg">
                          {readOnly ? (
                            <h4>Package: {offer.package}</h4>
                          ) : (
                            <>
                              <label className="cp-pkg-l" htmlFor={`cp-pkg-${nm.id}`}>
                                Select your package
                              </label>
                              <select
                                id={`cp-pkg-${nm.id}`}
                                className="cp-pkg-sel"
                                value={offer.package}
                                aria-describedby={`cp-pkg-${nm.id}-terms`}
                                onChange={(e) => setPackage(nm.id, e.target.value)}
                              >
                                {choices.map((o) => (
                                  <option key={o.package} value={o.package}>
                                    {o.package}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                          <p className="cp-how-add" id={`cp-pkg-${nm.id}-terms`}>
                            {qn?.included ? `${offer.package}: ${money(qn.legal_cents)} legal fee for ${nm.name}` : offer.package}
                            {qn?.included && qn.discount_cents ? ` (after ${Math.round(nm.discount_pct ?? 0)}% off)` : ""}
                            {qn?.included && qn.custom_discount_cents ? " (after the discount below)" : ""}
                            {` · ${packageTermsWords(namePr)}`}
                          </p>
                          {qn?.included && qn.custom_discount_cents ? (
                            <p className="cp-how-add cp-custom-off">
                              {`${qn.custom_discount_label || "Discount"} ${money(-qn.custom_discount_cents)}`}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="cp-part">
                        <h4>{fixed ? "Mark" : "Marks"}</h4>
                        {nm.marks.map((m, mi) => {
                          const d = display[m.id];
                          const on = shownSelection[m.id] === true;
                          const markPr = markPricing(nm.id, m.id);
                          const row = option(
                            nm.id,
                            m.id,
                            on,
                            <>
                              <span className="cp-t">
                                {/* Spec 7: on a name that prices per mark, every mark after the first is an add-on. */}
                                <b>{perMark && mi > 0 ? addMarkLabel(m.kind) : (MARK_KIND_LABEL[m.kind] ?? m.kind)}</b>
                                <span>{m.desc}</span>
                              </span>
                              <span className="cp-pr cp-num">
                                {d?.second ? <s>{money(d.base_cents)}</s> : null}
                                {money(d?.price_cents ?? 0)}
                                <small>
                                  {d?.second
                                    ? `${Math.round(markPr.second_mark_discount_pct)}% off as your second mark`
                                    : `${plural(d?.class_count ?? 0, "class", "classes")} included`}
                                </small>
                              </span>
                            </>,
                          );
                          if (!perMark) return row;
                          const markChoices = packageChoiceOptions(content, m);
                          const chosen = chosenMarkPackage(shown, nm, m, shownSelection);
                          // The first mark always shows its package; an add-on mark only once it is ticked.
                          const showPick = markChoices.length > 0 && chosen && (mi === 0 || on) && (!readOnly || on);
                          if (!showPick) return row;
                          const quotedMark = qn?.included ? qn.marks.find((x) => x.id === m.id) : undefined;
                          const words = MARK_PACKAGE_WORDS[m.kind] ?? m.kind;
                          const selId = `cp-pkg-${m.id}`;
                          return (
                            <div className="cp-mark-pkg" key={m.id}>
                              {row}
                              <div className="cp-pkg cp-pkg-mark">
                                {readOnly ? (
                                  <h4>{`Package for the ${words}: ${chosen.package}`}</h4>
                                ) : (
                                  <>
                                    <label className="cp-pkg-l" htmlFor={selId}>
                                      Select your package
                                    </label>
                                    <select
                                      id={selId}
                                      className="cp-pkg-sel"
                                      value={chosen.package}
                                      aria-label={`Select your package for the ${words}`}
                                      aria-describedby={`${selId}-terms`}
                                      onChange={(e) => setPackage(m.id, e.target.value)}
                                    >
                                      {markChoices.map((o) => (
                                        <option key={o.package} value={o.package}>
                                          {o.package}
                                        </option>
                                      ))}
                                    </select>
                                  </>
                                )}
                                <p className="cp-how-add" id={`${selId}-terms`}>
                                  {quotedMark
                                    ? `${chosen.package}: ${money(quotedMark.price_before_custom_discount_cents ?? quotedMark.price_cents)} legal fee for the ${words}`
                                    : chosen.package}
                                  {quotedMark?.second ? ` (${Math.round(markPr.second_mark_discount_pct)}% off as your second mark)` : ""}
                                  {` · ${packageTermsWords(markPr)}`}
                                </p>
                                {quotedMark?.custom_discount_cents ? (
                                  <p className="cp-how-add cp-custom-off">
                                    {`${quotedMark.custom_discount_label || "Discount"} ${money(-quotedMark.custom_discount_cents)}`}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="cp-part">
                        {fixed ? (
                          <h4>Class</h4>
                        ) : (
                          <h4>
                            Classes <span>(apply to each mark selected above)</span>
                          </h4>
                        )}
                        {staffClasses.map((c, ci) => {
                          const on = shownSelection[c.id] === true;
                          const classHeld = !fixed && lock?.classId === c.id;
                          const price = (
                            <span className="cp-pr cp-num">
                              + {money(namePr.gov_per_class_cents)}
                              <small>filing fee per mark</small>
                            </span>
                          );
                          if (c.client_entry !== true) {
                            return option(
                              nm.id,
                              c.id,
                              on,
                              <>
                                <span className="cp-t">
                                  <b>{`Class ${ci + 1} · ${c.label}`}</b>
                                  {classHeld ? <span className="cp-lock">{lock.text}</span> : null}
                                </span>
                                {price}
                              </>,
                            );
                          }
                          // An open class: the firm's question, and the client's own words under it.
                          const prompt = c.prompt ?? c.label;
                          const entryId = `cp-entry-${c.id}`;
                          if (readOnly) {
                            return option(
                              nm.id,
                              c.id,
                              on,
                              <>
                                <span className="cp-t">
                                  <b>{`Class ${ci + 1} · ${c.label.trim() || prompt}`}</b>
                                  {c.label.trim() ? <span className="cp-lock">Described by you</span> : null}
                                </span>
                                {price}
                              </>,
                            );
                          }
                          return (
                            <div className="cp-open" key={c.id}>
                              {option(
                                nm.id,
                                c.id,
                                on,
                                <>
                                  <span className="cp-t">
                                    <b>{`Class ${ci + 1} · ${prompt}`}</b>
                                    {classHeld ? <span className="cp-lock">{lock.text}</span> : null}
                                  </span>
                                  {price}
                                </>,
                              )}
                              <div className="cp-entry">
                                <input
                                  id={entryId}
                                  type="text"
                                  className="cp-add-input"
                                  value={entries[c.id] ?? ""}
                                  maxLength={MAX_CLIENT_TEXT_CHARS}
                                  aria-label={`Class ${ci + 1} for ${nm.name}: ${prompt}`}
                                  aria-invalid={missingIds.has(c.id) || undefined}
                                  placeholder="For example: handmade candles and soaps"
                                  onChange={(e) => setEntry(c.id, e.target.value)}
                                />
                              </div>
                            </div>
                          );
                        })}
                        {mine.map((c, ai) => {
                          const on = shownSelection[c.id] === true;
                          const classHeld = held.has(c.id);
                          const price = (
                            <span className="cp-pr cp-num">
                              + {money(namePr.gov_per_class_cents)}
                              <small>filing fee per mark</small>
                            </span>
                          );
                          if (readOnly) {
                            return (
                              <div className={`cp-opt cp-fixed cp-mine${on ? "" : " cp-off"}`} key={c.id}>
                                <span className="cp-t">
                                  <b>{`Added class · ${c.label}`}</b>
                                  <span className="cp-lock">{on ? "Added by you" : "Added by you, not selected"}</span>
                                </span>
                                {price}
                              </div>
                            );
                          }
                          const row = added[nm.id]?.[ai];
                          const nth = ai + 1;
                          return (
                            <div className="cp-open" key={c.id}>
                              {option(
                                nm.id,
                                c.id,
                                on,
                                <>
                                  <span className="cp-t">
                                    <b>{`Added class ${nth}`}</b>
                                    <span className="cp-lock">{lock?.classId === c.id ? lock.text : "Added by you"}</span>
                                  </span>
                                  {price}
                                </>,
                                (next) => toggleAdded(nm.id, ai, c.id, next),
                                `Include added class ${nth} for ${nm.name}`,
                              )}
                              <div className="cp-entry">
                                <input
                                  type="text"
                                  className="cp-add-input"
                                  value={row?.text ?? ""}
                                  maxLength={MAX_CLIENT_TEXT_CHARS}
                                  aria-label={`Added class ${nth} for ${nm.name}: describe what you sell or offer`}
                                  aria-invalid={missingIds.has(c.id) || undefined}
                                  placeholder="Describe what you sell or offer"
                                  onChange={(e) => setAddedRow(nm.id, ai, { text: e.target.value.slice(0, MAX_CLIENT_TEXT_CHARS) })}
                                />
                                <button
                                  type="button"
                                  className="cp-link"
                                  disabled={classHeld}
                                  aria-describedby={locked.has(c.id) ? `cp-keep-${nm.id}` : undefined}
                                  onClick={() => removeAdded(nm.id, ai)}
                                  aria-label={`Remove added class ${nth} for ${nm.name}`}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {readOnly || addMax === 0 || pickedMarks === 0 ? null : (
                        <div className="cp-part cp-add">
                          <h4>Add a class</h4>
                          <p className="cp-how-add">Add another class (category of goods or services) you&rsquo;d like us to include, and describe it in your own words.</p>
                          {perMark ? (
                            // Spec 7: one line per ticked mark that carries its own package.
                            nm.marks
                              .filter((m) => shownSelection[m.id] === true && chosenMarkPackage(shown, nm, m, shownSelection))
                              .map((m) => {
                                const mp = markPricing(nm.id, m.id);
                                return (
                                  <p className="cp-how-add" key={m.id}>
                                    {`${capitalize(MARK_PACKAGE_WORDS[m.kind] ?? m.kind)}: ${classPriceWords(mp, mp.per_class_cents, pickedClasses)}`}
                                  </p>
                                );
                              })
                          ) : (
                            <p className="cp-how-add">{classPriceWords(namePr, perClass, pickedClasses)}</p>
                          )}
                          {mine.length < addMax ? (
                            <button type="button" className="cp-add-btn" onClick={() => addClass(nm.id, addMax)}>
                              Add a class
                            </button>
                          ) : (
                            <p className="cp-how-add" role="status">
                              You can add up to {plural(addMax, "class", "classes")} for {nm.name}.
                            </p>
                          )}
                        </div>
                      )}

                      {!readOnly && pickedMarks > 0 && pickedClasses === 0 ? (
                        <p className="cp-warn" role="status">
                          Please select at least one class to include {nm.name}.
                        </p>
                      ) : null}
                      {holdsLast ? (
                        <p className="cp-keep" id={`cp-keep-${nm.id}`}>
                          {KEEP_ONE_HINT}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="cp-inc" aria-labelledby="cp-h-inc">
              {comparison ? (
                <>
                  <div className="cp-inc-h">
                    <h2 id="cp-h-inc">{comparisonTitle?.title}</h2>
                    <span>{comparisonTitle?.sub}</span>
                  </div>
                  <div className="cp-cmp-wrap">
                    <table className="cp-ben cp-cmp">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="cp-sr">What&rsquo;s included</span>
                          </th>
                          {comparison.packages.map((name) => (
                            <th scope="col" key={name} className="cp-vcell">
                              {name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {comparison.rows.map((r, i) => (
                          <tr key={i} className={r.highlight ? "cp-hl" : undefined}>
                            <th scope="row">
                              {r.label}
                              {r.value ? <span className="cp-val">({r.value})</span> : null}
                              {r.note ? <span className="cp-sub-note">{r.note}</span> : null}
                            </th>
                            {r.cells.map((cell, j) => (
                              <td key={j} className="cp-vcell">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="cp-inc-h">
                  <h2 id="cp-h-inc">What your package includes</h2>
                  <span>{pricing.package}&trade;, with each trademark you choose</span>
                </div>
              )}
              {comparison ? null : (
              <table className="cp-ben">
                <tbody>
                  {content.includes.map((r, i) => (
                    <tr key={i} className={r.highlight ? "cp-hl" : undefined}>
                      <td>
                        {r.label}
                        {r.value ? <span className="cp-val">({r.value})</span> : null}
                        {r.note ? <span className="cp-sub-note">{r.note}</span> : null}
                      </td>
                      <td className="cp-vcell">{r.included}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              {content.office_action_note?.trim() ? (
                <p className="cp-oa">
                  <Rich text={content.office_action_note} />
                </p>
              ) : null}
            </section>
            {loeOn && !accepted ? (
              <section className="cp-letter-preview" aria-label={READ_LETTER_FIRST}>
                <details
                  id="cp-letter-preview"
                  open={previewOpen}
                  onToggle={(e) => setPreviewOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary>{READ_LETTER_FIRST}</summary>
                  <p className="cp-note">You will fill in your details on the next step. Until then, brackets mark what is still to come.</p>
                  {loeFlow.preview ? <LoeLetterPanel agreement={loeFlow.preview} title={loeBlock?.title ?? LETTER_HEADING} id="cp-letter-first" logo={letterLogo} /> : null}
                </details>
              </section>
            ) : null}
            </>
            ) : null}
            {loeOn && accepted ? (
              <>
                <LoeIncludesLink />
                <LoeSignedLetter agreement={signedView} title={loeBlock?.title ?? LETTER_HEADING} logo={letterLogo} />
              </>
            ) : null}
          </div>

          <aside className="cp-side" id="cp-review" aria-labelledby="cp-s2">
            <div className="cp-panel">
              <div className="cp-panel-h">
                {/* The "2" belongs to the two-part page. A proposal with a letter has its own four numbered steps above, so the panel has no number. */}
                {loeOn ? null : (
                  <span className="cp-n" aria-hidden="true">
                    2
                  </span>
                )}
                <h2 id="cp-s2">{accepted ? "Your acceptance" : "Review and accept"}</h2>
              </div>
              <div className="cp-panel-b" aria-live="polite">
                <div className="cp-lines">
                  {quote.names.map((qn) => (
                    <div className="cp-grp" key={qn.id}>
                      <h3>{packageLineTitle(qn)}</h3>
                      {qn.included ? (
                        qn.marks.map((m) => (
                          <div className="cp-ln" key={m.id}>
                            <span className="cp-l">
                              {MARK_KIND_LABEL[m.kind] ?? m.kind}
                              {m.package ? <small>{m.package}</small> : null}
                              {m.second ? <small>{Math.round((m.package ? markPricing(qn.id, m.id) : pricingFor(qn.id)).second_mark_discount_pct)}% off</small> : null}
                            </span>
                            <span className="cp-r cp-num">{money(m.price_before_custom_discount_cents ?? m.price_cents)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="cp-empty">Not included</p>
                      )}
                      {qn.included && qn.custom_discount_cents ? (
                        <div className="cp-ln cp-custom-off">
                          <span className="cp-l">{qn.custom_discount_label || "Discount"}</span>
                          <span className="cp-r cp-num">{money(-qn.custom_discount_cents)}</span>
                        </div>
                      ) : null}
                      {qn.included && qn.discount_cents ? (
                        <div className="cp-ln">
                          <span className="cp-l">
                            Discount
                            <small>{Math.round(shown.names.find((n) => n.id === qn.id)?.discount_pct ?? 0)}% off</small>
                          </span>
                          <span className="cp-r cp-num">{money(-qn.discount_cents)}</span>
                        </div>
                      ) : null}
                      {qn.included && addedCount(shown, shownSelection, qn.id) > 0 ? (
                        <p className="cp-empty">
                          Includes {plural(addedCount(shown, shownSelection, qn.id), "class", "classes")} {accepted ? "you added" : "you added, priced above"}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {quote.adjustments.some((a) => a.discount_cents > 0) ? (
                    <div className="cp-grp">
                      <h3>Credits</h3>
                      {quote.adjustments
                        .filter((a) => a.discount_cents > 0)
                        .map((a) => (
                          <div className="cp-ln" key={a.id}>
                            <span className="cp-l">
                              {a.label}
                              {a.kind === "percent" ? <small>{a.value}% off</small> : null}
                            </span>
                            <span className="cp-r cp-num">{money(-a.discount_cents)}</span>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>

                <div className="cp-tot">
                  <div className="cp-row">
                    <div className="cp-l">
                      <b>Legal fee due now</b>
                      <span>Due now to begin</span>
                    </div>
                    <div className="cp-big cp-num">{money(quote.legal_total_cents)}</div>
                  </div>
                  <div className="cp-row">
                    <div className="cp-l">
                      <b>USPTO filing fees, due at filing</b>
                      <span>{usptoLine(quote, govShown, money)}, paid before filing, not today</span>
                    </div>
                    <div className="cp-mid cp-num">{money(quote.gov_total_cents)}</div>
                  </div>
                </div>

                {loeOn ? (
                  <LoeSideAction
                    mode={mode}
                    step={loeFlow.step}
                    accepted={accepted}
                    firstName={firstName}
                    signedLine={done?.signedLine ?? props.signedLine ?? letter?.signed?.signedLine ?? null}
                    payUrl={finalPayUrl}
                    opened={done?.opened ?? false}
                    canContinue={canAccept && mode !== "accepted"}
                    detailsOk={loeFlow.detailsOk}
                    signable={loeFlow.signable}
                    pending={pending}
                    error={error}
                    describedBy={missingText ? "cp-describe" : undefined}
                    warning={
                      missingText ? (
                        <p className="cp-warn cp-describe" id="cp-describe" role="status">
                          {DESCRIBE_BEFORE_ACCEPT}
                        </p>
                      ) : null
                    }
                    legalTotalText={money(quote.legal_total_cents)}
                    onContinue={() => {
                      // Leaving "Your details": the address goes to the firm's records, without waiting and without a word on the page.
                      if (loeFlow.step === 2) saveDetailsInBackground(onSaveDetails, loeFlow.detailsOk, loeFlow.cleaned);
                      loeFlow.setStep(loeFlow.step === 1 ? 2 : 3);
                      requestAnimationFrame(() => document.getElementById("cp-steps")?.scrollIntoView({ block: "start" }));
                    }}
                    onBack={() => loeFlow.setStep(loeFlow.step === 3 ? 2 : 1)}
                    onSign={accept}
                    onReadLetter={() => {
                      setPreviewOpen(true);
                      requestAnimationFrame(() => document.getElementById("cp-letter-preview")?.scrollIntoView({ block: "start" }));
                    }}
                    onDownloadSigned={onDownloadSigned}
                  />
                ) : accepted ? (
                  <>
                    <div className="cp-done" role="status">
                      <h3>Thank you{firstName ? `, ${firstName}` : ""}.</h3>
                      <p>
                        Your acceptance is recorded.
                        {finalPayUrl
                          ? done?.opened
                            ? " Your payment page opened in a new tab. If it didn’t, use the button below."
                            : " Use the button below to pay your legal fee."
                          : " We will send your payment link by email."}
                      </p>
                    </div>
                    {finalPayUrl ? (
                      <a className="cp-btn" href={finalPayUrl} target="_blank" rel="noopener noreferrer">
                        Pay my legal fee
                      </a>
                    ) : null}
                    <p className="cp-paynote">
                      Once your payment is received, we&rsquo;ll send your engagement agreement for review and signature.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="cp-commit">{commitmentSentence(firm.displayName ?? firm.name)}</p>
                    {mode === "preview" ? (
                      <button type="button" className="cp-btn" disabled aria-describedby={missingText ? "cp-describe" : undefined}>
                        Preview
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="cp-btn"
                        onClick={accept}
                        disabled={!canAccept || pending || !onAccept}
                        aria-describedby={missingText ? "cp-describe" : undefined}
                      >
                        {pending ? "Recording…" : "Accept and pay my legal fee"}
                      </button>
                    )}
                    {missingText ? (
                      <p className="cp-warn cp-describe" id="cp-describe" role="status">
                        {DESCRIBE_BEFORE_ACCEPT}
                      </p>
                    ) : null}
                    {error ? (
                      <p className="cp-error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <p className="cp-paynote">
                      You&rsquo;ll pay <b className="cp-num">{money(quote.legal_total_cents)}</b>{" "}
                      through our secure client
                      portal. Once it&rsquo;s received, we&rsquo;ll send your engagement agreement for review and signature.
                    </p>
                  </>
                )}

                {expires ? (
                  <p className="cp-exp">
                    Available through <b>{expires}</b>
                  </p>
                ) : null}
                <p className="cp-how">
                  {hasChoices ? (
                    <>
                      Each brand name{offeredPerMark ? ", or each mark," : ""} is priced under the package you select for it: the
                      package price covers its included classes, then each class added is priced as shown with the package.
                    </>
                  ) : pricing.reduce_under_included === true ? (
                    <>
                      Each trademark is a {pricing.package} package: {money(pricing.base_cents)} for{" "}
                      {plural(pricing.included_classes, "class", "classes")}, adjusted by {money(pricing.per_class_cents)} for
                      each class added or not needed.
                    </>
                  ) : (
                    <>
                      Each trademark is a {pricing.package} package: {money(pricing.base_cents)} for up to{" "}
                      {plural(pricing.included_classes, "class", "classes")}, then {money(pricing.per_class_cents)} for each class
                      added.
                    </>
                  )}
                  {hasChoices ? null : (
                    <>
                      {" "}
                      The second mark for the same name is {Math.round(pricing.second_mark_discount_pct)}% off.
                    </>
                  )}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {accepted && !loeOn ? null : (
        <div className="cp-bar">
          <div className="cp-bar-in">
            <span>
              Legal fee due now <b className="cp-num">{money(quote.legal_total_cents)}</b>
            </span>
            <a href="#cp-review">{accepted ? "Your receipt" : "Review and accept"}</a>
          </div>
        </div>
      )}

      <footer className={`cp-footer ${gutter}`}>
        <div className="cp-wrap">
          {brand === "rpb" ? (
            <>
              <p className="cp-c">RPB Law Firm, PLLC &middot; (305) 712-6960 &middot; info@rpblawfirm.com &middot; www.rpblawfirm.com</p>
              {/* The firm's own footer line, the same on every proposal. A proposal with a letter shows the attorney's replacement only once one is set (it is not: see client-words.ts). */}
              {loeOn && ATTORNEY_FOOTER_LETTER_LINE ? (
                <p className="cp-d">{ATTORNEY_FOOTER_LETTER_LINE}</p>
              ) : (
                <p className="cp-d">
                  Attorney advertising. Prepared for discussion purposes; does not constitute legal advice or create an
                  attorney-client relationship.
                </p>
              )}
            </>
          ) : (
            <p className="cp-c">{[firm.name, firm.contactLine].filter(Boolean).join(" \u00b7 ")}</p>
          )}
          <p className="cp-d">
            {NOT_A_LAW_FIRM_DISCLAIMER} Lectual provides the software this proposal is presented in; the proposal itself is
            from the firm that sent it.
          </p>
        </div>
      </footer>
    </div>
  );
}
