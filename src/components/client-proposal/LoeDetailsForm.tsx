import { DETAILS_HEADING, DETAILS_INTRO } from "@/lib/loe/client-words";
import { MAX_CLIENT_TEXT_CHARS } from "@/lib/proposals/client-classes";
import { REQUIRED_DETAIL_KEYS, type SignerDetails } from "@/lib/loe/signing";

/**
 * Step 2: the details that go on the letter. Plain controlled inputs (React text, never HTML); the server cleans and checks
 * every one again. Required: full legal name, street, city, state, ZIP or postal code and country (`REQUIRED_DETAIL_KEYS`, the same list
 * the server checks); the other three say "(optional)" in their label.
 */

type Field = { key: keyof SignerDetails; label: string; autoComplete: string; wide?: boolean };

const FIELDS: Field[] = [
  { key: "client_name", label: "Full legal name", autoComplete: "name", wide: true },
  { key: "entity_name", label: "Business name (optional)", autoComplete: "organization", wide: true },
  { key: "title", label: "Your title in the business (optional)", autoComplete: "organization-title" },
  { key: "street", label: "Street address", autoComplete: "address-line1", wide: true },
  { key: "street2", label: "Apartment, suite or unit (optional)", autoComplete: "address-line2" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "region", label: "State", autoComplete: "address-level1" },
  { key: "postal", label: "ZIP or postal code", autoComplete: "postal-code" },
  { key: "country", label: "Country", autoComplete: "country-name" },
];

export function LoeDetailsForm({
  details,
  onChange,
  readOnly,
}: {
  details: SignerDetails;
  onChange: (key: keyof SignerDetails, value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="cp-choose cp-details" aria-labelledby="cp-details-h">
      <div className="cp-step-h">
        <span className="cp-n" aria-hidden="true">
          2
        </span>
        <div>
          <h2 id="cp-details-h">{DETAILS_HEADING}</h2>
          <p>{DETAILS_INTRO}</p>
        </div>
      </div>
      <div className="cp-form">
        {FIELDS.map((f) => {
          const required = (REQUIRED_DETAIL_KEYS as readonly string[]).includes(f.key);
          return (
          <label key={f.key} className={`cp-field${f.wide ? " cp-field-wide" : ""}`}>
            <span>
              {f.label}
              {required ? <b aria-hidden="true"> *</b> : null}
            </span>
            <input
              type="text"
              name={f.key}
              value={details[f.key]}
              required={required}
              aria-required={required ? true : undefined}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete={f.autoComplete}
              readOnly={readOnly}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </label>
          );
        })}
      </div>
    </section>
  );
}
