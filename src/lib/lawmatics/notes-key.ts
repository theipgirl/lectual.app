/** The key a record's notes are stored under. Kind is part of it: a contact id can equal a prospect id. */
export const notesKey = (t: { id: string; kind: string }): string => `${t.kind}:${t.id}`;
