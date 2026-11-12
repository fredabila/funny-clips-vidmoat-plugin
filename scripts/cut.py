#!/usr/bin/env python3
"""Cut the curated reaction clips out of their public-domain sources.

Reads scripts/picks.json, and for each pick seeks into the source film on
Wikimedia Commons (no full download), cuts the punch moment, and writes
assets/clips/<id>.mp4 + <id>.jpg. Then writes assets/clips.json for the plugin.

    python3 -I scripts/cut.py            # cut everything missing
    python3 -I scripts/cut.py --force    # recut everything
"""
import hashlib, json, os, subprocess, sys, time, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "clips")
PICKS = os.path.join(ROOT, "scripts", "picks.json")
# Wikimedia refuses generic clients; identify the tool.
UA = "funny-clips-pack-builder/0.1 (public-domain clip curation; ffmpeg)"


CACHE = os.environ.get("CLIP_CACHE", os.path.join(ROOT, ".clip-cache"))
PREFERRED = ["720p.vp9.webm", "720p.webm", "1080p.vp9.webm", "480p.vp9.webm", "480p.webm", "360p.vp9.webm", "360p.mpeg4.mov", "360p.webm"]


def commons(**params):
    params["format"] = "json"
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    for i in range(8):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(15 * (i + 1))
    raise RuntimeError("Commons API still rate limited")


def local_source(p):
    """Download (once) a 720p transcode of the film: Wikimedia asks tools not to pull multi-GB originals."""
    os.makedirs(CACHE, exist_ok=True)
    title = "File:" + urllib.parse.unquote(p["filePage"].split("/wiki/File:", 1)[1]).replace("_", " ")
    path = os.path.join(CACHE, hashlib.sha1(title.encode()).hexdigest()[:16] + ".video")
    if os.path.exists(path):
        return path
    pages = commons(action="query", titles=title, prop="videoinfo", viprop="derivatives|url|size")["query"]["pages"]
    vi = next(iter(pages.values()))["videoinfo"][0]
    derivs = {d.get("transcodekey"): d["src"] for d in vi.get("derivatives", [])}
    src = next((derivs[k] for k in PREFERRED if k in derivs), None)
    if not src:
        # Wikimedia throttles large original files hard; only use transcodes.
        raise RuntimeError(f"No 360p+ transcode for {title}; pick another copy of the film")
    print("  downloading", title, "->", src.rsplit(".", 3)[-3:], flush=True)
    hdr = path + ".headers"
    for i in range(10):
        r = subprocess.run(["curl", "-sSL", "-A", UA, "-D", hdr, "-o", path + ".part", "-w", "%{http_code}", src],
                           capture_output=True, text=True)
        if r.stdout.strip() == "200":
            os.rename(path + ".part", path)
            os.remove(hdr)
            return path
        # Wikimedia answers 429 with Retry-After (often 600 s): wait exactly that long, never hammer.
        wait = 60
        for line in open(hdr, errors="ignore"):
            if line.lower().startswith("retry-after:"):
                wait = int(line.split(":", 1)[1].strip() or 60) + 10
        print(f"  HTTP {r.stdout.strip()}, waiting {wait}s", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"Could not download {src}")


def cut(p, force):
    mp4 = os.path.join(OUT, p["id"] + ".mp4")
    jpg = os.path.join(OUT, p["id"] + ".jpg")
    if os.path.exists(mp4) and os.path.exists(jpg) and not force:
        return
    start, end = p["start"], p["end"]
    # Fast seek to a little before, then accurate seek: works over HTTP range requests.
    pre = max(0.0, start - 5)
    vf = "scale='min(960,iw)':-2:flags=lanczos,format=yuv420p"
    if p.get("cropFrac"):
        # [x, y, w, h] as fractions of the frame: tighten on a face for a punchier reaction.
        x, y, w, h = p["cropFrac"]
        vf = f"crop=trunc(iw*{w}/2)*2:trunc(ih*{h}/2)*2:iw*{x}:ih*{y}," + vf
    if p.get("speed"):
        vf = f"setpts=PTS/{p['speed']}," + vf
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(pre), "-i", local_source(p),
         "-ss", str(start - pre), "-t", str(end - start), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", mp4],
        check=True)
    mid = (end - start) * float(p.get("thumbAt", 0.6))
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(mid), "-i", mp4, "-frames:v", "1",
         "-vf", "scale=480:-2", "-q:v", "4", jpg], check=True)


def license_for(p):
    import re
    years = re.findall(r"\b(18\d\d|19[0-2]\d)\b", p["film"] + " " + p["filePage"])
    year = years[0] if years else "before 1930"
    return (f"Public domain in the US (published {year}). Copyright can still apply in some other countries "
            "(EU/UK count from the director's death); restored versions of this film can trigger Content ID claims, which can be disputed.")


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    return d["streams"][0]["width"], d["streams"][0]["height"], float(d["format"]["duration"])


def main():
    force = "--force" in sys.argv
    picks = json.load(open(PICKS))
    os.makedirs(OUT, exist_ok=True)
    clips = []
    for p in picks:
        print("cutting", p["id"], flush=True)
        cut(p, force)
        w, h, dur = probe(os.path.join(OUT, p["id"] + ".mp4"))
        clips.append({
            "id": p["id"],
            "title": p["title"],
            "url": f"clips/{p['id']}.mp4",
            "previewUrl": f"clips/{p['id']}.jpg",
            "sourceUrl": p["filePage"],
            "tags": p["tags"],
            "reactions": p["reactions"],
            "durationSeconds": round(dur, 2),
            "width": w,
            "height": h,
            "hasAudio": False,
            "license": license_for(p),
            "attribution": p["film"],
            "why": p.get("why"),
        })
    keep = {c["id"] for c in clips}
    for f in os.listdir(OUT):
        if f.rsplit(".", 1)[0] not in keep:
            os.remove(os.path.join(OUT, f))
    json.dump({"clips": clips}, open(os.path.join(ROOT, "assets", "clips.json"), "w"), indent=2)
    print(len(clips), "clips")


if __name__ == "__main__":
    main()
