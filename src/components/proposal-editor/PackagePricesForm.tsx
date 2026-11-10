"use client";

import { useState } from "react";
import type { PricingValues } from "./PricingFields";
import { packageExample } from "@/lib/proposals/package-example";
import type { ProposalInclude } from "@/lib/proposals/types";
import { IncludesFields } from "./IncludesFields";

/** One package on the settings page: its six price fields and (2026-11-10) its own "what this package includes" rows. */
export type SettingsPackageValues = PricingValues & { includes?: ProposalInclude[] };

type PackageRow = SettingsPackageValues & { key: number };


/**
 * Settings → Proposals → "Packages": one fieldset per package, with
 * the six fields the proposal editor uses, in dollars (whole cents are stored).
 * The first package is the default a new proposal starts from. "Add package"
 * starts from a copy of the last one's numbers, with a blank name that has to
 * be filled in; "Remove" is disabled on the last package, and the action refuses
 * it as well. Posted as `pkg.<n>.<field>`; the server action re-parses and
 * validates everything, and re-checks the admin gate.
 *
 * Each package also has its own "What this package includes" rows (2026-11-10), posted as `pkg.<n>.inc.<r>.<field>`
 * with the marker `pkg.<n>.incFields=1`. A new proposal's package snapshot takes them, and the client page's
 * "What each package includes" comparison shows them. A new package starts with none.
 *
 * Since Sprint 33 this is a SECTION of the one settings form (`SettingsForm`), not a form of its
 * own: the settings page has one form and one Save button.
 */
export function PackagePricesSection({ packages }: { packages: SettingsPackageValues[] }) {
  const [rows, setRows] = useState<PackageRow[]>(() => packages.map((p, key) => ({ ...p, key })));
  const [nextKey, setNextKey] = useState(packages.length);

  function add() {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, { ...(last ?? emptyPackage), package: "", includes: [], key: nextKey }];
    });
    setNextKey((k) => k + 1);
  }

  // The typed value of one field, kept so the example line follows what is in the box.
  function edit(key: number, field: keyof PricingValues, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  function remove(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  return (
    <>
        <section className="lx-card pe-card pe-pkgs" aria-labelledby="package-prices-h">
          <header className="pe-card-head">
            <h2 className="pe-h" id="package-prices-h">
              Packages
            </h2>
            <p className="lx-note pe-hint">
              Dollars here, whole cents underneath. Totals are always worked out from these, never typed. USPTO fees are due at filing and are shown to the
              client separately.
            </p>
          </header>
          {rows.map((row, n) => (
            <fieldset key={row.key} className="pe-fieldset pe-pkg" aria-label={`Package ${n + 1}`}>
              <div className="pe-pkg-head">
                <span className="lx-label">{n === 0 ? "Package 1 · default for new proposals" : `Package ${n + 1}`}</span>
                <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => remove(row.key)} disabled={rows.length <= 1}>
                  Remove
                </button>
              </div>
              <div className="lx-form-grid">
                <label className="lx-field">
                  <span className="lx-label">Package name</span>
                  <input className="lx-input" name={`pkg.${n}.package`} onChange={(e) => edit(row.key, "package", e.target.value)} required maxLength={120} defaultValue={row.package} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Price with the included classes ($)</span>
                  <input className="lx-input" name={`pkg.${n}.base`} onChange={(e) => edit(row.key, "base", e.target.value)} inputMode="decimal" required defaultValue={row.base} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Classes included</span>
                  <input className="lx-input" name={`pkg.${n}.includedClasses`} onChange={(e) => edit(row.key, "includedClasses", e.target.value)} inputMode="numeric" required defaultValue={row.includedClasses} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Price per extra class ($)</span>
                  <input className="lx-input" name={`pkg.${n}.perClass`} onChange={(e) => edit(row.key, "perClass", e.target.value)} inputMode="decimal" required defaultValue={row.perClass} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Second mark discount (%)</span>
                  <input className="lx-input" name={`pkg.${n}.secondMarkPct`} onChange={(e) => edit(row.key, "secondMarkPct", e.target.value)} inputMode="decimal" required defaultValue={row.secondMarkPct} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">USPTO fee per class per mark ($)</span>
                  <input className="lx-input" name={`pkg.${n}.govPerClass`} onChange={(e) => edit(row.key, "govPerClass", e.target.value)} inputMode="decimal" required defaultValue={row.govPerClass} />
                </label>
              </div>
              <p className="lx-note pe-example" aria-live="polite">
                {packageExample(row).text}
              </p>
              <details className="pe-pkg-inc">
                <summary className="lx-label">
                  What this package includes{row.includes && row.includes.length > 0 ? ` (${row.includes.length})` : ""}
                </summary>
                <p className="lx-note pe-hint">
                  Shown to the client in the &ldquo;What each package includes&rdquo; comparison on new proposals that let them choose a package. Proposals already made keep their own rows.
                </p>
                <input type="hidden" name={`pkg.${n}.incFields`} value="1" />
                <IncludesFields prefix={`pkg.${n}.inc`} initial={row.includes ?? []} editable />
              </details>
            </fieldset>
          ))}
          <div className="pe-save">
            <button type="button" className="lx-btn lx-btn-sec" onClick={add}>
              Add package
            </button>
          </div>
        </section>
    </>
  );
}

const emptyPackage: PricingValues = { package: "", base: "", includedClasses: "", perClass: "", secondMarkPct: "", govPerClass: "" };
