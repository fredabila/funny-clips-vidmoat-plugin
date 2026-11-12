# Funny Clips: a Vidmoat plugin

A plugin for cutting meme-style edits: the creator says "how hard can it be?", and the edit cuts to a facepalm with a sad trombone and then a "3 HOURS LATER" card. This plugin gives Vidmoat's agents what they need to make that edit:

| Tool | What it does | Media |
| --- | --- | --- |
| `find_funny_moments` | Reads a transcript and finds the setups (overconfidence, a fail, a price reveal, an awkward beat, a plot twist, a time skip...) and paces them. For each one it returns the timestamp, the reaction type, a matching sound effect and card, and 3 clip candidates. | none |
| `search_reaction_clips` | Searches reaction clips by query or reaction type across your own library, GIPHY and Pexels. Returns previews for the user to choose from. | none |
| `get_reaction_clip` | Adds a chosen clip (or the best match for a query) to the user's library. | video |
| `get_sound_effect` | Adds one of 10 comedy SFX: boom, sad trombone, record scratch, ding, whoosh, crickets, rimshot, airhorn, dun-dun-duuun, pop. | audio |
| `make_text_card` | Renders a time-skip title card, a narrator caption bar, top/bottom meme text, or a "me" label as a PNG (transparent except time-skip). | image |

Here's what a user can say to Otto: *"Make this funny: add reaction clips where they fit, heavy pacing, vertical."* Otto transcribes the video, calls `find_funny_moments`, fetches the clips, sound effects and cards, and places each one at `insertAt` as a short cut-away.

Example `find_funny_moments` output for one moment:

```json
{
  "insertAt": 9, "setup": "How hard can it be?", "reaction": "famous_last_words",
  "query": "famous last words", "sfx": "record_scratch",
  "card": { "text": "Narrator: it was not easy.", "style": "narrator" },
  "suggestedClipSeconds": 2.5,
  "clips": [{ "id": "giphy:3o7btPCcdNniyf0ArS", "title": "...", "previewUrl": "...", "hasAudio": false, "attribution": "... via GIPHY" }]
}
```

## Run it

```bash
npm install
```

```bash
cp .env.example .env   # add GIPHY_API_KEY / PEXELS_API_KEY if you have them
```

```bash
npm run dev            # http://localhost:3000/mcp
```

```bash
npm test
```

## Deploy

Vidmoat needs a public HTTPS address that answers on every call. Tunnels such as ngrok work only for a private plugin. Any Node host works (Render, Railway, Fly.io, a VPS). A Dockerfile is included:

```bash
docker build -t funny-clips . && docker run -p 3000:3000 --env-file .env funny-clips
```

Set `PUBLIC_BASE_URL` to the public URL. The sound effects and text cards are served from this server (`/media/sfx/*.wav`, `/media/card.png`), and Vidmoat downloads them from those URLs. These media routes must stay public. Only `/mcp` is gated by the secret.

## Submit it to Vidmoat

1. Open https://developer.vidmoat.com/developer/plugins and paste `https://<your-host>/mcp`.
2. Vidmoat reads the name, description and the 5 tools from the server. `producesMedia` is already declared on the three media tools, so there is nothing to tick.
3. Set a secret header in the form, for example `x-funny-clips-secret`, and set the same value as `PLUGIN_SECRET` on your server. Requests without it are rejected.
4. Start as `private` to try it with Otto, then switch to `public` for review.

## Clip sources and licensing

This matters most if you publish the plugin. Your users will put these clips in videos they monetise.

- **Your library (`library.json`)** is always on, and it is ranked first. Copy `library.example.json`, list clips you own or that are CC0, and tag each one with `reactions`. A small curated pack (20–50 clips covering the 16 reaction types) is the most reliable way to make the plugin both good and safe.
- **GIPHY** (`GIPHY_API_KEY`) has the deepest supply of reaction clips. The clips are silent MP4s. A lot of GIPHY content is cut from films and TV owned by someone else. The tool results label this and carry attribution, but a production key and GIPHY's API terms are your responsibility. Read them before going public.
- **Pexels** (`PEXELS_API_KEY`) is free-licence stock video. It is safe to use, but it is better for "money flying" or "crowd cheering" than for meme faces.
- **Sound effects** are synthesised in `src/sfx.ts`, so there is no recording to license. **Cards** use the Anton font (SIL OFL, `assets/fonts/OFL.txt`).

## Layout

```
src/reactions.ts   16 reaction types, their trigger phrases, queries, SFX/card pairings; pacing logic
src/sources.ts     library / GIPHY / Pexels search and clip resolution
src/sfx.ts         sound-effect synthesiser -> WAV
src/card.ts        SVG text cards -> PNG (resvg)
src/tools.ts       MCP tool schemas, descriptions and handlers
src/server.ts      HTTP server: /mcp (stateless Streamable HTTP), media routes, /health
```

## Limits worth knowing

- `find_funny_moments` matches phrasing. It does not understand humour. Its description tells the agent to drop setups that are not funny in context, and the agent can always search by reaction type for beats it finds itself.
- Every call finishes well inside Vidmoat's 20 s limit (external searches time out at 8 s), and responses stay far under 1 MB because media is returned as URLs.
