/**
 * The MCP tools. Descriptions are written for the agent: Vidmoat's agents read
 * these and nothing else when deciding what to call.
 */
import { z } from "zod";
import { REACTIONS, REACTION_IDS, findMoments, textToSegments, type ReactionId } from "./reactions.js";
import { enabledSources, resolveClip, searchClips, searchForReaction, type SourceName } from "./sources.js";
import { SFX_NAMES, listSfx } from "./sfx.js";
import { ASPECTS, CARD_COLORS, CARD_STYLES } from "./card.js";

const reactionEnum = z.enum(REACTION_IDS as [ReactionId, ...ReactionId[]]);
const rating = z.enum(["g", "pg", "pg-13"]).default("pg-13").describe("Content rating ceiling for GIF results.");
const orientation = z
  .enum(["landscape", "portrait", "square"])
  .optional()
  .describe("Match the project's frame (portrait for Shorts/Reels/TikTok).");
const sourceEnum = z.enum(["library", "giphy", "pexels"]);

const REACTION_LIST = REACTIONS.map((r) => `${r.id} (${r.label.toLowerCase()})`).join(", ");

const schemas = {
  find_funny_moments: z
    .object({
      segments: z
        .array(z.object({ start: z.number().optional(), end: z.number().optional(), text: z.string() }))
        .max(5000)
        .optional()
        .describe("Transcript segments with start/end in seconds, e.g. the output of Vidmoat's transcribe tool."),
      text: z.string().max(100_000).optional().describe("Plain transcript text, if you have no timestamps."),
      density: z
        .enum(["light", "medium", "heavy"])
        .default("medium")
        .describe("light: about 1 insert a minute; medium: about 2; heavy: up to 4, fast meme-edit pacing."),
      only: z.array(reactionEnum).optional().describe("Only look for these reactions."),
      exclude: z.array(reactionEnum).optional().describe("Never suggest these reactions."),
      max: z.number().int().min(1).max(50).optional().describe("Hard cap on the number of moments."),
      withClips: z.boolean().default(true).describe("Also search for 3 clip candidates per moment."),
      rating,
      orientation,
    })
    .refine((v) => v.segments?.length || v.text, { message: "Pass segments or text" }),

  search_reaction_clips: z
    .object({
      query: z.string().max(120).optional().describe('Free-text search, e.g. "facepalm" or "slow clap".'),
      reaction: reactionEnum.optional().describe("Search by reaction type instead of (or as well as) a query."),
      limit: z.number().int().min(1).max(25).default(8),
      sources: z.array(sourceEnum).optional().describe("Restrict to these sources. Default: every configured source."),
      rating,
      orientation,
    })
    .refine((v) => v.query || v.reaction, { message: "Pass query or reaction" }),

  get_reaction_clip: z
    .object({
      clipId: z.string().max(200).optional().describe('An id from search_reaction_clips or find_funny_moments, e.g. "giphy:abc123".'),
      query: z.string().max(120).optional().describe("Or: take the best match for this search."),
      reaction: reactionEnum.optional().describe("Or: take the best match for this reaction."),
      rating,
      orientation,
    })
    .refine((v) => v.clipId || v.query || v.reaction, { message: "Pass clipId, query or reaction" }),

  get_sound_effect: z.object({
    name: z.enum(SFX_NAMES as [string, ...string[]]).describe(listSfx().map((s) => `${s.name}: ${s.description}`).join(" ")),
  }),

  make_text_card: z.object({
    text: z
      .string()
      .min(1)
      .max(200)
      .describe('The words. For impact style, "top text | bottom text" puts text at both edges.'),
    style: z
      .enum(CARD_STYLES)
      .describe(
        "time_skip: full-frame cartoon title card ('3 HOURS LATER'), use as its own 1.5s clip. " +
          "narrator: transparent PNG with a dark caption bar at the bottom ('Narrator: he did not'), overlay it. " +
          "impact: transparent PNG with white outlined meme text, overlay it. " +
          "label: transparent PNG with a small white pill near the top ('me', 'my wallet'), overlay it.",
      ),
    aspect: z.enum(Object.keys(ASPECTS) as [keyof typeof ASPECTS, ...(keyof typeof ASPECTS)[]]).default("landscape"),
    color: z
      .enum(CARD_COLORS as [string, ...string[]])
      .default("sunny")
      .describe("Background scheme for time_skip cards."),
  }),
};

type Args<K extends keyof typeof schemas> = z.infer<(typeof schemas)[K]>;

export interface ToolDef {
  name: keyof typeof schemas;
  title: string;
  description: string;
  producesMedia?: "image" | "video" | "audio";
}

export const TOOLS: ToolDef[] = [
  {
    name: "find_funny_moments",
    title: "Find funny moments",
    description:
      "Reads a video's transcript and finds the lines where a relatable reaction clip would land as a joke " +
      "(overconfidence before a fail, a price reveal, an awkward beat, a plot twist, a time skip), paced so the edit is not overloaded. " +
      "Pass `segments` (start/end seconds + text, e.g. from transcribe) or plain `text`. " +
      "Returns moments in timeline order, each with insertAt (seconds: cut away there, then return to the speaker), the setup line, " +
      `the reaction type (one of: ${REACTION_LIST}), a search query, a matching sound effect, an optional text card, and with withClips ` +
      "3 ready clip candidates whose ids go to get_reaction_clip. It finds setups by phrasing; read the setups and drop any that are not actually funny in context.",
  },
  {
    name: "search_reaction_clips",
    title: "Search reaction clips",
    description:
      "Searches for short reaction/meme-style clips (facepalm, side-eye, mind blown, crowd cheering, crying, walking away...) " +
      "by free-text query and/or reaction type. Returns candidates with id, title, preview image URL, size, whether it has audio, " +
      "licence and attribution. Show previews to the user when they want to choose; pass the chosen id to get_reaction_clip to add it to the project.",
  },
  {
    name: "get_reaction_clip",
    title: "Get reaction clip",
    description:
      "Adds one reaction clip to the user's media library and returns its URL. Pass a clipId from search_reaction_clips/find_funny_moments, " +
      "or a query/reaction to take the best match. Typical use: a 1.5 to 3 second cut-away placed at a moment's insertAt, " +
      "with the speaker's audio ducked or paused. GIPHY clips are silent, so pair them with get_sound_effect. " +
      "The result carries the attribution to credit.",
    producesMedia: "video",
  },
  {
    name: "get_sound_effect",
    title: "Get sound effect",
    description:
      `Adds a comedy sound effect (WAV) to the user's media library and returns its URL. Choices: ${SFX_NAMES.join(", ")}. ` +
      "All are synthesised by this plugin, so they are free to use anywhere, monetised videos included. " +
      "Place it on an audio track starting at the cut-away (boom/record_scratch just before it).",
    producesMedia: "audio",
  },
  {
    name: "make_text_card",
    title: "Make meme text card",
    description:
      "Renders a meme-style text card as a PNG and adds it to the user's media library: a full-frame cartoon time-skip title card " +
      "('3 HOURS LATER'), or a transparent overlay (a narrator caption bar, top/bottom outlined meme text, or a small 'me' label). " +
      "Choose aspect to match the project (portrait for vertical video). Returns the image URL.",
    producesMedia: "image",
  },
];

export function toolList() {
  return TOOLS.map((t) => {
    const { $schema: _s, ...inputSchema } = z.toJSONSchema(schemas[t.name], { io: "input" }) as Record<string, unknown>;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      ...(t.producesMedia ? { _meta: { vidmoat: { producesMedia: t.producesMedia } } } : {}),
    };
  });
}

export interface CallContext {
  /** Public base URL of this server, for media it serves itself. */
  baseUrl: string;
}

export class ToolError extends Error {}

export async function callTool(name: string, rawArgs: unknown, ctx: CallContext): Promise<unknown> {
  const schema = schemas[name as keyof typeof schemas];
  if (!schema) throw new ToolError(`Unknown tool "${name}"`);
  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; "));
  }
  const args = parsed.data as any;
  switch (name) {
    case "find_funny_moments":
      return findFunnyMoments(args);
    case "search_reaction_clips":
      return searchReactionClips(args);
    case "get_reaction_clip":
      return getReactionClip(args);
    case "get_sound_effect":
      return getSoundEffect(args, ctx);
    case "make_text_card":
      return makeTextCard(args, ctx);
  }
}

async function findFunnyMoments(a: Args<"find_funny_moments">) {
  const segments = a.segments?.length ? a.segments : textToSegments(a.text!);
  const moments = findMoments(segments, { density: a.density, only: a.only, exclude: a.exclude, max: a.max });
  const errors = new Set<string>();
  const withClips = await Promise.all(
    moments.map(async (m) => {
      if (!a.withClips) return m;
      const res = await searchForReaction(m.reaction, { limit: 3, rating: a.rating, orientation: a.orientation });
      res.errors.forEach((e) => errors.add(e));
      return { ...m, query: res.query, clips: res.clips };
    }),
  );
  return {
    moments: withClips,
    timestamps: segments.some((s) => typeof s.end === "number" || typeof s.start === "number"),
    sources: enabledSources(),
    ...(errors.size ? { sourceErrors: [...errors] } : {}),
    next:
      moments.length === 0
        ? "No obvious setups by phrasing. Read the transcript yourself and call search_reaction_clips with a reaction or query for the beats you find funny."
        : "For each moment you keep: get_reaction_clip (clip id), get_sound_effect (sfx), or make_text_card (card); place the result at insertAt.",
  };
}

async function searchReactionClips(a: Args<"search_reaction_clips">) {
  const base = { limit: a.limit, rating: a.rating, orientation: a.orientation };
  const res = a.query
    ? { query: a.query, ...(await searchClips({ ...base, query: a.query, reaction: a.reaction }, a.sources as SourceName[] | undefined)) }
    : await searchForReaction(a.reaction!, base, a.sources as SourceName[] | undefined);
  return {
    query: res.query,
    clips: res.clips,
    sources: a.sources ?? enabledSources(),
    ...(res.errors.length ? { sourceErrors: res.errors } : {}),
  };
}

async function getReactionClip(a: Args<"get_reaction_clip">) {
  let id = a.clipId;
  if (!id) {
    const base = { limit: 1, rating: a.rating, orientation: a.orientation };
    const res = a.query
      ? await searchClips({ ...base, query: a.query, reaction: a.reaction })
      : await searchForReaction(a.reaction!, base);
    if (!res.clips[0]) {
      throw new ToolError(`No clip found${res.errors.length ? ` (${res.errors.join("; ")})` : ""}. Try another query.`);
    }
    id = res.clips[0].id;
  }
  const clip = await resolveClip(id);
  const { mediaUrl, ...meta } = clip;
  return { url: mediaUrl, ...meta };
}

function getSoundEffect(a: Args<"get_sound_effect">, ctx: CallContext) {
  const info = listSfx().find((s) => s.name === a.name)!;
  return {
    url: `${ctx.baseUrl}/media/sfx/${a.name}.wav`,
    ...info,
    license: "Synthesised by the Funny Clips plugin; free to use, no attribution needed",
  };
}

function makeTextCard(a: Args<"make_text_card">, ctx: CallContext) {
  const q = new URLSearchParams({ text: a.text, style: a.style, aspect: a.aspect, color: a.color });
  const [width, height] = ASPECTS[a.aspect];
  return {
    url: `${ctx.baseUrl}/media/card.png?${q}`,
    width,
    height,
    transparent: a.style !== "time_skip",
    use: a.style === "time_skip" ? "Place as its own clip, about 1.5s, with a whoosh." : "Overlay on the video track above the footage.",
  };
}
