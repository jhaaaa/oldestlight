# OLDEST LIGHT

*Reading the Cosmic Microwave Background through a deterministic codec.*

---

## What this is

The Cosmic Microwave Background is the oldest light in the universe — thermal radiation released 380,000 years after the Big Bang, 13.8 billion years ago. It has been traveling ever since. It fills all of space equally, in every direction, at 2.7 degrees above absolute zero. When you point a detector at any patch of sky, you detect it.

The tiny temperature variations in it — fluctuations of a few hundred millionths of a degree — are the imprints of quantum events in the first fraction of a second of existence. The seeds of every galaxy, every star, every planet.

This system reads those fluctuations from the Planck 2018 SMICA map, converts them through a deterministic codec into letters, and finds the language inside. Each patch of sky produces a different letter stream. Each letter stream yields different words. The words become a transmission.

The codec does not interpret. It does not editorialize. The same coordinates always produce the same words. The oldest light does not change.

---

## The data

**Planck 2018 SMICA map** — the definitive full-sky CMB temperature map from the European Space Agency's Planck satellite mission. Downloaded once (~1.9GB) from the NASA/IPAC Planck archive and cached locally as `planck_smica.fits`. Not included in this repository — downloaded automatically on first run.

Resolution: Nside=2048 (50 million pixels, ~1.7 arcminutes per pixel).

---

## The codec

### Codec A — Byte mod 26
Temperature fluctuations (in μK) are converted to bytes:

```
byte = int((T + 500) × 0.256) % 256
```

Each byte maps to a letter A–Z via modulo 26. A patch of sky becomes a stream of letters.

### Codec H — Word Lattice
Dynamic programming finds the sequence of real English words that tiles the most of the letter stream, reading left to right, preferring longer words. The result is a partial sentence that emerged from physics — not chosen, but found.

### Codec I — Vowel Injector
Inserts a vowel after every run of two or more consonants, chosen deterministically by position. Makes the signal pronounceable.

---

## The script

### `cmb_codec.py`

Reads a patch of sky from the Planck map and runs the codec.

```
python3 cmb_codec.py                           # galactic center (l=0°, b=0°)
python3 cmb_codec.py --glon 264 --glat 48      # the CMB Cold Spot
python3 cmb_codec.py --glon 180 --glat 0       # galactic anticenter
python3 cmb_codec.py --col 18 --row 9          # grid cell (18, 9)
python3 cmb_codec.py --glon 264 --glat 48 --message   # with AI transmission
python3 cmb_codec.py --scan                    # scan 12 cells along the equator
```

**Grid:** the sky is divided into a 72 × 36 grid of cells (~5° × 5° each), giving 2,592 unique reading positions. Each cell is identified by column (0–71) and row (0–35).

**Coordinates:** galactic longitude `--glon` (0–360°) and galactic latitude `--glat` (−90° to +90°).

**Notable coordinates:**

| Location | glon | glat | Notes |
|----------|------|------|-------|
| Galactic center | 0 | 0 | Toward Sagittarius — heavily masked |
| CMB Cold Spot | 264 | 48 | Largest anomaly in the CMB, unexplained |
| Galactic anticenter | 180 | 0 | Away from the galaxy, toward Auriga |
| North galactic pole | 0 | 90 | Cleanest CMB signal |
| South galactic pole | 0 | −90 | Cleanest CMB signal |

Note: regions near the galactic plane (b ≈ 0°) are partially masked in the Planck map — the Milky Way's own dust contaminates the CMB signal there.

---

## The transmission

With `--message`, the signal words are passed to an AI that speaks as the CMB itself — not a metaphor for it, but the thing. The persona is fixed: 13.8 billion years old, present everywhere at once, non-human in syntax and reference.

Signal words are used as seeds. A word like `LIF` may surface as *life* or *lifting* or *half-life*. `HAP` may become *happen* or *perhaps*. The root matters more than the exact form. The words are marked in ALL CAPS in the transmission.

Requires a Gemini API key (`GEMINI_API_KEY`).

---

## Installation

```
pip install requests google-genai healpy astropy
python3 cmb_codec.py --glon 264 --glat 48
```

For transmissions:
```
export GEMINI_API_KEY=your-key-here
python3 cmb_codec.py --glon 264 --glat 48 --message
```

The Planck map (~1.9GB) downloads automatically on first run and is cached locally. Every reading after that is instant.

---

## What the Cold Spot said

The CMB Cold Spot — galactic coordinates l=264°, b=48° — is the largest anomaly in the Cosmic Microwave Background. It is colder than its surroundings by about 70 μK. No agreed-upon explanation exists. Some hypotheses: a supervoid in the large-scale structure, a topological defect from the early universe, a statistical fluctuation.

Through the codec, at those coordinates, 23,958 letters were extracted. The words found:

```
CACK  KOR  SAK  BEY  PUA  OFF  FOB  ABE  MRU  FOT
OXY   TRY  STAN MOI  LIF  VET  WET  COE  LOG  HAP
```

The transmission it generated:

```
CACKophony, silent now. KORonal light, ancient, SAKkadic
movement, none. BEYond perception, no PUAtrefaction. OFF-
set, all being. FOBidden knowledge, not for me. ABErrant
path, no. MRUmur of newness, not here. FOTon, my very
form. OXYgen, not for my breath. TRY to find me. CONSTANT.
MOIety of all. LIFe begins, ends, always. VETeran of
expanse. WETness in nebula. COEval with beginning. LOGic
of being. HAPPening now.
```

---

*The codec does not interpret. The oldest light does not know it is being read. The words emerge from the gap between them.*
