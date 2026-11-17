/**
 * Pure parser for a TSDR case-status response. Keeps only what a docket check needs: the serial, the status
 * code and text, the status date and the key dates. The owner's name, address, attorney, mark text and
 * everything else in the response are dropped here by construction: the result object is built field by
 * field, never spread from the input.
 *
 * ASSUMED SHAPE: UNVERIFIED. The current USPTO documentation (see README.md) describes the single-case
 * endpoint as ST.96 XML only and gives no JSON schema; no valid API key was available to read a real
 * response. This parser reads the legacy TSDR `info.json` shape as remembered:
 *
 *   { "trademarks": [ { "status": {
 *       "serialNumber": "78787878",          // UNVERIFIED
 *       "status": 700,                       // UNVERIFIED: integer status code
 *       "statusDescription": "...",          // UNVERIFIED (may be absent: text is then null)
 *       "statusDate": "2020-01-31",          // UNVERIFIED
 *       "filingDate", "publicationDate",     // UNVERIFIED
 *       "usRegistrationDate", "abandonDate", // UNVERIFIED
 *       "officeActionResponseDueDate"        // UNVERIFIED, very likely not a real field: null when absent
 *   } } ] }
 *
 * Anything that does not fit is a "shape" failure, never a partial guess.
 */

export type TsdrDates = {
  filing: string | null;
  publication: string | null;
  registration: string | null;
  abandonment: string | null;
  /** Office-action / response-due date when the response carries one. Field name UNVERIFIED. */
  responseDue: string | null;
};

export type TsdrStatus = {
  serial: string;
  statusCode: number;
  statusText: string | null;
  /** YYYY-MM-DD */
  statusDate: string;
  dates: TsdrDates;
};

export type ParseResult = { ok: true; value: TsdrStatus } | { ok: false; reason: "shape" };

const SHAPE: ParseResult = { ok: false, reason: "shape" };
const SERIAL = /^\d{8}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "2020-01-31" or "2020-01-31T00:00:00-05:00" -> "2020-01-31"; anything else (or an impossible date) -> undefined. */
function civilDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Absent / null / "" = null; present but unreadable = undefined (shape failure). */
function optionalDate(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return civilDate(v);
}

export function parseTsdrStatus(body: unknown, expectedSerial?: string): ParseResult {
  if (!isRecord(body)) return SHAPE;
  const marks = body.trademarks;
  if (!Array.isArray(marks) || marks.length !== 1) return SHAPE;
  const mark = marks[0];
  if (!isRecord(mark) || !isRecord(mark.status)) return SHAPE;
  const s = mark.status;

  const serialRaw = typeof s.serialNumber === "number" ? String(s.serialNumber).padStart(8, "0") : s.serialNumber;
  if (typeof serialRaw !== "string" || !SERIAL.test(serialRaw)) return SHAPE;
  if (expectedSerial !== undefined && serialRaw !== expectedSerial) return SHAPE;

  const code = s.status;
  if (typeof code !== "number" || !Number.isInteger(code) || code < 0) return SHAPE;

  let statusText: string | null = null;
  if (s.statusDescription !== undefined && s.statusDescription !== null) {
    if (typeof s.statusDescription !== "string") return SHAPE;
    const t = s.statusDescription.replace(/\s+/g, " ").trim();
    statusText = t === "" ? null : t.slice(0, 300);
  }

  const statusDate = civilDate(s.statusDate);
  if (statusDate === undefined) return SHAPE;

  const filing = optionalDate(s.filingDate);
  const publication = optionalDate(s.publicationDate);
  const registration = optionalDate(s.usRegistrationDate);
  const abandonment = optionalDate(s.abandonDate);
  const responseDue = optionalDate(s.officeActionResponseDueDate);
  if (
    filing === undefined ||
    publication === undefined ||
    registration === undefined ||
    abandonment === undefined ||
    responseDue === undefined
  ) {
    return SHAPE;
  }

  return {
    ok: true,
    value: {
      serial: serialRaw,
      statusCode: code,
      statusText,
      statusDate,
      dates: { filing, publication, registration, abandonment, responseDue },
    },
  };
}
