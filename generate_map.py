"""
Generate the CMB map image for the website.

Renders the Planck 2018 SMICA map as a Mollweide projection PNG.
Run once — output is static/cmb_map.jpg, committed to the repo.

Usage:
  python3 generate_map.py
"""

import numpy as np
import healpy as hp
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

MAP_FILE = Path("planck_smica.fits")
OUTPUT   = Path("static/cmb_map.jpg")

def main():
    print("Loading Planck map ...")
    T = hp.read_map(str(MAP_FILE), field=0, verbose=False)
    nside = hp.get_nside(T)
    print(f"  nside={nside}  npix={len(T):,}")

    # Convert K → μK if needed
    valid = T[T > hp.UNSEEN * 0.5]
    if len(valid) > 0 and np.abs(np.median(valid)) < 0.01:
        T = T * 1e6
        print("  Converted K → μK")

    print("Rendering Mollweide projection ...")
    fig = plt.figure(figsize=(20, 10), dpi=150, facecolor="black")

    hp.mollview(
        T,
        fig=fig.number,
        title="",
        cmap="RdBu_r",
        min=-300,
        max=300,
        cbar=False,
        notext=True,
        bgcolor="black",
        nest=False,
    )

    for ax in fig.get_axes():
        ax.set_axis_off()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUTPUT, bbox_inches="tight", pad_inches=0,
                facecolor="black", dpi=150)
    plt.close()

    size_kb = OUTPUT.stat().st_size // 1024
    print(f"Saved: {OUTPUT}  ({size_kb}KB)")


if __name__ == "__main__":
    main()
