import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { start } from "../src/server.js";
import { setLibrary } from "../src/sources.js";
import { findMoments } from "../src/reactions.js";

let base = "";
let server: Awaited<ReturnType<typeof start>>;
const realFetch = globalThis.fetch;

// A fake GIPHY so the tests run offline and without a key.
const gif = (id: string, title: string) => ({
  id,
  title,
  url: `https://giphy.com/gifs/${id}`,
  username: "someone",
  images: { original: { mp4: `https://media.giphy.com/media/${id}/giphy.mp4`, width: "480", height: "270" }, fixed_width: { webp: `https://media.giphy.com/media/${id}/200w.webp` } },
});

before(async () => {
  process.env.GIPHY_API_KEY = "test";
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = new URL(String(input));
    if (u.host === "api.giphy.com") {
      if (u.pathname.endsWith("/search")) {
        const q = u.searchParams.get("q")!;
        return Response.json({ data: [gif(`${q.replace(/\W/g, "")}1`, `${q} one`), gif(`${q.replace(/\W/g, "")}2`, `${q} two`)] });
      }
      const id = u.pathname.split("/").pop()!;
      return Response.json({ data: gif(id, "by id") });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  setLibrary([
    { id: "slowclap", title: "Slow clap", url: "https://cdn.example.com/slowclap.mp4", tags: ["clap", "celebration"], reactions: ["celebration"] },
  ]);
  server = await start(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

async function client() {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const r: any = await c.callTool({ name, arguments: args });
  assert.ok(!r.isError, r.content?.[0]?.text);
  return JSON.parse(r.content[0].text);
}

const TRANSCRIPT = [
  { start: 0, end: 4, text: "Today I'm building a bookshelf from scratch." },
  { start: 4, end: 9, text: "How hard can it be?" },
  { start: 9, end: 30, text: "So first you measure the boards and cut them to size." },
  { start: 30, end: 36, text: "And of course I forgot to buy screws." },
  { start: 36, end: 60, text: "Back from the store, the wood alone cost me $240." },
  { start: 60, end: 85, text: "This took me forever, honestly hours of sanding." },
  { start: 85, end: 100, text: "And it worked! We did it!" },
];

test("initialize reports a name and instructions; tools/list declares producesMedia", async () => {
  const c = await client();
  assert.equal(c.getServerVersion()?.title, "Funny Clips");
  assert.ok(c.getInstructions()?.includes("find_funny_moments"));
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["find_funny_moments", "get_reaction_clip", "get_sound_effect", "make_text_card", "search_reaction_clips"]);
  const media = Object.fromEntries(tools.map((t) => [t.name, (t._meta as any)?.vidmoat?.producesMedia]));
  assert.deepEqual(media, { find_funny_moments: undefined, search_reaction_clips: undefined, get_reaction_clip: "video", get_sound_effect: "audio", make_text_card: "image" });
  for (const t of tools) assert.ok(t.description!.length > 80 && t.description!.length <= 2000, t.name);
});

test("finds the setups in a transcript, in order, with clips", async () => {
  const c = await client();
  const r = await call(c, "find_funny_moments", { segments: TRANSCRIPT, density: "heavy" });
  const got = r.moments.map((m: any) => [m.insertAt, m.reaction]);
  assert.deepEqual(got, [
    [9, "famous_last_words"],
    [36, "fail"],
    [60, "money"],
    [85, "time_skip"],
    [100, "celebration"],
  ]);
  const celebration = r.moments.at(-1);
  assert.equal(celebration.clips[0].id, "library:slowclap", "library clips tagged for the reaction come first");
  assert.ok(r.moments[0].clips.some((x: any) => x.id.startsWith("giphy:")));
  assert.equal(r.moments[3].card.style, "time_skip");
});

test("density paces the edit", () => {
  const segs = Array.from({ length: 60 }, (_, i) => ({ start: i * 5, end: i * 5 + 5, text: i % 2 ? "It broke. Of course." : "This is insane!" }));
  const light = findMoments(segs, { density: "light" });
  const heavy = findMoments(segs, { density: "heavy" });
  assert.ok(light.length < heavy.length);
  for (let i = 1; i < light.length; i++) assert.ok(light[i].insertAt! - light[i - 1].insertAt! >= 40);
});

test("plain text works without timestamps", async () => {
  const c = await client();
  const r = await call(c, "find_funny_moments", { text: "I've got this. Narrator: he did not. Turns out the glue was water.", withClips: false });
  assert.ok(r.moments.length >= 1);
  assert.equal(r.timestamps, false);
  assert.equal(r.moments[0].insertAt, null);
});

test("search and fetch a clip", async () => {
  const c = await client();
  const s = await call(c, "search_reaction_clips", { query: "facepalm", limit: 2 });
  assert.equal(s.clips.length, 2);
  assert.equal(s.clips[0].mediaUrl, undefined, "search results do not leak media URLs");
  const clip = await call(c, "get_reaction_clip", { clipId: s.clips[0].id });
  assert.match(clip.url, /^https:\/\/media\.giphy\.com\/.+\.mp4$/);
  assert.equal(clip.hasAudio, false);
  const byReaction = await call(c, "get_reaction_clip", { reaction: "mind_blown" });
  assert.match(byReaction.url, /mindblown1/);
});

test("sound effects are served as real WAV files", async () => {
  const c = await client();
  const r = await call(c, "get_sound_effect", { name: "sad_trombone" });
  assert.equal(r.url, `${base}/media/sfx/sad_trombone.wav`);
  const res = await realFetch(r.url);
  assert.equal(res.headers.get("content-type"), "audio/wav");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.ok(buf.length > 44100);
});

test("text cards render to PNG", async () => {
  const c = await client();
  for (const style of ["time_skip", "narrator", "impact", "label"]) {
    const r = await call(c, "make_text_card", { text: style === "impact" ? "me at 2am | still debugging" : "3 hours later", style, aspect: "portrait" });
    const res = await realFetch(r.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.readUInt32BE(16), 1080);
    assert.equal(buf.readUInt32BE(20), 1920);
  }
});

test("bad arguments come back as tool errors, not crashes", async () => {
  const c = await client();
  const r: any = await c.callTool({ name: "get_reaction_clip", arguments: {} });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /clipId, query or reaction/);
});

test("PLUGIN_SECRET gates /mcp", async () => {
  process.env.PLUGIN_SECRET = "s3cret";
  try {
    const res = await realFetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    assert.equal(res.status, 401);
    const c = new Client({ name: "t", version: "0" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { "x-funny-clips-secret": "s3cret" } } }));
    assert.ok((await c.listTools()).tools.length);
  } finally {
    delete process.env.PLUGIN_SECRET;
  }
});
