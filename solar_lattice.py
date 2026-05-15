"""
COSMIC CODEC — Solar Wind Word Lattice
August 1, 2017. The day of the Bitcoin/BCH fork.

The solar wind arrives as a simultaneous multi-channel broadcast:
speed, density, magnetic field (Bx, By, Bz), temperature, pressure.

Each channel is a continuous stream of numbers — one per minute, all day.
We convert each number to a letter (value mod 26 → A-Z),
then run the word lattice: dynamic programming that tiles the stream
with the longest real English words it can find, left to right.

No vocabulary selection. No editorial voice.
The system dictionary (150,000 words) is the only filter.
"""

import requests
import time

FORK_UTC = "2017-08-01T13:16:14Z"

# ── System dictionary ──────────────────────────────────────────────────────────

def load_dict(min_len=3, max_len=12):
    words = set()
    try:
        with open("/usr/share/dict/words") as f:
            for line in f:
                w = line.strip().lower()
                if min_len <= len(w) <= max_len and w.isalpha():
                    words.add(w)
        print(f"  [dictionary: {len(words):,} words]")
    except FileNotFoundError:
        print("  [/usr/share/dict/words not found — install with: brew install wamerican]")
    return words

# ── Fetch ──────────────────────────────────────────────────────────────────────

# OMNI_HRO_1MIN column indices (after Time at col 0)
# From HAPI /info parameter list:
COLS = {
    "BZ_GSM":         15,
    "flow_speed":     18,
    "proton_density": 22,
    "T":              23,   # plasma temperature (K)
    "Pressure":       24,   # flow pressure (nPa)
    "BX_GSE":         11,
    "BY_GSM":         14,
}

CHANNEL_FILLS = {   # OMNI documented fill values per channel
    "flow_speed":     99999.9,
    "proton_density": 999.99,
    "BZ_GSM":         9999.99,
    "BX_GSE":         9999.99,
    "BY_GSM":         9999.99,
    "T":              9999999.0,
    "Pressure":       99.99,
}

def fetch_omni(start: str, stop: str):
    """Fetch full OMNI_HRO_1MIN dataset for date range. Returns dict of channel→[values]."""
    url = (
        "https://cdaweb.gsfc.nasa.gov/hapi/data"
        f"?id=OMNI_HRO_1MIN&time.min={start}&time.max={stop}"
    )
    print(f"  Fetching OMNI_HRO_1MIN  {start} → {stop}...")
    try:
        r = requests.get(url, timeout=60)
        if r.status_code != 200:
            print(f"  [HTTP {r.status_code}]")
            return {}
    except Exception as e:
        print(f"  [fetch error: {e}]")
        return {}

    channels = {name: [] for name in COLS}
    timestamps = []
    rows_total = 0

    for line in r.text.strip().splitlines():
        parts = line.split(",")
        if len(parts) < max(COLS.values()) + 1:
            continue
        rows_total += 1
        timestamps.append(parts[0])
        for name, idx in COLS.items():
            try:
                v = float(parts[idx])
                channels[name].append(v if v < CHANNEL_FILLS[name] * 0.99 else None)
            except (ValueError, IndexError):
                channels[name].append(None)

    valid = sum(1 for v in channels["flow_speed"] if v is not None)
    print(f"  {rows_total} rows, {valid} valid speed readings")
    return channels, timestamps

# ── Byte conversion ────────────────────────────────────────────────────────────

def to_bytes(values: list, scale: float = 1.0, offset: float = 0.0) -> bytes:
    """
    Convert measurements to bytes.
    (value + offset) * scale → integer → mod 256 → byte.
    Skips None (missing data).
    """
    result = []
    for v in values:
        if v is None:
            continue
        result.append(int((v + offset) * scale) % 256)
    return bytes(result)

# ── Vowel injector ────────────────────────────────────────────────────────────

VOWELS_STR = "AEIOU"
CONSONANTS_STR = "BCDFGHJKLMNPQRSTVWXYZ"

def inject_vowels(letters: str) -> str:
    """
    Insert a vowel after every run of 2+ consonants.
    The vowel is chosen deterministically from position mod 5.
    Returns a continuous enriched letter stream (no spaces).
    The added vowels are not in the original signal — they are
    the codec's contribution, making the stream pronounceable.
    """
    result, run = [], 0
    for i, c in enumerate(letters.upper()):
        result.append(c)
        if c in CONSONANTS_STR:
            run += 1
            if run >= 2:
                result.append(VOWELS_STR[i % 5])
                run = 0
        else:
            run = 0
    return "".join(result)

def syllabify(letters: str) -> str:
    """Break a letter stream into syllable-sized chunks for display."""
    chunks, i = [], 0
    while i < len(letters):
        size = 4 + (ord(letters[i]) % 3)
        chunks.append(letters[i:i+size])
        i += size
    return " ".join(chunks)

# ── Enriched stream builder ────────────────────────────────────────────────────

def build_enriched(letters: str):
    """
    Build the vowel-injected stream and return position maps.

    Returns:
        enriched      : str — the full injected letter stream (uppercase)
        raw_to_enr    : list[int] — raw index i → first enriched index for that raw letter
        enr_to_raw    : list[int|None] — enriched index j → raw index (None if injected)
        enr_is_inj    : list[bool] — True if enriched[j] was injected (not in signal)
    """
    upper = letters.upper()
    enriched_chars = []
    raw_to_enr = []
    enr_to_raw = []
    enr_is_inj = []

    run = 0
    for i, c in enumerate(upper):
        # Record where this raw letter lands in enriched
        raw_to_enr.append(len(enriched_chars))
        enriched_chars.append(c)
        enr_to_raw.append(i)
        enr_is_inj.append(False)

        if c in CONSONANTS_STR:
            run += 1
            if run >= 2:
                v = VOWELS_STR[i % 5]
                enriched_chars.append(v)
                enr_to_raw.append(None)
                enr_is_inj.append(True)
                run = 0
        else:
            run = 0

    return "".join(enriched_chars), raw_to_enr, enr_to_raw, enr_is_inj


# ── Combined reading ────────────────────────────────────────────────────────────

def combined_reading(letters: str, words: set):
    """
    Produce the combined three-reading view.

    Returns:
        stream_parts : list of (text, kind) where kind is:
                       'I'    — word found by Reading I (raw lattice)
                       'III'  — word found only by Reading III (enriched lattice)
                       'inj'  — injected vowel (codec's contribution)
                       'gap'  — raw letter not in any word
        word_seq     : list of (word, reading_tag) in order of appearance in enriched stream
    """
    enriched, raw_to_enr, enr_to_raw, enr_is_inj = build_enriched(letters)

    # Reading I: word lattice on raw letters
    raw_tokens = word_lattice(letters, words)

    # Reading III: word lattice on enriched letters
    enr_tokens = word_lattice(enriched, words)

    # --- Mark which enriched positions are covered by Reading I words ---
    # Build a coverage array over raw positions
    n_raw = len(letters)
    n_enr = len(enriched)

    raw_word_at = [None] * n_raw   # raw_word_at[i] = word string if pos i is in a Reading I word
    raw_pos = 0
    for tok in raw_tokens:
        if tok.startswith("["):
            raw_pos += 1
        else:
            for k in range(len(tok)):
                raw_word_at[raw_pos + k] = tok
            raw_pos += len(tok)

    # Map raw word coverage to enriched positions
    enr_covered_I = [None] * n_enr   # enr_covered_I[j] = word if covered by Reading I
    for j in range(n_enr):
        ri = enr_to_raw[j]
        if ri is not None and raw_word_at[ri] is not None:
            enr_covered_I[j] = raw_word_at[ri]

    # --- Mark which enriched positions are covered by Reading III words ---
    enr_covered_III = [None] * n_enr
    enr_pos = 0
    for tok in enr_tokens:
        if tok.startswith("["):
            enr_pos += 1
        else:
            for k in range(len(tok)):
                enr_covered_III[enr_pos + k] = tok
            enr_pos += len(tok)

    # --- Build stream_parts by walking enriched stream position by position ---
    stream_parts = []
    word_seq = []

    j = 0
    while j < n_enr:
        # Check Reading I coverage first (takes precedence).
        # Advance character by character through the enriched stream while
        # the current raw-letter positions are covered by this Reading I word.
        # Injected vowels within a Reading I word span are skipped silently
        # (they don't exist in the raw stream so the word already accounts for them).
        if enr_covered_I[j] is not None:
            word = enr_covered_I[j]
            stream_parts.append((word.upper(), 'I'))
            if not word_seq or word_seq[-1] != (word, 'I'):
                word_seq.append((word, 'I'))
            # Advance through exactly len(word) raw characters, skipping any
            # injected vowels that fall between them.
            raw_consumed = 0
            while raw_consumed < len(word) and j < n_enr:
                if not enr_is_inj[j]:
                    raw_consumed += 1
                j += 1
        elif enr_is_inj[j]:
            stream_parts.append((enriched[j].lower(), 'inj'))
            j += 1
        elif enr_covered_III[j] is not None:
            word = enr_covered_III[j]
            stream_parts.append((word.upper(), 'III'))
            if not word_seq or word_seq[-1] != (word, 'III'):
                word_seq.append((word, 'III'))
            # Advance past all enriched positions for this Reading III word
            j += len(word)
        else:
            stream_parts.append((enriched[j], 'gap'))
            j += 1

    return stream_parts, word_seq


def format_combined_stream(stream_parts: list, line_width: int = 72) -> str:
    """
    Format the combined stream into readable lines.

    Rendering:
      Reading I words  → WORD  (plain CAPS, no marker — they are what's there)
      Reading III words→ (WORD) (parens — enabled by vowel injection)
      Injected vowels  → ·v·  (middot + lowercase, visually distinct)
      Gaps             → x  (lowercase raw letter)
    """
    rendered = []
    for text, kind in stream_parts:
        if kind == 'I':
            rendered.append(text)
        elif kind == 'III':
            rendered.append(f"({text})")
        elif kind == 'inj':
            rendered.append(f"·{text}·")
        else:
            rendered.append(text.lower())

    # Wrap into lines
    lines, current, length = [], [], 0
    for token in rendered:
        if length + len(token) + 1 > line_width and current:
            lines.append(" ".join(current))
            current, length = [], 0
        current.append(token)
        length += len(token) + 1
    if current:
        lines.append(" ".join(current))
    return "\n  → ".join(lines)


# ── Word lattice ───────────────────────────────────────────────────────────────

def bytes_to_letters(raw: bytes) -> str:
    return "".join(chr(ord('A') + b % 26) for b in raw)

def word_lattice(letters: str, words: set) -> list:
    """
    DP: find longest sequence of real words tiling the letter stream, L→R.
    Gaps filled with bracketed raw letters.
    Returns list of tokens (words or [letter] gaps).

    The main loop fills dp[i] via words (long jumps) and gap-fill (one step back).
    A second forward pass guarantees dp[n] is always reached.
    """
    n = len(letters)
    lower = letters.lower()
    dp = [None] * (n + 1)
    dp[0] = []

    for i in range(n):
        if dp[i] is None:
            if i > 0 and dp[i-1] is not None:
                dp[i] = dp[i-1] + [f"[{letters[i-1]}]"]
            elif i == 0:
                dp[i] = []
            else:
                continue

        for length in range(3, min(13, n - i + 1)):
            candidate = lower[i:i + length]
            if candidate in words and dp[i + length] is None:
                dp[i + length] = dp[i] + [candidate]

    # Second pass: guarantee dp[n] is reachable via single-letter gaps.
    # The main loop sets dp[i] from dp[i-1] but the final step dp[n-1]→dp[n]
    # only happens via a word, never via the gap-fill.
    for i in range(1, n + 1):
        if dp[i] is None and dp[i-1] is not None:
            dp[i] = dp[i-1] + [f"[{letters[i-1]}]"]

    return dp[n] or [f"[{c}]" for c in letters]

def format_lattice(tokens: list, line_width: int = 60) -> str:
    """Format lattice tokens into readable lines. Words stand out; [gaps] are lowercase."""
    lines, current, length = [], [], 0
    for token in tokens:
        display = token if token.startswith("[") else token.upper()
        if length + len(display) + 1 > line_width and current:
            lines.append(" ".join(current))
            current, length = [], 0
        current.append(display)
        length += len(display) + 1
    if current:
        lines.append(" ".join(current))
    return "\n  → ".join(lines)

def stats(tokens: list):
    words = [t for t in tokens if not t.startswith("[")]
    gaps  = [t for t in tokens if t.startswith("[")]
    total_chars = sum(len(t) for t in tokens)
    word_chars  = sum(len(w) for w in words)
    coverage    = word_chars / total_chars * 100 if total_chars else 0
    return len(words), len(gaps), coverage

# ── Display ────────────────────────────────────────────────────────────────────

CHANNEL_META = {
    "flow_speed":     ("SOLAR WIND SPEED",           0.0,    0.5,  "km/s   × 0.5 → byte"),
    "proton_density": ("PROTON DENSITY",              0.0,    8.0,  "p/cm³  × 8 → byte"),
    "BZ_GSM":         ("MAGNETIC FIELD Bz",          30.0,    4.0,  "(Bz + 30) × 4 → byte"),
    "BX_GSE":         ("MAGNETIC FIELD Bx",          30.0,    4.0,  "(Bx + 30) × 4 → byte"),
    "BY_GSM":         ("MAGNETIC FIELD By",          30.0,    4.0,  "(By + 30) × 4 → byte"),
    "T":              ("PLASMA TEMPERATURE",          0.0,  0.001,  "K × 0.001 → byte"),
    "Pressure":       ("FLOW PRESSURE",               0.0,   25.0,  "nPa × 25 → byte"),
}

def read_channel(name, values, words, show_raw=True):
    label, offset, scale, note = CHANNEL_META[name]
    valid = [v for v in values if v is not None]
    if not valid:
        print(f"\n  ── {label}: no data ──")
        return

    raw = to_bytes(values, scale=scale, offset=offset)
    if not raw:
        return
    letters  = bytes_to_letters(raw)
    mean_val = sum(valid) / len(valid)

    print(f"\n  {'═' * 66}")
    print(f"  {label}")
    print(f"  {len(valid)} readings  mean: {mean_val:.2f}  encoding: {note}")

    # ── Reading I: word lattice on raw letters (what is literally there) ───────
    tokens  = word_lattice(letters, words)
    n_words, n_gaps, coverage = stats(tokens)
    found_words = sorted({t for t in tokens if not t.startswith("[")},
                         key=lambda w: -len(w))

    print(f"\n  READING I — word lattice  [{n_words} words, {coverage:.0f}% coverage]")
    if found_words:
        print(f"  words: {' · '.join(found_words[:30])}")
    else:
        print(f"  words: (none)")
    print(f"  → {format_lattice(tokens)}")

    # ── Reading II: vowel injector (made pronounceable) ────────────────────────
    enriched = inject_vowels(letters)
    print(f"\n  READING II — vowel injector  [{len(enriched)} letters, "
          f"{len(enriched)-len(letters)} vowels added]")
    print(f"  note: added vowels are the codec's contribution, not the signal's")
    print(f"  → {syllabify(enriched)[:300]}{'...' if len(enriched) > 300 else ''}")

    # ── Reading III: word lattice on vowel-enriched stream ────────────────────
    enriched_tokens  = word_lattice(enriched, words)
    ne_words, ne_gaps, ne_cov = stats(enriched_tokens)
    enriched_found = sorted({t for t in enriched_tokens if not t.startswith("[")},
                            key=lambda w: -len(w))
    new_words = [w for w in enriched_found if w not in {t.lower() for t in found_words}]

    print(f"\n  READING III — word lattice on vowel-enriched stream  "
          f"[{ne_words} words, {ne_cov:.0f}% coverage]")
    if enriched_found:
        print(f"  words: {' · '.join(enriched_found[:30])}")
    if new_words:
        print(f"  new (enabled by vowels): {' · '.join(new_words[:20])}")
    print(f"  → {format_lattice(enriched_tokens)}")

    # ── Combined view ─────────────────────────────────────────────────────────
    stream_parts, word_seq = combined_reading(letters, words)

    print(f"\n  COMBINED — all three readings in the signal")
    print(f"  WORD = found in raw signal (I)  ·v· = injected vowel  (WORD) = enabled by vowel (III)  x = gap")
    print(f"  → {format_combined_stream(stream_parts)}")

    if word_seq:
        print(f"\n  WORDS IN ORDER:")
        for w, tag in word_seq:
            marker = "  " if tag == 'I' else " ·"
            print(f"    {marker} {w.upper():<20}  [{tag}]")
    else:
        print(f"\n  WORDS IN ORDER: (none)")

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print()
    print("  COSMIC CODEC — SOLAR WIND WORD LATTICE")
    print("  August 1, 2017  —  the day Bitcoin split in two")
    print(f"  Fork moment: {FORK_UTC}")
    print()
    print("  The solar wind is a multi-channel broadcast.")
    print("  Each channel becomes a letter stream.")
    print("  The word lattice reads it left to right,")
    print("  finding the longest real words it can,")
    print("  no gaps left unread.")
    print()

    words = load_dict()
    if not words:
        print("  Cannot proceed without dictionary.")
        return
    print()

    # Fetch full day at 1-minute resolution
    result = fetch_omni(
        "2017-08-01T00:00:00Z",
        "2017-08-02T00:00:00Z"
    )
    if not result or len(result) != 2:
        print("  [could not fetch solar wind data]")
        return
    channels, timestamps = result
    print()

    # Mark the fork minute
    fork_minute = None
    for i, t in enumerate(timestamps):
        if "13:16" in t:
            fork_minute = i
            break
    if fork_minute is not None:
        sp = channels["flow_speed"][fork_minute]
        bz = channels["BZ_GSM"][fork_minute]
        dn = channels["proton_density"][fork_minute]
        print(f"  ── AT THE FORK (13:16 UTC): "
              f"speed {sp:.0f} km/s  density {dn:.1f} p/cm³  Bz {bz:+.2f} nT ──")
        print()

    # Read each channel through the word lattice
    channel_order = [
        "flow_speed", "proton_density", "BZ_GSM", "BX_GSE", "BY_GSM",
        "T", "Pressure",
    ]
    for name in channel_order:
        if name in channels:
            read_channel(name, channels[name], words)
        time.sleep(0.1)

    print(f"\n  {'═' * 66}")
    print("  END OF SOLAR READING")
    print()

    # Summary: most frequent words across all channels
    print("  ── WORDS THE SUN REPEATED MOST ────────────────────────────────")
    from collections import Counter
    all_words = Counter()
    for name in channel_order:
        if name not in channels:
            continue
        raw = to_bytes(channels[name], **dict(zip(
            ["scale", "offset"],
            [CHANNEL_META[name][2], CHANNEL_META[name][1]]
        )))
        if raw:
            letters = bytes_to_letters(raw)
            tokens  = word_lattice(letters, words)
            for t in tokens:
                if not t.startswith("["):
                    all_words[t.lower()] += 1

    for word, count in all_words.most_common(30):
        bar = "█" * count
        print(f"  {word:<20} {count:>3}  {bar}")
    print()


if __name__ == "__main__":
    main()
