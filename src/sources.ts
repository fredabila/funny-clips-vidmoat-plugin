/**
 * Clip sources. Each one turns a search query into candidates and a clip id
 * into a direct MP4 URL that Vidmoat can download.
 *
 * - library: your own clips (clips you shot, bought or that are CC0), listed in
 *   a JSON catalog. Always on. Safest for monetised videos.
 * - giphy:   reaction GIFs as silent MP4s. Needs GIPHY_API_KEY.
 * - pexels:  free-licence stock video. Needs PEXELS_API_KEY.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getReaction, type ReactionId } from "./reactions.js";

export type SourceName = "library" | "giphy" | "pexels";

export interface Clip {
  /** "<source>:<id>", pass this to get_reaction_clip. */
  id: string;
  /** Reaction types this clip is curated for (library clips only). */
  reactions?: ReactionId[];
  /** The best window in the source, in seconds: set the clip's in/out to this. */
  trim?: { start: number; end: number } | null;
  source: SourceName;
  title: string;
  previewUrl: string | null;
  pageUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasAudio: boolean;
  license: string;
  attribution: string | null;
}

export interface ResolvedClip extends Clip {
  mediaUrl: string;
}

export interface SearchOptions {
  query: string;
  limit: number;
  rating: "g" | "pg" | "pg-13";
  orientation?: "landscape" | "portrait" | "square";
  reaction?: ReactionId;
}

const TIMEOUT_MS = 8000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- library

interface LibraryEntry {
  id: string;
  /** Best 1.5-4s window in the source. */
  inSeconds?: number;
  outSeconds?: number;
  sourceUrl?: string;
  title: string;
  url: string;
  previewUrl?: string;
  tags?: string[];
  reactions?: ReactionId[];
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  license?: string;
  attribution?: string;
}

let libraryCache: LibraryEntry[] | null = null;

/** The curated pack shipped with the plugin. */
const BUNDLED = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/clips.json");

function readCatalog(path: string): LibraryEntry[] {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")).clips ?? []) : [];
}

/** Your own clips (LIBRARY_PATH, default ./library.json) first, then the bundled pack. */
export function loadLibrary(): LibraryEntry[] {
  if (libraryCache) return libraryCache;
  const own = readCatalog(resolve(process.env.LIBRARY_PATH ?? "library.json"));
  const ids = new Set(own.map((e) => e.id));
  libraryCache = [...own, ...readCatalog(BUNDLED).filter((e) => !ids.has(e.id))];
  return libraryCache;
}

/** For tests. */
export function setLibrary(entries: LibraryEntry[] | null) {
  libraryCache = entries;
}

function libraryToClip(e: LibraryEntry): ResolvedClip {
  return {
    id: `library:${e.id}`,
    source: "library",
    reactions: e.reactions ?? [],
    trim: typeof e.inSeconds === "number" && typeof e.outSeconds === "number" ? { start: e.inSeconds, end: e.outSeconds } : null,
    title: e.title,
    previewUrl: e.previewUrl ?? null,
    pageUrl: e.sourceUrl ?? null,
    width: e.width ?? null,
    height: e.height ?? null,
    durationSeconds: e.durationSeconds ?? null,
    hasAudio: e.hasAudio ?? true,
    license: e.license ?? "Owned by the plugin operator",
    attribution: e.attribution ?? null,
    mediaUrl: e.url,
  };
}

function searchLibrary(o: SearchOptions): Clip[] {
  const words = o.query.toLowerCase().split(/\W+/).filter(Boolean);
  return loadLibrary()
    .map((e) => {
      const hay = [e.title, ...(e.tags ?? [])].join(" ").toLowerCase();
      let score = words.filter((wd) => hay.includes(wd)).length / Math.max(1, words.length);
      // The first listed reaction is what the clip was picked for; the rest are "also fits".
      if (o.reaction && e.reactions?.[0] === o.reaction) score += 1.5;
      else if (o.reaction && e.reactions?.includes(o.reaction)) score += 0.75;
      if (score > 0 && o.orientation && e.width && e.height) {
        const shape = e.width > e.height * 1.1 ? "landscape" : e.height > e.width * 1.1 ? "portrait" : "square";
        if (shape === o.orientation) score += 0.25;
      }
      // A little jitter breaks ties, so the same reaction does not always give every user the same clip.
      return { e, score, jitter: Math.random() };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.jitter - b.jitter)
    .slice(0, o.limit)
    .map((x) => strip(libraryToClip(x.e)));
}

// ---------------------------------------------------------------- giphy

function giphyToClip(g: any): ResolvedClip | null {
  const mp4 = g?.images?.original?.mp4 ?? g?.images?.original_mp4?.mp4;
  if (!mp4) return null;
  const user = g.user?.display_name || g.username;
  return {
    id: `giphy:${g.id}`,
    source: "giphy",
    title: g.title || "GIPHY clip",
    previewUrl: g.images?.fixed_width?.webp ?? g.images?.fixed_width?.url ?? null,
    pageUrl: g.url ?? null,
    width: num(g.images?.original?.width),
    height: num(g.images?.original?.height),
    durationSeconds: null,
    hasAudio: false,
    license: "GIPHY API terms; the underlying footage may belong to a third party",
    attribution: user ? `${user} via GIPHY` : "via GIPHY",
    mediaUrl: mp4,
  };
}

async function searchGiphy(o: SearchOptions): Promise<Clip[]> {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return [];
  const u = new URL("https://api.giphy.com/v1/gifs/search");
  u.search = new URLSearchParams({ api_key: key, q: o.query, limit: String(o.limit), rating: o.rating, lang: "en" }).toString();
  const body = await getJson(u.toString());
  return (body.data ?? []).map(giphyToClip).filter(Boolean).map(strip);
}

async function resolveGiphy(id: string): Promise<ResolvedClip> {
  const key = process.env.GIPHY_API_KEY;
  if (!key) throw new Error("GIPHY is not configured on this plugin");
  const body = await getJson(`https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}?api_key=${encodeURIComponent(key)}`);
  const clip = giphyToClip(body.data);
  if (!clip) throw new Error(`GIPHY clip ${id} has no MP4 rendition`);
  return clip;
}

// ---------------------------------------------------------------- pexels

function pexelsToClip(v: any): ResolvedClip | null {
  const files: any[] = (v.video_files ?? []).filter((f: any) => f.file_type === "video/mp4" && f.link);
  // Prefer HD around 1080p; avoid 4K files that blow past size limits.
  files.sort((a, b) => Math.abs((a.height ?? 0) - 1080) - Math.abs((b.height ?? 0) - 1080));
  const file = files[0];
  if (!file) return null;
  return {
    id: `pexels:${v.id}`,
    source: "pexels",
    title: (v.url?.split("/").filter(Boolean).pop() ?? "Pexels video").replace(/-\d+$/, "").replace(/-/g, " "),
    previewUrl: v.image ?? null,
    pageUrl: v.url ?? null,
    width: num(file.width),
    height: num(file.height),
    durationSeconds: num(v.duration),
    hasAudio: true,
    license: "Pexels License (free to use, attribution appreciated)",
    attribution: v.user?.name ? `${v.user.name} on Pexels` : "Pexels",
    mediaUrl: file.link,
  };
}

async function searchPexels(o: SearchOptions): Promise<Clip[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const u = new URL("https://api.pexels.com/videos/search");
  const params: Record<string, string> = { query: o.query, per_page: String(o.limit) };
  if (o.orientation) params.orientation = o.orientation;
  u.search = new URLSearchParams(params).toString();
  const body = await getJson(u.toString(), { Authorization: key });
  return (body.videos ?? []).map(pexelsToClip).filter(Boolean).map(strip);
}

async function resolvePexels(id: string): Promise<ResolvedClip> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Pexels is not configured on this plugin");
  const clip = pexelsToClip(await getJson(`https://api.pexels.com/videos/videos/${encodeURIComponent(id)}`, { Authorization: key }));
  if (!clip) throw new Error(`Pexels video ${id} has no MP4 file`);
  return clip;
}

// ---------------------------------------------------------------- public

export function enabledSources(): SourceName[] {
  const s: SourceName[] = ["library"];
  if (process.env.GIPHY_API_KEY) s.push("giphy");
  if (process.env.PEXELS_API_KEY) s.push("pexels");
  return s;
}

export async function searchClips(
  o: SearchOptions,
  sources: SourceName[] = enabledSources(),
): Promise<{ clips: Clip[]; errors: string[] }> {
  const run: Record<SourceName, (o: SearchOptions) => Promise<Clip[]> | Clip[]> = {
    library: searchLibrary,
    giphy: searchGiphy,
    pexels: searchPexels,
  };
  const active = sources.filter((s) => enabledSources().includes(s));
  const results = await Promise.allSettled(active.map(async (s) => run[s](o)));
  const errors: string[] = [];
  const lists: Clip[][] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    errors.push(`${active[i]}: ${(r.reason as Error).message}`);
    return [];
  });
  // Interleave so one source cannot crowd the others out; library first.
  const clips: Clip[] = [];
  for (let i = 0; clips.length < o.limit && lists.some((l) => l[i]); i++) {
    for (const l of lists) if (l[i] && clips.length < o.limit) clips.push(l[i]);
  }
  return { clips, errors };
}

/** Search using a reaction's queries, falling back to its alternates. */
export async function searchForReaction(
  reaction: ReactionId,
  o: Omit<SearchOptions, "query" | "reaction">,
  sources?: SourceName[],
) {
  const r = getReaction(reaction)!;
  const errors: string[] = [];
  for (const q of r.queries) {
    const res = await searchClips({ ...o, query: q, reaction }, sources);
    errors.push(...res.errors);
    if (res.clips.length) return { query: q, clips: res.clips, errors };
  }
  return { query: r.queries[0], clips: [] as Clip[], errors };
}

export async function resolveClip(id: string): Promise<ResolvedClip> {
  const [source, ...rest] = id.split(":");
  const ref = rest.join(":");
  if (!ref) throw new Error(`Clip id "${id}" should look like "giphy:abc123"`);
  switch (source) {
    case "library": {
      const e = loadLibrary().find((x) => x.id === ref);
      if (!e) throw new Error(`No library clip "${ref}"`);
      return libraryToClip(e);
    }
    case "giphy":
      return resolveGiphy(ref);
    case "pexels":
      return resolvePexels(ref);
    default:
      throw new Error(`Unknown clip source "${source}"`);
  }
}

function strip(c: ResolvedClip | Clip): Clip {
  const { mediaUrl: _drop, ...rest } = c as ResolvedClip;
  return rest;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
