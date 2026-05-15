"""
OLDEST LIGHT — Grid Pre-computation

Runs all 2,592 grid cells (72 × 36) through the CMB codec and stores
the results in grid.json. No AI calls — just the codec. Free to run.

This is step 1. Step 2 (generate_messages.py) adds AI transmissions.

Usage:
  python3 precompute_grid.py

Resumes automatically if interrupted — already-completed cells are skipped.
"""

import json
import time
from pathlib import Path

from cmb_codec import (
    download_map, load_map, read_cell, run_cmb_codec,
    grid_center, GRID_COLS, GRID_ROWS, CELL_RADIUS_DEG,
)
from solar_lattice import load_dict

OUTPUT      = Path("grid.json")
MAX_PIXELS  = 2000   # cap per cell — enough for a rich letter stream, keeps it fast
LETTERS_CAP = 500    # how many letters to store in JSON for display


# Known notable locations — shown on the website
NOTABLE = {
    (36, 18): "Galactic center — heavily masked by Milky Way dust",
    (0,  18): "Galactic anticenter — toward Auriga, cleaner signal",
    (52, 13): "CMB Cold Spot — largest anomaly in the CMB, unexplained",
    (0,   0): "North galactic pole — cleanest CMB signal",
    (0,  35): "South galactic pole — cleanest CMB signal",
}


def main():
    t0 = time.time()

    print()
    print("  ══════════════════════════════════════════════════════════════")
    print("  OLDEST LIGHT — GRID PRE-COMPUTATION")
    print(f"  {GRID_COLS} × {GRID_ROWS} = {GRID_COLS * GRID_ROWS:,} cells  ·  no AI calls  ·  free")
    print("  ══════════════════════════════════════════════════════════════")
    print()

    download_map()
    print()
    T, nside = load_map()
    print()
    words = load_dict(min_len=3, max_len=12)
    print()

    # Resume from existing file if present
    if OUTPUT.exists():
        with open(OUTPUT) as f:
            grid = json.load(f)
        done = {(c["col"], c["row"]) for c in grid}
        print(f"  Resuming — {len(done)} cells already completed, {GRID_COLS * GRID_ROWS - len(done)} remaining")
    else:
        grid = []
        done = set()

    print()

    total    = GRID_COLS * GRID_ROWS
    masked   = 0
    wordless = 0

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            if (col, row) in done:
                continue

            glon, glat = grid_center(col, row)
            vals = read_cell(T, nside, glon, glat, CELL_RADIUS_DEG)

            # Cap pixels for speed
            if len(vals) > MAX_PIXELS:
                vals = vals[:MAX_PIXELS]

            letters, word_seq, score = run_cmb_codec(vals, words)

            n_done  = len(grid) + 1
            elapsed = time.time() - t0
            eta     = (elapsed / n_done) * (total - n_done) if n_done > 1 else 0
            status  = (f"  [{n_done:>4}/{total}]"
                       f"  ({col:>2},{row:>2})"
                       f"  l={glon:>6.1f}° b={glat:>+6.1f}°")

            if not letters:
                masked += 1
                print(f"{status}  (masked)")
            elif not word_seq:
                wordless += 1
                print(f"{status}  {len(letters):>5} letters  (no words)")
            else:
                preview = "  ".join(w.upper() for w, _ in word_seq[:6])
                print(f"{status}  {len(letters):>5} letters  {score:>4} chars  {preview}")

            cell = {
                "col":      col,
                "row":      row,
                "glon":     round(glon, 2),
                "glat":     round(glat, 2),
                "n_pixels": len(vals),
                "score":    score,
                "letters":  letters[:LETTERS_CAP],
                "words":    [[w, tag] for w, tag in word_seq],
                "notable":  NOTABLE.get((col, row), ""),
                "message":  "",   # filled in by generate_messages.py
            }
            grid.append(cell)

            # Save after every cell so interruption loses nothing
            with open(OUTPUT, "w") as f:
                json.dump(grid, f, indent=2)

    elapsed = time.time() - t0
    print()
    print(f"  ── DONE ─────────────────────────────────────────────────────")
    print(f"  {len(grid):,} cells  ·  {masked} masked  ·  {wordless} wordless")
    print(f"  Time: {elapsed / 60:.1f} minutes")
    print(f"  Saved: {OUTPUT}")
    print()


if __name__ == "__main__":
    main()
