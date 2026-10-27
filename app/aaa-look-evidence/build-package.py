#!/usr/bin/env python3
"""
AAA LOOK PASS package builder (KC, 2026-10-27):
  1. Before/after composites (Stage 4 base | kc/aaa-look-pass), same
     geometry as the Phase 2 Stage 4 package (46px label band).
     "Before" frames are the Stage 4 captures of the exact base
     commit d93e81d, copied into this folder (before-*.png).
  2. The conductor-session video, encoded from the AAA capture's
     screencast frames to Kevin's phone spec EXACTLY (same recipe
     as Stage 4): H.264 High, level 3.1, yuv420p, 24 fps, AAC-LC
     24 kHz mono (silent), video track timescale 12288, faststart.
  3. ffprobe dump alongside the video.
  4. Stage-region luminance stats (mean / stddev) for before vs
     after idle — the flat-vs-lit contrast story in numbers.
Run after aaa-capture.mjs (+ aaa-phone.mjs for the phone set).
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat

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


def stage_stats(path):
    """Luminance mean/stddev over the stage (room) region only —
    right-hand portion of the frame, below the shell header."""
    im = Image.open(path).convert("L")
    w, h = im.size
    region = im.crop((int(w * 0.19), int(h * 0.23), w, h))
    st = ImageStat.Stat(region)
    return {"mean": round(st.mean[0], 2), "stddev": round(st.stddev[0], 2)}


def main():
    composite(HERE / "before-idle.png", HERE / "after-idle.png",
              "BEFORE — Phase 2 Stage 4 (base d93e81d), idle room",
              "AFTER — AAA look pass (kc/aaa-look-pass), idle room",
              "side-by-side-idle.png")
    composite(HERE / "before-settled.png", HERE / "after-settled.png",
              "BEFORE — settled run, raw markdown in the card",
              "AFTER — settled run, markdown rendered (G-3 fixed)",
              "side-by-side-settled.png")
    composite(HERE / "before-midrun.png", HERE / "after-midrun.png",
              "BEFORE — mid-run, reviewer walking",
              "AFTER — mid-run, reviewer at the doorway, strip docked",
              "side-by-side-midrun.png")

    stats = {
        "before-idle": stage_stats(HERE / "before-idle.png"),
        "after-idle": stage_stats(HERE / "after-idle.png"),
        "note": "Stage-region luminance: the AFTER frame's lower mean is the "
                "ambient veil; its higher stddev is the light pools — flat "
                "even light before, contrast and pools after.",
    }
    (HERE / "luminance-stats.json").write_text(json.dumps(stats, indent=2))
    print("luminance:", json.dumps(stats))

    frames_meta = json.loads((HERE / "frames.json").read_text())
    frames_dir = Path(frames_meta["framesDir"])
    concat = HERE / "frames-concat.txt"
    frames = frames_meta["frames"]
    total = (frames[-1]["tsSec"] - frames[0]["tsSec"]) + 0.6
    video = HERE / "aaa-conductor-session.mp4"
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
