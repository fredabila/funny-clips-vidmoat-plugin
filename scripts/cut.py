#!/usr/bin/env python3
"""Cut the curated reaction clips out of their public-domain sources.

Reads scripts/picks.json, and for each pick seeks into the source film on
Wikimedia Commons (no full download), cuts the punch moment, and writes
assets/clips/<id>.mp4 + <id>.jpg. Then writes assets/clips.json for the plugin.

    python3 -I scripts/cut.py            # cut everything missing
    python3 -I scripts/cut.py --force    # recut everything
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "clips")
PICKS = os.path.join(ROOT, "scripts", "picks.json")


def cut(p, force):
    mp4 = os.path.join(OUT, p["id"] + ".mp4")
    jpg = os.path.join(OUT, p["id"] + ".jpg")
    if os.path.exists(mp4) and os.path.exists(jpg) and not force:
        return
    start, end = p["start"], p["end"]
    # Fast seek to a little before, then accurate seek: works over HTTP range requests.
    pre = max(0.0, start - 5)
    vf = "scale='min(1280,iw)':-2:flags=lanczos,format=yuv420p"
    if p.get("cropFrac"):
        # [x, y, w, h] as fractions of the frame: tighten on a face for a punchier reaction.
        x, y, w, h = p["cropFrac"]
        vf = f"crop=trunc(iw*{w}/2)*2:trunc(ih*{h}/2)*2:iw*{x}:ih*{y}," + vf
    if p.get("speed"):
        vf = f"setpts=PTS/{p['speed']}," + vf
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(pre), "-i", p["sourceUrl"],
         "-ss", str(start - pre), "-t", str(end - start), "-an", "-vf", vf,
         "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-movflags", "+faststart", mp4],
        check=True)
    mid = (end - start) * float(p.get("thumbAt", 0.6))
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(mid), "-i", mp4, "-frames:v", "1",
         "-vf", "scale=480:-2", "-q:v", "4", jpg], check=True)


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
            "license": p["license"],
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
