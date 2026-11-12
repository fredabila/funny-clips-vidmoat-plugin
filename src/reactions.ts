/**
 * The reaction taxonomy and the moment finder.
 *
 * A "reaction" is the joke a cut-away makes: the creator says something and the
 * edit answers with a clip (a facepalm, a slow zoom, a sad trombone). Each
 * reaction knows the phrases that tend to set it up, what to search for, and
 * which sound effect / text card pairs well with it.
 */

export type ReactionId =
  | "famous_last_words"
  | "fail"
  | "mind_blown"
  | "confused"
  | "awkward"
  | "side_eye"
  | "celebration"
  | "sad"
  | "money"
  | "time_skip"
  | "nope"
  | "hype"
  | "cringe"
  | "thinking"
  | "laugh"
  | "dramatic";

export interface Reaction {
  id: ReactionId;
  label: string;
  /** What the joke is, for the agent and the user. */
  joke: string;
  /** Phrases that set the reaction up. Matched case-insensitively. */
  triggers: RegExp[];
  /** Search queries for clip sources, best first. */
  queries: string[];
  /** Sound effect that pairs well (see sfx.ts). */
  sfx: string;
  /** Optional text card that pairs well instead of / in addition to a clip. */
  card?: { text: string; style: CardStyleName };
  /** How funny a hit usually is; used to rank when moments compete. */
  weight: number;
}

export type CardStyleName = "time_skip" | "narrator" | "impact" | "label";

const w = (s: string) => new RegExp(`\\b${s}\\b`, "i");

export const REACTIONS: Reaction[] = [
  {
    id: "famous_last_words",
    label: "Famous last words",
    joke: "Overconfidence right before it goes wrong; cut to a clip (or narrator card) undercutting it.",
    triggers: [
      w("what could (possibly )?go wrong"),
      w("how hard can it be"),
      w("piece of cake"),
      w("easy peasy"),
      w("i('ve| have) got this"),
      w("trust me"),
      w("no problem"),
      w("this will (only )?take (a )?(second|minute|few minutes)"),
      w("should be (easy|simple|fine)"),
      w("i('m| am) (a )?(professional|expert|pro)"),
      w("nothing can stop"),
    ],
    queries: ["famous last words", "this is fine", "narrator voice it did not", "spoiler it did not go well"],
    sfx: "record_scratch",
    card: { text: "Narrator: it was not easy.", style: "narrator" },
    weight: 1.0,
  },
  {
    id: "fail",
    label: "Fail / facepalm",
    joke: "Something broke or the creator messed up; cut to a facepalm or a fail clip.",
    triggers: [
      w("i forgot"),
      w("(it|that) (didn'?t|did not) work"),
      w("(i|we) (broke|messed up|screwed up|ruined)"),
      w("(mistake|oops|whoops|my bad)"),
      w("(and|but|because) of course"),
      w("failed"),
      w("disaster"),
      w("it (broke|crashed|died)"),
      w("worst (idea|decision)"),
    ],
    queries: ["facepalm", "epic fail", "disappointed", "why are you like this"],
    sfx: "sad_trombone",
    weight: 0.95,
  },
  {
    id: "mind_blown",
    label: "Mind blown",
    joke: "A surprising fact or twist; cut to an explosion-of-brain or jaw-drop clip.",
    triggers: [
      w("plot twist"),
      w("turns out"),
      w("did you know"),
      w("believe it or not"),
      w("wait,? what"),
      w("no way"),
      w("blew my mind"),
      w("mind ?blown"),
      w("(actually|secretly) (is|was|were)"),
      /\b\d{2,}(\.\d+)?\s?(%|percent|times|x)\b/i,
    ],
    queries: ["mind blown", "jaw drop", "shocked", "wait what"],
    sfx: "boom",
    weight: 0.9,
  },
  {
    id: "confused",
    label: "Confused",
    joke: "Something makes no sense; cut to a confused-math or blinking clip.",
    triggers: [
      w("(i have|i've got) no idea"),
      w("makes no sense"),
      w("what does (that|this) (even )?mean"),
      w("confus(ed|ing)"),
      w("i don'?t (get|understand)"),
      w("how does (that|this) (even )?work"),
      w("why (would|does|is) (anyone|anybody|it)"),
    ],
    queries: ["confused", "confused math", "what", "blinking"],
    sfx: "crickets",
    weight: 0.8,
  },
  {
    id: "awkward",
    label: "Awkward silence",
    joke: "A beat that lands flat; cut to crickets, a tumbleweed or an awkward look.",
    triggers: [
      w("awkward"),
      w("anyway(s)?"),
      w("moving on"),
      w("(let'?s|let us) (not|never) talk about"),
      w("we don'?t talk about"),
      w("ahem"),
      w("um+,? so"),
    ],
    queries: ["awkward", "awkward silence", "tumbleweed", "awkward look"],
    sfx: "crickets",
    weight: 0.75,
  },
  {
    id: "side_eye",
    label: "Side-eye / suspicious",
    joke: "A claim nobody believes; cut to a side-eye or suspicious squint.",
    triggers: [
      w("allegedly"),
      w("totally (not|legit)"),
      w("definitely not"),
      w("(i'?m|i am) (sure|not lying)"),
      w("i promise"),
      w("for (research|science) purposes"),
      w("(totally|completely) (normal|fine)"),
      w("sponsored"),
    ],
    queries: ["side eye", "suspicious", "sure jan", "skeptical"],
    sfx: "suspense",
    weight: 0.8,
  },
  {
    id: "celebration",
    label: "Celebration",
    joke: "A win; cut to a victory dance or a crowd going wild.",
    triggers: [
      w("it worked"),
      w("finally"),
      w("we did it"),
      w("(let'?s|lets) go+"),
      w("success(ful)?"),
      w("nailed it"),
      w("(i|we) won"),
      w("yes+!"),
    ],
    queries: ["celebration dance", "victory", "crowd cheering", "lets go"],
    sfx: "airhorn",
    weight: 0.85,
  },
  {
    id: "sad",
    label: "Sad / RIP",
    joke: "A loss played for laughs; cut to dramatic crying or a sad violin moment.",
    triggers: [
      w("unfortunately"),
      w("sadly"),
      w("rip (my|to|in)"),
      w("rest in peace"),
      w("(i|we) lost"),
      w("never (came|coming) back"),
      w("gone forever"),
      w("my heart"),
    ],
    queries: ["crying", "sad", "dramatic crying", "pain"],
    sfx: "sad_trombone",
    weight: 0.8,
  },
  {
    id: "money",
    label: "Money / price shock",
    joke: "A price or a bill; cut to money flying away or a wallet crying.",
    triggers: [
      /\$\s?\d[\d,.]*/,
      w("(expensive|overpriced|pricey)"),
      w("(cost|costs|paid|spent) (me )?(a lot|so much|\\$)"),
      w("i'?m (broke|poor)"),
      w("my (wallet|bank account)"),
      w("(dollars|bucks|grand)"),
    ],
    queries: ["money flying", "broke", "take my money", "wallet crying"],
    sfx: "ding",
    weight: 0.85,
  },
  {
    id: "time_skip",
    label: "Time skip",
    joke: "Something took forever; cut to a 'hours later' card.",
    triggers: [
      w("(hours|days|weeks|months|years) later"),
      w("(it|this) took (me )?(forever|hours|days|weeks|ages)"),
      w("after (a while|hours|forever)"),
      w("eventually"),
      w("still waiting"),
      w("all (day|night)"),
    ],
    queries: ["waiting", "skeleton waiting", "time passing", "still waiting"],
    sfx: "whoosh",
    card: { text: "3 HOURS LATER", style: "time_skip" },
    weight: 0.9,
  },
  {
    id: "nope",
    label: "Nope",
    joke: "A hard refusal; cut to someone walking away or a 'nope' clip.",
    triggers: [
      w("absolutely not"),
      w("never again"),
      w("hell no"),
      w("no thanks"),
      w("i'?m out"),
      w("not happening"),
      w("nope"),
    ],
    queries: ["nope", "walking away", "absolutely not", "bye"],
    sfx: "whoosh",
    weight: 0.85,
  },
  {
    id: "hype",
    label: "Hype",
    joke: "Something genuinely impressive; cut to a hype or 'insane' reaction.",
    triggers: [
      w("insane"),
      w("crazy"),
      w("unbelievable"),
      w("incredible"),
      w("(goes|went) hard"),
      w("game ?changer"),
      w("(best|greatest) (thing|ever)"),
    ],
    queries: ["hype", "excited", "oh my god", "amazing reaction"],
    sfx: "airhorn",
    weight: 0.7,
  },
  {
    id: "cringe",
    label: "Cringe",
    joke: "Second-hand embarrassment; cut to a wince or someone hiding their face.",
    triggers: [
      w("cringe"),
      w("embarrass(ing|ed)"),
      w("so bad"),
      w("(i|we) can'?t believe (i|we) (did|said)"),
      w("old (videos?|photos?|me)"),
    ],
    queries: ["cringe", "wince", "embarrassed", "hide face"],
    sfx: "boom",
    weight: 0.8,
  },
  {
    id: "thinking",
    label: "Thinking / calculating",
    joke: "Mental math or a plan forming; cut to a calculating or galaxy-brain clip.",
    triggers: [
      w("let me think"),
      w("(do|doing) the math"),
      w("(big|galaxy) brain"),
      w("(genius|smart) (idea|plan|move)"),
      w("calculat(e|ing)"),
      w("(here'?s|i had) (an|a) idea"),
    ],
    queries: ["thinking", "calculating", "smart", "big brain"],
    sfx: "ding",
    weight: 0.7,
  },
  {
    id: "laugh",
    label: "Laugh",
    joke: "A joke landed; cut to someone losing it.",
    triggers: [w("(haha|lol|lmao)"), w("(so|really) funny"), w("hilarious"), w("i('m| am) dying"), w("joke")],
    queries: ["laughing", "laughing hysterically", "lol", "cant stop laughing"],
    sfx: "rimshot",
    weight: 0.65,
  },
  {
    id: "dramatic",
    label: "Dramatic",
    joke: "Over-the-top stakes; cut to a dramatic zoom or a dun-dun-dun sting.",
    triggers: [
      w("the worst (part|thing|day|idea)"),
      w("never (ever )?(seen|been)"),
      w("everything changed"),
      w("(and )?that'?s when"),
      w("little did (i|we|he|she|they) know"),
      w("the truth is"),
    ],
    queries: ["dramatic", "dramatic zoom", "gasp", "dun dun dun"],
    sfx: "suspense",
    weight: 0.75,
  },
];

export const REACTION_IDS = REACTIONS.map((r) => r.id) as ReactionId[];

export function getReaction(id: string): Reaction | undefined {
  return REACTIONS.find((r) => r.id === id);
}

/** A transcript segment as most transcribers return it. Times in seconds. */
export interface Segment {
  start?: number;
  end?: number;
  text: string;
}

export type Density = "light" | "medium" | "heavy";

/** Minimum seconds between two inserts, and the max inserts per minute. */
const DENSITY: Record<Density, { minGap: number; perMinute: number }> = {
  light: { minGap: 40, perMinute: 1 },
  medium: { minGap: 20, perMinute: 2 },
  heavy: { minGap: 10, perMinute: 4 },
};

export interface Moment {
  /** Where to insert the cut-away, in seconds (end of the setup line). */
  insertAt: number | null;
  /** Index of the segment that sets it up. */
  segmentIndex: number;
  /** The words that triggered it. */
  setup: string;
  matched: string;
  reaction: ReactionId;
  label: string;
  joke: string;
  /** Best search query for the clip. */
  query: string;
  alternateQueries: string[];
  suggestedClipSeconds: number;
  sfx: string;
  card?: { text: string; style: CardStyleName };
  score: number;
}

/**
 * Split plain text into pseudo-segments (sentences) when the caller has no
 * timestamps.
 */
export function textToSegments(text: string): Segment[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t }));
}

export function findMoments(
  segments: Segment[],
  opts: { density?: Density; only?: ReactionId[]; exclude?: ReactionId[]; max?: number } = {},
): Moment[] {
  const density = DENSITY[opts.density ?? "medium"];
  const allowed = REACTIONS.filter(
    (r) => (!opts.only?.length || opts.only.includes(r.id)) && !opts.exclude?.includes(r.id),
  );

  const candidates: Moment[] = [];
  segments.forEach((seg, i) => {
    let best: { r: Reaction; match: string; score: number } | null = null;
    for (const r of allowed) {
      for (const t of r.triggers) {
        const m = seg.text.match(t);
        if (!m) continue;
        // Setups at the end of a line are punchier: the cut lands right after.
        const pos = (m.index ?? 0) / Math.max(1, seg.text.length);
        const score = r.weight * (0.8 + 0.2 * pos) + (/[!?]\s*$/.test(seg.text) ? 0.05 : 0);
        if (!best || score > best.score) best = { r, match: m[0], score };
        break;
      }
    }
    if (!best) return;
    const { r, match, score } = best;
    candidates.push({
      insertAt: typeof seg.end === "number" ? round(seg.end) : typeof seg.start === "number" ? round(seg.start) : null,
      segmentIndex: i,
      setup: seg.text,
      matched: match,
      reaction: r.id,
      label: r.label,
      joke: r.joke,
      query: r.queries[0],
      alternateQueries: r.queries.slice(1),
      suggestedClipSeconds: r.id === "time_skip" ? 1.5 : 2.5,
      sfx: r.sfx,
      card: r.card,
      score: round(score),
    });
  });

  // Pace the edit: take the strongest moments first, then drop any that land
  // too close to one already chosen, and cap inserts per minute.
  const hasTimes = candidates.some((c) => c.insertAt !== null);
  const totalSeconds = hasTimes ? Math.max(...segments.map((s) => s.end ?? s.start ?? 0)) : segments.length * 5;
  const cap = Math.min(opts.max ?? Infinity, Math.max(1, Math.ceil((totalSeconds / 60) * density.perMinute)));

  const chosen: Moment[] = [];
  const time = (m: Moment) => m.insertAt ?? m.segmentIndex * 5;
  // The same gag twice in quick succession gets old.
  const repeatGap = Math.max(60, density.minGap * 3);
  for (const c of [...candidates].sort((a, b) => b.score - a.score || time(a) - time(b))) {
    if (chosen.length >= cap) break;
    if (chosen.some((o) => Math.abs(time(o) - time(c)) < density.minGap)) continue;
    if (chosen.some((o) => o.reaction === c.reaction && Math.abs(time(o) - time(c)) < repeatGap)) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => (a.insertAt ?? a.segmentIndex) - (b.insertAt ?? b.segmentIndex));
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
