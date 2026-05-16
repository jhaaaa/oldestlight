"""
OLDEST LIGHT — Patch grid.json with temperature stats

Reads each cell's CMB temperatures from the FITS file and adds
temp_min, temp_max, temp_mean to every entry in grid.json.

Much faster than re-running precompute_grid.py — skips all word-finding.
Saves after every 50 cells so interruption loses little.

Usage:
  python3 patch_grid_temps.py
"""

import json
import time
from pathlib import Path

from cmb_codec import download_map, load_map, read_cell, CELL_RADIUS_DEG

OUTPUT     = Path("grid.json")
MAX_PIXELS = 2000


def main():
    print()
    print("  ══════════════════════════════════════════════════════════════")
    print("  OLDEST LIGHT — PATCH GRID TEMPERATURES")
    print("  ══════════════════════════════════════════════════════════════")
    print()

    download_map()
    print()
    T, nside = load_map()
    print()

    with open(OUTPUT) as f:
        grid = json.load(f)

    print(f"  Patching {len(grid):,} cells ...")
    print()

    t0 = time.time()

    for i, cell in enumerate(grid):
        if "temp_min" in cell:
            continue  # already patched

        vals = read_cell(T, nside, cell["glon"], cell["glat"], CELL_RADIUS_DEG)
        if len(vals) > MAX_PIXELS:
            vals = vals[:MAX_PIXELS]

        if vals:
            cell["temp_min"]  = round(min(vals), 1)
            cell["temp_max"]  = round(max(vals), 1)
            cell["temp_mean"] = round(sum(vals) / len(vals), 1)
        else:
            cell["temp_min"]  = None
            cell["temp_max"]  = None
            cell["temp_mean"] = None

        if (i + 1) % 50 == 0 or (i + 1) == len(grid):
            elapsed = time.time() - t0
            print(f"  {i + 1:>4}/{len(grid)}  ({elapsed:.0f}s)")
            with open(OUTPUT, "w") as f:
                json.dump(grid, f, indent=2)

    print()
    print(f"  Done. {OUTPUT} updated.")
    print()


if __name__ == "__main__":
    main()
