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

- **The bundled pack (`assets/clips/`, 58 clips, 19 MB)** is served by this plugin from `/media/clips/`. It contains hand-picked reaction moments from **public-domain silent films** on Wikimedia Commons: Buster Keaton (Sherlock Jr., Cops, Neighbors), Harold Lloyd (Safety Last!, Never Weaken, I Do), Charlie Chaplin (The Bank, The Champion, The Rink), Laurel & Hardy (Big Business, Two Tars) and Nosferatu. Each clip was found on frame-by-frame contact sheets, trimmed to its 1.5–4 s punch moment, checked for stray shots, title cards and side bars, and tagged with the reactions it fits. Moments with racist caricature, children as the subject, or real distress were left out. Coverage is deepest for dramatic, side-eye, fail, nope and awkward. Money, time skip, laugh and confused have 3–4 clips each, and the text cards and sound effects fill those in. The clips are silent and black-and-white, so pair them with `get_sound_effect`. `assets/clips.json` lists the film and Commons page for every clip.
  - **Licence:** the films are public domain **in the US** (all published before 1930). Some countries count film copyright from the director's death, so some of these films, Chaplin's for example, are still protected in the EU and UK. Restored versions can also trigger YouTube Content ID claims, which can be disputed. Every clip's `license` field says this, so the agent can tell the user.
  - **Rebuilding:** `python3 scripts/cut.py` rebuilds the pack from `scripts/picks.json`. It downloads one transcode per film (Wikimedia throttles large originals) into `.clip-cache/`, honours `Retry-After`, removes side bars and writes `assets/clips.json`.
- **Your own library (`library.json`)** is listed ahead of the pack. Use it for clips you shot or own.
- **GIPHY** (`GIPHY_API_KEY`, optional) has the deepest supply of modern reaction clips. A lot of GIPHY content is cut from films, TV and creators' videos owned by someone else. The tool results label this and carry attribution, but checking GIPHY's API terms is your responsibility. Read them before going public.
- **Pexels** (`PEXELS_API_KEY`, optional) is free-licence stock video.
- **Sound effects** are synthesised in `src/sfx.ts`, so there is no recording to license. **Cards** use the Anton font (SIL OFL, `assets/fonts/OFL.txt`).

Clips ripped from TikTok, YouTube, films or TV are deliberately not included. They belong to their creators, and shipping them to users would expose those users to copyright claims.

## Layout

```
src/reactions.ts   16 reaction types, their trigger phrases, queries, SFX/card pairings; pacing logic
src/sources.ts     library + bundled pack / GIPHY / Pexels search and clip resolution
assets/clips/      the bundled public-domain reaction clips (mp4 + jpg thumbnail)
scripts/cut.py     cuts the pack from scripts/picks.json
src/sfx.ts         sound-effect synthesiser -> WAV
src/card.ts        SVG text cards -> PNG (resvg)
src/tools.ts       MCP tool schemas, descriptions and handlers
src/server.ts      HTTP server: /mcp (stateless Streamable HTTP), media routes, /health
```

## Limits worth knowing

- `find_funny_moments` matches phrasing. It does not understand humour. Its description tells the agent to drop setups that are not funny in context, and the agent can always search by reaction type for beats it finds itself.
- Every call finishes well inside Vidmoat's 20 s limit (external searches time out at 8 s), and responses stay far under 1 MB because media is returned as URLs.
