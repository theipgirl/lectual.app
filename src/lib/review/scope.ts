/**
 * What the weekly review draws in its first wave (Nov 17). Display only: the loader still reads proposal expiry,
 * because the "Since Feb 2026" filter protects a row that has a live proposal, and a failed read still turns that
 * filter off. Proposals and Forms are not part of the Monday meeting yet, so nothing about them is DRAWN:
 * no "Proposals out" strip, no expiry tag on a card, row, sheet line or panel. Flip this to bring them back.
 */
export const REVIEW_SHOWS_PROPOSALS = false;
