// Merges curated picks (JSON arrays from the curation pass) into assets/clips.json.
// Usage: node scripts/build-pack.mjs picks1.json picks2.json ...
import { readFileSync, writeFileSync } from "node:fs";

const LICENSE = {
  pexels: "Pexels License: free for commercial use, no attribution required",
  pixabay: "Pixabay Content License: free for commercial use, no attribution required",
  wikimedia: "Wikimedia Commons (CC0 / public domain); see source page",
};
const VALID = new Set(["famous_last_words","fail","mind_blown","confused","awkward","side_eye","celebration","sad","money","time_skip","nope","hype","cringe","thinking","laugh","dramatic"]);

const byId = new Map();
for (const f of process.argv.slice(2)) {
  for (const p of JSON.parse(readFileSync(f, "utf8"))) {
    if (!p.downloadUrl || !VALID.has(p.reaction)) { console.warn("skip", p.id, p.reaction); continue; }
    const id = p.id.replace(/_video_/, "-").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const prev = byId.get(id);
    if (prev) {
      // Picked for two reactions: keep the first as primary, add the rest.
      for (const r of [p.reaction, ...(p.alsoFits ?? [])]) if (VALID.has(r) && !prev.reactions.includes(r)) prev.reactions.push(r);
      continue;
    }
    const inS = Math.max(0, +p.inSeconds), outS = Math.min(+p.outSeconds, p.durationSeconds || Infinity);
    if (!(outS > inS)) { console.warn("bad trim", id); continue; }
    byId.set(id, {
      id,
      title: p.title,
      url: p.downloadUrl,
      previewUrl: p.thumbnailUrl ?? null,
      sourceUrl: p.sourceUrl ?? null,
      tags: p.tags ?? [],
      reactions: [p.reaction, ...(p.alsoFits ?? []).filter((r) => VALID.has(r) && r !== p.reaction)],
      inSeconds: Math.round(inS * 10) / 10,
      outSeconds: Math.round(outS * 10) / 10,
      durationSeconds: p.durationSeconds ?? null,
      width: p.width ?? null,
      height: p.height ?? null,
      hasAudio: true,
      license: LICENSE[p.provider] ?? "See source page",
      attribution: p.photographer ? `${p.photographer} on ${p.provider[0].toUpperCase()}${p.provider.slice(1)}` : null,
      why: p.why ?? null,
    });
  }
}
const clips = [...byId.values()];
writeFileSync(new URL("../assets/clips.json", import.meta.url), JSON.stringify({ clips }, null, 2) + "\n");
const count = {};
for (const c of clips) count[c.reactions[0]] = (count[c.reactions[0]] ?? 0) + 1;
console.log(clips.length, "clips", count);
