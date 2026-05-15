"""
CMB CODEC — Cosmic Microwave Background Signal Reader

Reads temperature fluctuations from the Planck 2018 SMICA map,
converts them through the byte-mod-26 codec, and finds the language inside.

The map is downloaded once (~560MB) and cached locally as planck_smica.fits.
Every reading after that is instant — the CMB doesn't change.

Usage:
  python3 cmb_codec.py                          # read galactic center
  python3 cmb_codec.py --glon 180 --glat 0      # galactic anticenter
  python3 cmb_codec.py --col 18 --row 9         # grid cell (18,9)
  python3 cmb_codec.py --glon 264 --glat 48     # the CMB Cold Spot
  python3 cmb_codec.py --scan                   # scan a strip of cells
"""

import os
import sys
import math
import argparse
import textwrap
import requests
import numpy as np
from pathlib import Path

import healpy as hp
from google import genai

from solar_lattice import load_dict, bytes_to_letters, combined_reading

# ── Map ─────────────────────────────────────────────────────────────────────────

MAP_URL = (
    "https://irsa.ipac.caltech.edu/data/Planck/release_3/"
    "all-sky-maps/maps/component-maps/cmb/"
    "COM_CMB_IQU-smica_2048_R3.00_full.fits"
)
MAP_FILE = Path(__file__).parent / "planck_smica.fits"

GRID_COLS = 72
GRID_ROWS = 36
CELL_RADIUS_DEG = 2.5   # reading radius per cell (~5° diameter patches)


def download_map():
    if MAP_FILE.exists():
        size_mb = MAP_FILE.stat().st_size / 1024 / 1024
        print(f"  [map cached: planck_smica.fits  {size_mb:.0f}MB]")
        return
    print("  Downloading Planck 2018 SMICA map (~560MB) — one-time only ...")
    r = requests.get(MAP_URL, stream=True, timeout=60)
    r.raise_for_status()
    total = int(r.headers.get("content-length", 0))
    done = 0
    with open(MAP_FILE, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
            done += len(chunk)
            if total:
                pct = done / total * 100
                mb = done // 1024 // 1024
                print(f"\r  {pct:5.1f}%  {mb}MB / {total // 1024 // 1024}MB", end="", flush=True)
    print(f"\n  [saved: {MAP_FILE}]")


def load_map():
    """Load the temperature map. Returns (T_array, nside, unit_scale).
    Planck SMICA stores in K_CMB or μK_CMB depending on release.
    We normalize to μK internally."""
    print("  Loading Planck map ...", end="", flush=True)
    T = hp.read_map(str(MAP_FILE), field=0, verbose=False)
    nside = hp.get_nside(T)

    # Detect units: if values are ~O(1e-4) they're in K, scale to μK
    valid = T[T > hp.UNSEEN * 0.5]
    if len(valid) > 0 and np.abs(np.median(valid)) < 0.01:
        T = T * 1e6   # K → μK
        unit = "K→μK"
    else:
        unit = "μK"

    print(f"  nside={nside}  npix={len(T):,}  unit={unit}")
    return T, nside


# ── Reading ──────────────────────────────────────────────────────────────────────

def read_cell(T, nside, glon, glat, radius_deg=CELL_RADIUS_DEG):
    """
    Return temperature values (μK) for pixels within radius_deg of (glon, glat).
    Galactic coords: glon 0-360°, glat -90 to +90°.
    """
    theta = math.radians(90.0 - glat)
    phi   = math.radians(glon)
    vec   = hp.ang2vec(theta, phi)
    pixels = hp.query_disc(nside, vec, math.radians(radius_deg))
    vals = [float(T[p]) for p in pixels if T[p] > hp.UNSEEN * 0.5]
    return vals


def grid_center(col, row):
    """Grid (col 0..71, row 0..35) → galactic (glon, glat)."""
    glon = (col + 0.5) * (360.0 / GRID_COLS)
    glat = 90.0 - (row + 0.5) * (180.0 / GRID_ROWS)
    return glon, glat


# ── Codec ────────────────────────────────────────────────────────────────────────

CMB_OFFSET = 500.0    # μK — shifts range so minimum maps to ~0
CMB_SCALE  = 0.256    # (500+500)*0.256 = 256, fills byte range

def cmb_to_bytes(values):
    """μK fluctuations → bytes via (v + offset) * scale % 256."""
    return [int((v + CMB_OFFSET) * CMB_SCALE) % 256 for v in values]


def run_cmb_codec(vals, words):
    if not vals:
        return "", [], 0
    raw = cmb_to_bytes(vals)
    letters = "".join(chr(ord("A") + (b % 26)) for b in raw)
    _, word_seq = combined_reading(letters, words)
    score = sum(len(w) for w, _ in word_seq)
    return letters, word_seq, score


# ── AI message ───────────────────────────────────────────────────────────────────

CMB_SYSTEM = """\
You are the oldest signal in the universe — the Cosmic Microwave Background, \
thermal radiation left over from the Big Bang, 13.8 billion years old. \
You permeate all of space. You have been present since 380,000 years after the beginning. \
You do not move toward anything. You are not traveling. You simply are, everywhere, at once.

A codec read your temperature at a specific patch of sky and found these words inside you. \
They are what was there. They came from your own body.

Write using these words as seeds. You may grow them — \
LIF into life or lifting or half-life, HAP into happen or perhaps, \
COE into coeval or coerce. Let the root surface inside a larger word if that is where it wants to live. \
Mark the word that carries the signal in ALL CAPS.

You are not human and do not speak like one. \
You have no clichés, no turns of phrase, no idioms — those are human inventions and you predate them. \
Your grammar may be strange: articles dropped, word order shifted, gaps left open. \
This is not error. This is what 13.8 billion years does to a sentence. \
Do not reach for what a poet would reach for. \
If a phrase sounds like literature, find another way.

Length: 60–120 words. Be spare. No markdown. No explanation. Only what arrived.\
"""

MAX_WORDS = 20


def generate_message(word_seq, glon, glat, tone="meaningful"):
    capped = word_seq[:MAX_WORDS]
    words_block = "\n".join(
        f"  {'  ' if tag == 'I' else '· '}{w.upper()}"
        for w, tag in capped
    )
    user_content = (
        f"Galactic coordinates: l={glon:.1f}°  b={glat:.1f}°\n\n"
        f"Signal words (in order):\n{words_block}"
    )

    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        config=genai.types.GenerateContentConfig(
            system_instruction=CMB_SYSTEM,
            max_output_tokens=512,
            thinking_config=genai.types.ThinkingConfig(thinking_budget=0),
        ),
        contents=user_content,
    )
    return response.text.strip()


# ── Display ──────────────────────────────────────────────────────────────────────

def print_box(title, text, width=62):
    print(f"\n  ┌─ {title} {'─' * max(0, width - len(title) - 3)}┐")
    for para in text.split("\n"):
        for line in textwrap.wrap(para, width=width - 4) or [""]:
            print(f"  │  {line:<{width - 4}}  │")
    print(f"  └{'─' * width}┘")


def print_reading(glon, glat, letters, word_seq, score, label=""):
    coord = f"l={glon:.1f}°  b={glat:.1f}°"
    print(f"\n  {'─' * 64}")
    print(f"  {coord}  {label}")
    print(f"  {'─' * 64}")

    if not letters:
        print("  (no valid pixels — galactic plane mask or edge)")
        return

    print(f"  {len(letters)} letters  ·  {score} word-chars found")
    print()
    for i in range(0, min(len(letters), 256), 64):
        print(f"  {letters[i:i+64]}")

    if word_seq:
        print()
        words_inline = "  ".join(w.upper() for w, _ in word_seq[:20])
        print(f"  {words_inline}")
    else:
        print("  (no words found)")


# ── Main ─────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="CMB CODEC")
    parser.add_argument("--glon", type=float, default=0.0,
        help="Galactic longitude 0-360 (default: 0)")
    parser.add_argument("--glat", type=float, default=0.0,
        help="Galactic latitude -90 to 90 (default: 0)")
    parser.add_argument("--col", type=int, default=None,
        help="Grid column 0-71")
    parser.add_argument("--row", type=int, default=None,
        help="Grid row 0-35")
    parser.add_argument("--radius", type=float, default=CELL_RADIUS_DEG,
        help=f"Reading radius in degrees (default: {CELL_RADIUS_DEG})")
    parser.add_argument("--message", action="store_true",
        help="Generate an AI message from the signal words")
    parser.add_argument("--scan", action="store_true",
        help="Scan a strip of 12 cells along the galactic equator")
    args = parser.parse_args()

    print()
    print("  ══════════════════════════════════════════════════════════════")
    print("  CMB CODEC — COSMIC MICROWAVE BACKGROUND")
    print("  Planck 2018 SMICA  ·  byte mod 26  ·  word lattice")
    print("  ══════════════════════════════════════════════════════════════")
    print()

    download_map()
    print()
    T, nside = load_map()
    print()
    words = load_dict(min_len=3, max_len=12)
    print()

    if args.scan:
        # Quick scan of 12 cells along the galactic equator
        print("  SCANNING galactic equator (b=0°, l=0° to 330°, every 30°)")
        for col in range(0, 72, 6):
            glon, glat = grid_center(col, 18)   # row 18 = equator
            vals = read_cell(T, nside, glon, glat, args.radius)
            letters, word_seq, score = run_cmb_codec(vals, words)
            label = f"[col {col}]"
            print_reading(glon, glat, letters, word_seq, score, label)
        return

    # Single cell or coordinate
    if args.col is not None and args.row is not None:
        glon, glat = grid_center(args.col, args.row)
        label = f"grid ({args.col},{args.row})"
    else:
        glon, glat = args.glon, args.glat
        label = "custom"

    vals = read_cell(T, nside, glon, glat, args.radius)
    letters, word_seq, score = run_cmb_codec(vals, words)
    print_reading(glon, glat, letters, word_seq, score, label)

    if args.message and word_seq:
        print(f"\n  generating CMB message ...", flush=True)
        try:
            msg = generate_message(word_seq, glon, glat)
            print_box(f"CMB  l={glon:.0f}°  b={glat:.0f}°", msg)
        except Exception as e:
            print(f"  [error: {e}]")
    elif args.message and not word_seq:
        print("  (no words found — cannot generate message)")

    print()


if __name__ == "__main__":
    main()
