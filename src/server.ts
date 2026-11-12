/**
 * HTTP entry point.
 *
 *   POST /mcp                 MCP over Streamable HTTP (stateless, JSON responses)
 *   GET  /media/sfx/<n>.wav   synthesised sound effects
 *   GET  /media/card.png?...  rendered text cards
 *   GET  /health
 *
 * The media routes are public on purpose: Vidmoat downloads the URLs our tools
 * return and copies them into the user's library.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool, toolList, ToolError } from "./tools.js";
import { renderSfx } from "./sfx.js";
import { ASPECTS, CARD_COLORS, CARD_STYLES, renderCard, type Aspect, type CardStyle } from "./card.js";
import { enabledSources } from "./sources.js";

const VERSION = "0.1.0";

const INSTRUCTIONS =
  "Funny Clips turns a talking video into a meme edit: it finds the lines in a transcript where a relatable reaction clip " +
  "lands as a joke, finds the clips (a bundled pack of public-domain silent-comedy reactions, your own library, optional GIPHY and Pexels), and makes the sound effects and " +
  "text cards that go with them. Typical flow: transcribe the video, call find_funny_moments with the segments, then for each " +
  "moment you keep call get_reaction_clip / get_sound_effect / make_text_card and place the result at insertAt as a short cut-away.";

function mcpServer(baseUrl: string) {
  const server = new Server(
    { name: "funny-clips", title: "Funny Clips", version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await callTool(req.params.name, req.params.arguments, { baseUrl });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      const msg = err instanceof ToolError ? err.message : `Failed: ${(err as Error).message}`;
      if (!(err instanceof ToolError)) console.error(`[${req.params.name}]`, err);
      return { content: [{ type: "text", text: msg }], isError: true };
    }
  });
  return server;
}

function baseUrlFor(req: IncomingMessage) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? "http";
  const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host;
  return `${proto}://${host}`;
}

/** Optional shared secret so only Vidmoat (configured with the same header) can call /mcp. */
function authorised(req: IncomingMessage) {
  const secret = process.env.PLUGIN_SECRET;
  if (!secret) return true;
  const header = (process.env.PLUGIN_SECRET_HEADER ?? "x-funny-clips-secret").toLowerCase();
  const got = Buffer.from(String(req.headers[header] ?? ""));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function readJson(req: IncomingMessage, limit = 2_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = "application/json", extra: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), ...extra });
  res.end(body);
}

const CLIPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/clips");
const IMMUTABLE = { "cache-control": "public, max-age=31536000, immutable" };
const cardCache = new Map<string, Buffer>();

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");

  if (url.pathname === "/mcp") {
    if (req.method !== "POST") {
      // Stateless server: no SSE stream to resume and no session to delete.
      return send(res, 405, JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }), "application/json", { allow: "POST" });
    }
    if (!authorised(req)) return send(res, 401, JSON.stringify({ error: "unauthorised" }));
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
    }
    const server = mcpServer(baseUrlFor(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, '{"error":"method not allowed"}');

  const clip = url.pathname.match(/^\/media\/clips\/([a-z0-9-]+)\.(mp4|jpg)$/);
  if (clip) {
    try {
      const file = await readFile(resolve(CLIPS_DIR, `${clip[1]}.${clip[2]}`));
      return send(res, 200, file, clip[2] === "mp4" ? "video/mp4" : "image/jpeg", IMMUTABLE);
    } catch {
      return send(res, 404, '{"error":"unknown clip"}');
    }
  }

  const sfx = url.pathname.match(/^\/media\/sfx\/([a-z_]+)\.wav$/);
  if (sfx) {
    const wav = renderSfx(sfx[1]);
    return wav ? send(res, 200, wav, "audio/wav", IMMUTABLE) : send(res, 404, '{"error":"unknown sound effect"}');
  }

  if (url.pathname === "/media/card.png") {
    const text = url.searchParams.get("text") ?? "";
    const style = url.searchParams.get("style") ?? "time_skip";
    const aspect = url.searchParams.get("aspect") ?? "landscape";
    const color = url.searchParams.get("color") ?? "sunny";
    if (!text || text.length > 200 || !CARD_STYLES.includes(style as CardStyle) || !(aspect in ASPECTS) || !CARD_COLORS.includes(color)) {
      return send(res, 400, '{"error":"bad card parameters"}');
    }
    const key = url.search;
    let png = cardCache.get(key);
    if (!png) {
      png = renderCard({ text, style: style as CardStyle, aspect: aspect as Aspect, color });
      if (cardCache.size >= 200) cardCache.delete(cardCache.keys().next().value!);
      cardCache.set(key, png);
    }
    return send(res, 200, png, "image/png", IMMUTABLE);
  }

  if (url.pathname === "/health" || url.pathname === "/") {
    return send(res, 200, JSON.stringify({ ok: true, name: "funny-clips", version: VERSION, sources: enabledSources(), mcp: "/mcp" }));
  }

  send(res, 404, '{"error":"not found"}');
}

export function start(port = Number(process.env.PORT ?? 3000)) {
  const srv = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, '{"error":"internal error"}');
      else res.end();
    });
  });
  return new Promise<typeof srv>((ok) => srv.listen(port, () => ok(srv)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().then((s) => {
    const a = s.address();
    console.log(`funny-clips listening on :${typeof a === "object" && a ? a.port : a}  sources: ${enabledSources().join(", ")}`);
  });
}
