/**
 * Meme-style text cards rendered to PNG: time-skip title cards, narrator
 * captions, top/bottom impact text and small labels. Everything except the
 * time-skip card has a transparent background so it can sit on top of video.
 */
import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const CARD_STYLES = ["time_skip", "narrator", "impact", "label"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];
export const ASPECTS = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] } as const;
export type Aspect = keyof typeof ASPECTS;

const FONT = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/fonts/Anton-Regular.ttf");
const FAMILY = "Anton";
/** Anton is condensed: average glyph advance is roughly this fraction of the size. */
const CHAR_W = 0.5;

/** Colour schemes for the time-skip card, picked by the `color` option. */
const SCHEMES: Record<string, [string, string, string]> = {
  sunny: ["#ffd23f", "#ff8c42", "#3b1f0b"],
  ocean: ["#4cc9f0", "#4361ee", "#0b1026"],
  bubblegum: ["#ff8fab", "#c77dff", "#2b0f2e"],
  night: ["#1b263b", "#0d1b2a", "#e0e1dd"],
  lime: ["#c5f277", "#38b000", "#0f2a05"],
};
export const CARD_COLORS = Object.keys(SCHEMES);

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Greedy word wrap at a given font size; returns lines. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length * size * CHAR_W > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Largest size (up to `max`) at which the text fits in the box. */
function fit(text: string, maxW: number, maxH: number, max: number, lineHeight = 1.15) {
  for (let size = max; size >= 24; size -= 4) {
    const lines = wrap(text, size, maxW);
    const widest = Math.max(...lines.map((l) => l.length * size * CHAR_W));
    if (widest <= maxW && lines.length * size * lineHeight <= maxH) return { size, lines };
  }
  return { size: 24, lines: wrap(text, 24, maxW) };
}

function textBlock(
  lines: string[],
  size: number,
  cx: number,
  top: number,
  { fill, stroke, strokeW }: { fill: string; stroke?: string; strokeW?: number },
  lineHeight = 1.15,
) {
  return lines
    .map((l, i) => {
      const y = top + size * (0.88 + i * lineHeight);
      const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round" paint-order="stroke"` : "";
      return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FAMILY}" font-size="${size}" fill="${fill}"${s}>${esc(l)}</text>`;
    })
    .join("");
}

export interface CardOptions {
  text: string;
  style: CardStyle;
  aspect?: Aspect;
  color?: string;
}

export function cardSvg({ text, style, aspect = "landscape", color = "sunny" }: CardOptions): string {
  const [W, H] = ASPECTS[aspect];
  const pad = Math.round(Math.min(W, H) * 0.07);
  let body = "";
  let defs = "";

  if (style === "time_skip") {
    const [a, b, ink] = SCHEMES[color] ?? SCHEMES.sunny;
    const { size, lines } = fit(text.toUpperCase(), W - pad * 2, H - pad * 2, Math.round(H * 0.22));
    const blockH = lines.length * size * 1.15;
    const top = (H - blockH) / 2;
    defs = `<radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
    // Sunburst rays behind the text for a cartoon title-card feel.
    const rays = Array.from({ length: 18 }, (_, i) => {
      const a0 = (i / 18) * Math.PI * 2;
      const a1 = a0 + Math.PI / 18;
      const R = Math.hypot(W, H);
      return `<path d="M${W / 2},${H / 2} L${W / 2 + R * Math.cos(a0)},${H / 2 + R * Math.sin(a0)} L${W / 2 + R * Math.cos(a1)},${H / 2 + R * Math.sin(a1)} Z" fill="#ffffff" opacity="0.10"/>`;
    }).join("");
    body =
      `<rect width="${W}" height="${H}" fill="url(#bg)"/>${rays}` +
      textBlock(lines, size, W / 2 + size * 0.06, top + size * 0.06, { fill: ink }) +
      textBlock(lines, size, W / 2, top, { fill: "#ffffff", stroke: ink, strokeW: size * 0.09 });
  } else if (style === "narrator") {
    const boxW = W - pad * 2;
    const { size, lines } = fit(text, boxW - pad, H * 0.22, Math.round(H * 0.06), 1.2);
    const boxH = lines.length * size * 1.2 + size * 0.8;
    const top = H - pad - boxH;
    body =
      `<rect x="${pad}" y="${top}" width="${boxW}" height="${boxH}" rx="${size * 0.3}" fill="#000000" opacity="0.78"/>` +
      textBlock(lines, size, W / 2, top + size * 0.35, { fill: "#ffffff" }, 1.2);
  } else if (style === "impact") {
    // "top text | bottom text", or just bottom text.
    const [topText, bottomText] = text.includes("|") ? text.split("|").map((s) => s.trim()) : ["", text];
    const max = Math.round(Math.min(W, H) * 0.12);
    const ink = { fill: "#ffffff", stroke: "#000000", strokeW: max * 0.12 };
    if (topText) {
      const t = fit(topText.toUpperCase(), W - pad * 2, H * 0.3, max);
      body += textBlock(t.lines, t.size, W / 2, pad * 0.6, { ...ink, strokeW: t.size * 0.12 });
    }
    if (bottomText) {
      const t = fit(bottomText.toUpperCase(), W - pad * 2, H * 0.3, max);
      const h = t.lines.length * t.size * 1.15;
      body += textBlock(t.lines, t.size, W / 2, H - pad * 0.6 - h, { ...ink, strokeW: t.size * 0.12 });
    }
  } else {
    // label: a pill near the top third, for "me" / "my wallet" style labels.
    const size = Math.round(Math.min(W, H) * 0.07);
    const lines = wrap(text, size, W * 0.6);
    const w = Math.max(...lines.map((l) => l.length * size * CHAR_W)) + size * 1.2;
    const h = lines.length * size * 1.15 + size * 0.5;
    const top = H * 0.18;
    body =
      `<rect x="${(W - w) / 2}" y="${top}" width="${w}" height="${h}" rx="${h / 2 > size ? size * 0.6 : h / 2}" fill="#ffffff" stroke="#000000" stroke-width="${size * 0.08}"/>` +
      textBlock(lines, size, W / 2, top + size * 0.2, { fill: "#000000" });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
}

export function renderCard(o: CardOptions): Buffer {
  const resvg = new Resvg(cardSvg(o), {
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: FAMILY },
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}
