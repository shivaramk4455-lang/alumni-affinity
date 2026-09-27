// Conversation openers grounded in the counterpart's own words — drawn only
// from directory-visible fields (profession, city, relocation, institution,
// values), so prompts never leak private columns.
export const ICEBREAKERS = [
  {
    id: "relocation",
    title: "Relocation plans",
    prompt: "Ask about their relocation plans and what home looks like next.",
  },
  {
    id: "profession",
    title: "Work and craft",
    prompt: "Ask what they enjoy most about their work right now.",
  },
  {
    id: "institution",
    title: "Alma mater",
    prompt: "Ask about a favourite memory from their institute years.",
  },
  {
    id: "values",
    title: "Shared values",
    prompt: "Ask about one value from their note that resonated with you.",
  },
  {
    id: "city",
    title: "Everyday life",
    prompt: "Ask what an ordinary good week looks like in their city.",
  },
] as const;

export type Icebreaker = (typeof ICEBREAKERS)[number];
