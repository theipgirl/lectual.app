/**
 * The ONE list of United States states and territories the "Your details" form offers when the country is the United States.
 * PURE. The stored value is the two-letter code (a plain string, so the agreement text, its fingerprint and the Lawmatics
 * address payload read it exactly as they read any typed state); the visible label is "Florida (FL)".
 */

export type UsState = { code: string; name: string };

export const US_STATES: readonly UsState[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  // Territories and military mail codes.
  { code: "PR", name: "Puerto Rico" },
  { code: "GU", name: "Guam" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "AS", name: "American Samoa" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "AA", name: "Armed Forces Americas" },
  { code: "AE", name: "Armed Forces Europe" },
  { code: "AP", name: "Armed Forces Pacific" },
];

/** "Florida (FL)". */
export function stateOptionLabel(s: UsState): string {
  return `${s.name} (${s.code})`;
}

const US_COUNTRY_SPELLINGS = new Set(["united states", "united states of america", "usa", "u.s.a.", "u.s.", "us", "america"]);

/** Is this typed country the United States? Case and spacing are ignored; the form starts with "United States". */
export function isUnitedStates(country: string): boolean {
  return US_COUNTRY_SPELLINGS.has(country.trim().toLowerCase().replace(/\s+/g, " "));
}

/** The code for a stored state value ("fl", "FL", "Florida"), or null when it is not one of the list. */
export function usStateCode(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const hit = US_STATES.find((s) => s.code.toLowerCase() === v || s.name.toLowerCase() === v);
  return hit ? hit.code : null;
}
