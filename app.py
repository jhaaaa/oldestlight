"""
OLDEST LIGHT — Web App

Flask backend serving the CMB codec website.
Generates transmissions on first click, caches in SQLite.
One decode per block ever. One new decode per identity (hashed IP).
"""

import hashlib
import json
import os
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, abort, request

from cmb_codec import generate_message

app     = Flask(__name__)
GRID_F  = Path("grid.json")
DB_F    = Path("messages.db")

# Set DECODER_SALT in environment for production — never commit the real value
DECODER_SALT = os.environ.get('DECODER_SALT', 'oldest-light-default-change-me')

# Load grid at startup — kept in memory, ~2MB
with open(GRID_F) as f:
    GRID_LIST = json.load(f)
GRID = {(c["col"], c["row"]): c for c in GRID_LIST}

print(f"  Loaded {len(GRID_LIST):,} cells from grid.json")


# ── Identity ──────────────────────────────────────────────────────────────────

def get_client_ip():
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr

def hash_identity(ip):
    """Irreversible fingerprint. Raw IP is never stored."""
    return hashlib.sha256(f"{ip}:{DECODER_SALT}".encode()).hexdigest()[:24]

def geolocate(ip):
    """City-level geolocation. Returns dict or None. Coordinates rounded to 1 decimal (~10km)."""
    if not ip or ip in ('127.0.0.1', '::1', 'localhost'):
        return None
    try:
        req = urllib.request.Request(
            f'https://ipinfo.io/{ip}/json',
            headers={'User-Agent': 'oldest-light/1.0'}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read())
        city    = data.get('city') or ''
        country = data.get('country') or ''
        loc     = data.get('loc') or ''
        lat = lon = None
        if loc:
            parts = loc.split(',')
            lat = round(float(parts[0]), 1)
            lon = round(float(parts[1]), 1)
        return {'city': city, 'country': country, 'lat': lat, 'lon': lon}
    except Exception:
        return None


# ── Database ──────────────────────────────────────────────────────────────────

def db():
    conn = sqlite3.connect(DB_F)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            col          INTEGER,
            row          INTEGER,
            message      TEXT,
            generated_at TEXT,
            PRIMARY KEY (col, row)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS decoders (
            hash       TEXT PRIMARY KEY,
            decoded_at TEXT
        )
    """)
    # Migrate existing databases — add decoder columns if absent
    for col_def in ('decoder_city TEXT', 'decoder_country TEXT',
                    'decoder_lat REAL', 'decoder_lon REAL'):
        try:
            conn.execute(f'ALTER TABLE messages ADD COLUMN {col_def}')
        except sqlite3.OperationalError:
            pass  # column already exists
    conn.commit()
    return conn


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/api/decoded")
def api_decoded():
    """List of all (col, row) pairs that have been decoded — for map highlighting."""
    conn = db()
    rows = conn.execute("SELECT col, row FROM messages").fetchall()
    conn.close()
    return jsonify([{"col": r[0], "row": r[1]} for r in rows])


@app.route("/api/cells")
def api_cells():
    cells = [
        {
            "col":     c["col"],
            "row":     c["row"],
            "glon":    c["glon"],
            "glat":    c["glat"],
            "score":   c["score"],
            "notable": c.get("notable", ""),
        }
        for c in GRID_LIST
    ]
    return jsonify(cells)


@app.route("/api/cell/<int:col>/<int:row>")
def api_cell(col, row):
    """Full cell data + transmission. Generates on first request, caches forever after."""
    cell = GRID.get((col, row))
    if not cell:
        abort(404)

    conn = db()
    cached = conn.execute(
        """SELECT message, generated_at, decoder_city, decoder_country, decoder_lat, decoder_lon
           FROM messages WHERE col=? AND row=?""",
        (col, row)
    ).fetchone()

    if cached:
        conn.close()
        return jsonify({
            "col":             col,
            "row":             row,
            "glon":            cell["glon"],
            "glat":            cell["glat"],
            "score":           cell["score"],
            "notable":         cell.get("notable", ""),
            "letters":         cell.get("letters", ""),
            "words":           cell["words"],
            "temp_min":        cell.get("temp_min"),
            "temp_max":        cell.get("temp_max"),
            "temp_mean":       cell.get("temp_mean"),
            "message":         cached[0],
            "generated_at":    cached[1],
            "decoder_city":    cached[2],
            "decoder_country": cached[3],
            "decoder_lat":     cached[4],
            "decoder_lon":     cached[5],
            "is_new":          False,
        })

    # Block not yet decoded — check decoder identity before generating
    ip            = get_client_ip()
    identity_hash = hash_identity(ip)

    already_decoded = conn.execute(
        "SELECT 1 FROM decoders WHERE hash=?", (identity_hash,)
    ).fetchone()

    if already_decoded:
        conn.close()
        return jsonify({"error": "limit_reached"}), 429

    # Geolocate (city-level, 1 decimal — not stored as raw IP)
    geo = geolocate(ip)

    # Generate transmission
    word_seq = [(w, tag) for w, tag in cell["words"]]
    message  = ""
    if word_seq:
        try:
            message = generate_message(word_seq, cell["glon"], cell["glat"])
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    conn.execute(
        """INSERT INTO messages
           (col, row, message, generated_at, decoder_city, decoder_country, decoder_lat, decoder_lon)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (col, row, message, now,
         geo['city']    if geo else None,
         geo['country'] if geo else None,
         geo['lat']     if geo else None,
         geo['lon']     if geo else None)
    )
    conn.execute(
        "INSERT OR IGNORE INTO decoders (hash, decoded_at) VALUES (?, ?)",
        (identity_hash, now)
    )
    conn.commit()
    conn.close()

    return jsonify({
        "col":             col,
        "row":             row,
        "glon":            cell["glon"],
        "glat":            cell["glat"],
        "score":           cell["score"],
        "notable":         cell.get("notable", ""),
        "letters":         cell.get("letters", ""),
        "words":           cell["words"],
        "temp_min":        cell.get("temp_min"),
        "temp_max":        cell.get("temp_max"),
        "temp_mean":       cell.get("temp_mean"),
        "message":         message,
        "generated_at":    now,
        "decoder_city":    geo['city']    if geo else None,
        "decoder_country": geo['country'] if geo else None,
        "decoder_lat":     geo['lat']     if geo else None,
        "decoder_lon":     geo['lon']     if geo else None,
        "is_new":          True,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
