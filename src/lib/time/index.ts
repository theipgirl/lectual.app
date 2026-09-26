// Barrel of ONLY the pure time module — the roll-ups and their types. It is
// what the ⏱ chip and the dialog import, so it must stay free of
// getScopedClient (and therefore of next/headers): re-exporting ./entries here
// would drag the server DB client into the browser bundle the moment a client
// component imported "@/lib/time".
//
// Same convention as src/lib/intake/index.ts excluding "./leads", and
// src/lib/pipeline/index.ts excluding "./board". Import the writer directly:
// "@/lib/time/entries".
export * from "./rollup";
