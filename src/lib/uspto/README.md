# USPTO TSDR status reader

Read-only reader of a trademark application's status by serial number. NOT wired into any page, action or cron.
Files: `config.ts` (the key), `fetch-status.ts`, `parse.ts`, `stage-map.ts`, `compare.ts`, `index.ts`. Tests: `tests/uspto/`.

## What the documentation said (read 2026-11-17)

The USPTO's own pages could not be read from the build sandbox: `developer.uspto.gov/api-catalog/tsdr-data-api`
answers 301 to `data.uspto.gov/home`, and the fetch tool got an empty page from `data.uspto.gov/home` and
`data.uspto.gov/apis/transition-guide/tsdr` (a JavaScript app). `data.uspto.gov/documents/documents/TSDR-API-Key-Manager-user-guide.pdf`
also came back empty. What WAS read:

- USPTO's published Swagger for TSDR, as republished at https://github.com/mustberuss/TSDR-Swagger
  (`myswagger_v1_tsdr_uspto.json`, fetched from raw.githubusercontent.com): host `tsdrapi.uspto.gov`, basePath `/ts/cd/`,
  https only. Security scheme: API key, header `USPTO-API-KEY`. Single-case status: `GET /casestatus/{caseid}/info`
  ("snXXXXXXXX for US serial number"; `rn` registration, `ref`/`ir` Madrid), **produces `application/xml`** (ST.96).
  Responses: 200, 204 "Trademark is not registered", 400 invalid case id, 401 missing/invalid key, 404 "Trademark for the
  case ID does not exist", 429 "Too Many Requests/Api limit Exceeded". Also `/caseMultiStatus/{type}` (multi-case).
- Web search summary of USPTO's TSDR API Key Manager guide (https://www.uspto.gov/sites/default/files/documents/tm-enterprise-api-user-guide-v2.pdf):
  key name `USPTO-API-KEY`; keys from https://account.uspto.gov/api-manager; 429 when too many requests. No figures given.
- Third-party (NOT USPTO) https://github.com/parkerhancock/patent-client-agents (uspto-tsdr.md): 60 requests/min general
  (peak 5am-10pm ET), 120/min off-peak; PDF/ZIP 4/min peak. TSDR key is separate from the Open Data Portal key.
- Live probes from the sandbox (no valid key): no key -> 401; an invalid key -> `404` with body "BACKEND RESPONSE STATUS: 404"
  for `/casestatus/sn76044902/info`, `.../info.xml` and `.../info.json` alike. So **404 is ambiguous** (it was returned for a bad key).

## Decisions

- Env var `USPTO_TSDR_API_KEY` (declared in `src/lib/env.ts`, read only in `config.ts`). Unset/blank = `not-set-up`.
- 404 = `unavailable` / `not_found`, never `ok`, because of the probe above. A 204 is `http_204`.
- Extra fixed reasons beyond the brief: `network` (non-timeout fetch failure) and `bad_serial` (not 8 digits; no request made).
- The deadline is 15 s (`withTimeout` from `src/lib/http/timeout.ts`). The rate limit is not enforced here; a 429 is `rate_limited`.
- The owner name and everything else personal is dropped in `parse.ts` (built field by field; tested).

## UNVERIFIED (every one)

1. **The URL path `/casestatus/sn<serial>/info.json`.** The Swagger documents `/info` (XML). The `.json` suffix and a JSON body are from memory of
   the legacy TSDR service. If JSON is not served, the fix is an ST.96 XML parser (none is installed) in `parse.ts`.
2. **The whole JSON shape**: `trademarks[0].status.{serialNumber, status, statusDescription, statusDate, filingDate,
   publicationDate, usRegistrationDate, abandonDate}`. `officeActionResponseDueDate` is very likely NOT a real field
   (response due dates are probably only in the prosecution history); it parses as null when absent.
3. **The numeric status codes** in `stage-map.ts` (602, 630, 641, 680, 700) and the text patterns. Both came from memory, not a current USPTO list.
4. The 60/min rate limit (third party). Auth header name is documented in USPTO's Swagger and key-manager guide.
5. Stage names assume RPB's labels without the code: Application Filed (17), Awaiting Trademark Registration (18), OA Issued (19A),
   Publication for Opposition (22), Registered, Abandoned. The caller resolves names to the firm's own stages.

Before wiring this in: with a real key, `curl -H "USPTO-API-KEY: ..." https://tsdrapi.uspto.gov/ts/cd/casestatus/sn<serial>/info.json`
and `.../info.xml`, then fix `parse.ts` and the fixtures in `tests/uspto/fixtures.ts` to the real response.
