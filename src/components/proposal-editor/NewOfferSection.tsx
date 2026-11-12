"use client";

import { useState } from "react";
import { MAX_NEW_OFFER_OPTIONS, NEW_OFFER_MARKER, type NewOffer } from "@/lib/proposals/new-offer";
import { NEW_OFFER_WORDS } from "@/lib/proposal-editor/vocabulary";

/**
 * Settings -> Proposals -> "New proposals offer": a section of the ONE settings form (one Save). Package NAMES only:
 * the prices always come from the packages above. Posted as `newOffer.*` with a marker, so a post without it
 * leaves the stored setting alone. The server re-checks every name against the firm's list.
 */
export function NewOfferSection({ packageNames, offer }: { packageNames: string[]; offer: NewOffer | null }) {
  const [mode, setMode] = useState<"default" | "one" | "choice">(offer?.mode ?? "default");
  const [options, setOptions] = useState<string[]>(offer?.options ?? []);
  const [start, setStart] = useState<string>(offer?.start ?? "");
  const choosing = mode === "choice";
  const single = mode === "one";
  const atLimit = options.length >= MAX_NEW_OFFER_OPTIONS;

  return (
    <section className="lx-card pe-card" aria-labelledby="new-offer-h" data-new-offer>
      <header className="pe-card-head">
        <h2 className="pe-h" id="new-offer-h">
          {NEW_OFFER_WORDS.heading}
        </h2>
        <p className="lx-note pe-hint">{NEW_OFFER_WORDS.hint}</p>
      </header>
      <input type="hidden" name={NEW_OFFER_MARKER} value="1" />
      <div className="lx-form-grid">
        <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
          <span className="lx-label">Offer</span>
          <select className="lx-input" name="newOffer.mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="default">{NEW_OFFER_WORDS.modeDefault}</option>
            <option value="one">{NEW_OFFER_WORDS.modeOne}</option>
            <option value="choice">{NEW_OFFER_WORDS.modeChoice}</option>
          </select>
        </label>
        {single && (
          <label className="lx-field">
            <span className="lx-label">Package</span>
            <select className="lx-input" name="newOffer.start" value={start || packageNames[0] || ""} onChange={(e) => setStart(e.target.value)}>
              {packageNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {choosing && (
          <>
            <label className="lx-field">
              <span className="lx-label">{NEW_OFFER_WORDS.per}</span>
              <select className="lx-input" name="newOffer.per" defaultValue={offer?.per ?? "brand"}>
                <option value="brand">{NEW_OFFER_WORDS.perBrand}</option>
                <option value="mark">{NEW_OFFER_WORDS.perMark}</option>
              </select>
            </label>
            <fieldset className="lx-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lx-label">{NEW_OFFER_WORDS.options}</legend>
              {packageNames.map((n) => (
                <label key={n} className="pe-check">
                  <input
                    type="checkbox"
                    name="newOffer.option"
                    value={n}
                    checked={options.includes(n)}
                    disabled={!options.includes(n) && atLimit}
                    onChange={(e) => setOptions((prev) => (e.target.checked ? [...prev, n] : prev.filter((x) => x !== n)))}
                  />
                  <span>{n}</span>
                </label>
              ))}
            </fieldset>
            <label className="lx-field">
              <span className="lx-label">{NEW_OFFER_WORDS.start}</span>
              <select className="lx-input" name="newOffer.start" value={options.includes(start) ? start : (options[0] ?? "")} onChange={(e) => setStart(e.target.value)}>
                {options.length === 0 && <option value="">Pick a package above</option>}
                {options.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </section>
  );
}
