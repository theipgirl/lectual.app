// Barrel of ONLY the pure intake modules — scope, temperature, referral-source,
// reply. Every one of these avoids getScopedClient/next/headers on purpose so
// client components (the /dashboard/intake filter bar, temp-override menu,
// etc.) can import from here safely.
//
// Server modules that live alongside these in src/lib/intake/ (e.g. the
// scoped-client-backed leads.ts reader, and the sheet-import writer) are
// NEVER re-exported from this barrel — doing so would drag `getScopedClient`
// (and therefore `next/headers`) into the client bundle the moment anything
// imports "@/lib/intake". Import those directly, e.g. "@/lib/intake/leads".
// Same convention as src/lib/pipeline/index.ts excluding "./board".
export * from "./scope";
export * from "./temperature";
export * from "./referral-source";
export * from "./reply";
