// Ids start at 101 so a stored answer set never reads with the Brand & Business card's meaning.

import {
  boothQuestions,
  withTrackCopy,
  Q_REVENUE,
  Q_TIMELINE,
  Q_TRACK,
  type BoothQuestion,
  type BoothTrack,
} from "./questions";

export const IP_Q_TRACK = 101;
export const IP_Q_TRADEMARK = 102;
export const IP_Q_CLEARANCE = 103;
export const IP_Q_CONFLICT = 104;
export const IP_Q_CREATES = 105;
export const IP_Q_COPYRIGHT = 106;
export const IP_Q_OWNERSHIP = 107;
export const IP_Q_REVENUE = 108;
export const IP_Q_TIMELINE = 109;

function renumbered(id: number, businessId: number): BoothQuestion {
  const source = boothQuestions.find((q) => q.id === businessId);
  if (!source) throw new Error(`booth question ${businessId} is missing`);
  return { ...source, id };
}

export const ipQuestions: BoothQuestion[] = [
  renumbered(IP_Q_TRACK, Q_TRACK),

  {
    id: IP_Q_TRADEMARK,
    question: "Is your name or logo federally registered as a trademark?",
    category: "trademark",
    brand: { question: "Is your brand name or logo federally registered as a trademark?" },
    options: [
      { label: "Yes, registered", value: "registered", points: 10 },
      { label: "Application pending", value: "applied", points: 5 },
      { label: "No", value: "no", points: 0 },
      { label: "Not sure", value: "unsure", points: 0 },
    ],
  },

  {
    id: IP_Q_CLEARANCE,
    question: "Before you chose your name, was a trademark search done?",
    category: "clearance",
    options: [
      { label: "Yes, a professional search", value: "professional", points: 10 },
      { label: "I searched online myself", value: "self", points: 5 },
      { label: "No", value: "no", points: 0 },
      { label: "Not sure", value: "unsure", points: 0 },
    ],
  },

  // Unscored: it signals urgency, not protection — a "yes" forces HOT in ./ip-score.ts.
  {
    id: IP_Q_CONFLICT,
    question: "Have you seen someone using a similar name — or has anyone contacted you about yours?",
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
      { label: "Not sure", value: "unsure" },
    ],
  },

  {
    id: IP_Q_CREATES,
    question: "Do you create original content?",
    subtext: "Books, courses, video, music, photography, designs, software.",
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ],
  },

  {
    id: IP_Q_COPYRIGHT,
    question: "Have you registered copyrights for your most valuable work?",
    category: "copyright",
    showWhen: { qId: IP_Q_CREATES, anyOf: ["yes"] },
    options: [
      { label: "Yes", value: "all", points: 10 },
      { label: "Some of it", value: "some", points: 5 },
      { label: "No", value: "no", points: 0 },
      { label: "Not sure", value: "unsure", points: 0 },
    ],
  },

  {
    id: IP_Q_OWNERSHIP,
    question: "When others help you create, do written agreements say you own the result?",
    subtext: "Contractors, co-creators, editors, designers.",
    category: "ownership",
    showWhen: { qId: IP_Q_CREATES, anyOf: ["yes"] },
    options: [
      { label: "Yes, always in writing", value: "all", points: 10 },
      { label: "Sometimes", value: "some", points: 5 },
      { label: "No", value: "none", points: 0 },
      // Nobody else's hands on the work means nothing to assign.
      { label: "I create everything myself", value: "solo", points: 10 },
    ],
  },

  renumbered(IP_Q_REVENUE, Q_REVENUE),
  renumbered(IP_Q_TIMELINE, Q_TIMELINE),
];

/** The ip card's question list for a track, with any brand-specific copy applied. */
export function ipQuestionsFor(track: BoothTrack): BoothQuestion[] {
  return withTrackCopy(ipQuestions, track);
}
