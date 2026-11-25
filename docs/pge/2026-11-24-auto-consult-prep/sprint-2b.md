# Sprint 2b: the full brief (judgment port), build spec

Approved by the director session on Taylor's plan (Nov 25). Branch work only: no merge, no production change, and nothing emails anyone. Lectual's emails stay OFF until S2c.

Source to port: lawmatics-mcp commit 3bcbe3f, `src/consult-brief/` (local clone at `/home/user/lawmatics-mcp`). Every ported file gets a row in `PORTED_FROM.md` (source path and commit). Port the matching tests as well, adapted.

## Rules for every part
- **Per firm, never one firm baked in.** Nothing from lawmatics-mcp's `FIRM_CONFIG`, `config.ts` prices, env reads or deployment token survives.
  - Firm name, time zone, package list (names and prices from `client_proposal_setting.pricing` via `normalisePackages`) and branding are passed IN as arguments.
- **No model call outside an injected function.** The judge receives `llm(request) -> structured output` with the same shape as `ctx.llm` (zod schema, `agent: "consult-prep"`). No Anthropic SDK import in the ported modules.
  - Sonnet comes from `agentModel`, as today.
  - `AGENT_POLICY` goes first in every system prompt.
  - Record data reaches the model only inside tags with `<` and `>` made inert, as the other agents do.
- **Prices never come from the model.** The model picks a package NAME from the firm's list, or HELD. Every price the brief prints comes from the firm's list.
- **No network in tests.** `fetch` is injected. USPTO requests have a 20 s deadline. Any failure makes the pull `unavailable`; it never produces a partial list.
- **No logs carrying a client name, mark or brief text.** Counts and fixed sentences only.
- **One dependency is allowed: `pdf-lib`, with `@pdf-lib/fontkit` for the packages PDF.** Pin them exactly to the versions in lawmatics-mcp's lockfile. Fonts ship in the repo with their licences and are read with `fs`, the way the letter fonts are; add `next.config.ts` tracing for the routes that build the PDF. No other new dependency (zip uses `node:zlib`, as the source does).

## Parts
- **P1 USPTO** -> `src/lib/consult-prep/uspto/`. Port `uspto.ts` (the two-tier knockout), and `uspto-summary.ts` (the CSV and zip are replaced by `xlsx.ts`, the USPTO site's own export workbook, Nov 25), with their fixtures and tests.
- **P2 Judgment** -> `src/lib/consult-prep/judge/`. Port `ai/prompt.ts`, `ai/schemas.ts`, `ai/judge.ts` and `scrub.ts`, plus the pricing helpers that turn a chosen package into printed figures.
  - Prices come from the firm list.
  - The route-and-search-plan call and the judgment call both go through the injected `llm`.
  - The output types are exported for the wiring step.
- **P3 Packages PDF** -> `src/lib/consult-prep/pdf/`. Port `pdf/*` (spec, render, canvas, fonts, palette, template), with tests that build a PDF from fixtures and inspect it.
  - Every price and package row comes from the passed-in list.
  - The firm's name is passed in. Any RPB-only artwork goes through a per-firm map like `src/lib/loe/letter-logo.ts`, and a firm without an entry gets a plain version.
- **P4 Wiring** (after P1-P3 merge, one builder):
  - The engine builds the FULL brief: facts plus the USPTO knockout plus class and risk plus the package plus questions. This is the skill's section order, extending `renderConsultBrief` with the ported `compose.ts` content.
  - The brief type becomes `full`, so booked and 24h are sent (S2a's rules).
  - A build failure (model, USPTO, budget) leaves the brief `facts` and is retried by the next run (S2a's withheld and owed logic).
  - Attachments (`tmSearchResults<date>.xlsx` (the USPTO site's own export; was `<Mark>_USPTO_first500.csv.zip`), `<Client>_Packages_<Mark>.pdf`) are added to the email through `sendInternalMail`, which gains `attachments`. If Resend refuses attachments, the email is re-posted once without them and the body names what is missing.
  - The same two files are saved to the lead's Documents & files (Taylor approved Nov 24). This is the first service-role `crm_file` write, kept in ONE file:
    - the org comes from the lead row;
    - the existing path rule `{org}/lead/{lead}/{file}.{ext}` and the extension-to-type map apply;
    - the object is uploaded and then the row inserted;
    - `file_uploaded` is logged;
    - it never throws into the run.
  - A re-run builds a new full brief.
  - The model is Sonnet, at most 2 calls per prep, with the budget checked before each.
- **P5 Review:** a strict check and an independent review (Opus), then a report to the director.
