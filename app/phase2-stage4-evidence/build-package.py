#!/usr/bin/env python3
"""
Phase 2 Stage 4 package builder:
  1. Side-by-side composites (floor-oc reference | Vokrew Phase 2),
     2880 x (46 label band + 813) — the Phase 1 composite geometry.
     For the hold and transcript shots, floor-oc has NO equivalent
     surface; the left side is its idle room, labeled as such.
  2. The session video, encoded from the successful take's screencast
     frames (frames.json points at the frames dir) to Kevin's phone
     spec EXACTLY: H.264 High, level 3.1, yuv420p, 24 fps, AAC-LC
     24 kHz mono (silent — the capture has no audio), video track
     timescale 12288, faststart. ffprobe output is saved alongside.
Run after stage4-capture.mjs (+ stage4-phone.mjs for the phone set,
which needs no compositing).
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
BAND = 46
BG = (10, 12, 16)
FG = (210, 220, 230)


def composite(left_path, right_path, left_label, right_label, out_name):
    left = Image.open(left_path).convert("RGB")
    right = Image.open(right_path).convert("RGB")
    h = max(left.height, right.height)
    canvas = Image.new("RGB", (left.width + right.width, h + BAND), BG)
    canvas.paste(left, (0, BAND))
    canvas.paste(right, (left.width, BAND))
    d = ImageDraw.Draw(canvas)
    d.text((14, 15), left_label, fill=FG)
    d.text((left.width + 14, 15), right_label, fill=FG)
    out = HERE / out_name
    canvas.save(out)
    print(f"{out_name}: {canvas.size[0]}x{canvas.size[1]}  ({out.stat().st_size} bytes)")


def main():
    oc_idle = HERE / "flooroc-idle.png"
    oc_focus = HERE / "flooroc-focus-agent.png"
    composite(oc_idle, HERE / "vokrew-idle.png",
              "floor-oc (reference) — idle room",
              "Vokrew Floor, Phase 2 — idle room, rig crew seated",
              "side-by-side-idle.png")
    composite(oc_focus, HERE / "vokrew-dossier.png",
              "floor-oc (reference) — focus view on an agent",
              "Vokrew Floor, Phase 2 — Judge's dossier after the run",
              "side-by-side-dossier.png")
    composite(oc_idle, HERE / "vokrew-hold-pending.png",
              "floor-oc (reference) — no holds surface exists",
              "Vokrew Floor, Phase 2 — hold pending: card + noticeboard + badge",
              "side-by-side-hold.png")
    composite(oc_idle, HERE / "vokrew-settled.png",
              "floor-oc (reference) — no conductor surface exists",
              "Vokrew Floor, Phase 2 — settled: verdict in the conductor transcript",
              "side-by-side-transcript.png")

    frames_meta = json.loads((HERE / "frames.json").read_text())
    frames_dir = Path(frames_meta["framesDir"])
    concat = HERE / "frames-concat.txt"
    frames = frames_meta["frames"]
    total = (frames[-1]["tsSec"] - frames[0]["tsSec"]) + 0.6
    video = HERE / "vokrew-conductor-session.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat),
        "-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000",
        "-vf", "scale=1152:720:force_original_aspect_ratio=decrease:out_range=tv,"
               "pad=1152:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=24,format=yuv420p",
        "-c:v", "libx264", "-profile:v", "high", "-level:v", "3.1",
        "-video_track_timescale", "12288",
        "-c:a", "aac", "-b:a", "32k",
        "-t", f"{total:.2f}",
        "-movflags", "+faststart",
        str(video),
    ]
    print("running:", " ".join(cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-3000:])
        sys.exit(1)
    print(f"video: {video} ({video.stat().st_size} bytes, ~{total:.1f}s of frames)")

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "default=noprint_wrappers=0", str(video)],
        capture_output=True, text=True)
    (HERE / "ffprobe-video.txt").write_text(probe.stdout)
    print(probe.stdout)


if __name__ == "__main__":
    main()
