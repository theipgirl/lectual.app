// The notification centre's barrel (blueprint §13.3).
//
// UNLIKE src/lib/intake/index.ts, this one is SERVER-ONLY: there is no pure
// half to separate out — every export here reaches the database through
// getScopedClient, and core.ts imports "server-only" to say so. Importing
// "@/lib/notifications" from a client component is therefore a build error by
// design, not a bundle leak. The bell UI takes its rows as props from a server
// component, the same way the intake table takes its leads.
export * from "./core";
