import { DETAILS_HEADING, DETAILS_INTRO } from "@/lib/loe/client-words";
import { MAX_CLIENT_TEXT_CHARS } from "@/lib/proposals/client-classes";
import type { SignerDetails } from "@/lib/loe/signing";

/**
 * Step 2: the details that go on the letter. Plain controlled inputs (React text, never HTML); the server cleans and checks
 * every one again. Required: full legal name, street and city.
 */

type Field = { key: keyof SignerDetails; label: string; required?: boolean; autoComplete: string; wide?: boolean };

const FIELDS: Field[] = [
  { key: "client_name", label: "Full legal name", required: true, autoComplete: "name", wide: true },
  { key: "entity_name", label: "Business name (if you are signing for a business)", autoComplete: "organization", wide: true },
  { key: "title", label: "Your title in the business", autoComplete: "organization-title" },
  { key: "street", label: "Street address", required: true, autoComplete: "address-line1", wide: true },
  { key: "street2", label: "Apartment, suite or unit", autoComplete: "address-line2" },
  { key: "city", label: "City", required: true, autoComplete: "address-level2" },
  { key: "region", label: "State or region", autoComplete: "address-level1" },
  { key: "postal", label: "Postal code", autoComplete: "postal-code" },
  { key: "country", label: "Country (if outside the United States)", autoComplete: "country-name" },
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
        {FIELDS.map((f) => (
          <label key={f.key} className={`cp-field${f.wide ? " cp-field-wide" : ""}`}>
            <span>
              {f.label}
              {f.required ? <b aria-hidden="true"> *</b> : null}
            </span>
            <input
              type="text"
              name={f.key}
              value={details[f.key]}
              required={f.required}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete={f.autoComplete}
              readOnly={readOnly}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
