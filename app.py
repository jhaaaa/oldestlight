"""
OLDEST LIGHT — Web App

Flask backend serving the CMB codec website.
Generates transmissions on first click, caches in SQLite.
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, abort

from cmb_codec import generate_message

app     = Flask(__name__)
GRID_F  = Path("grid.json")
DB_F    = Path("messages.db")

# Load grid at startup — kept in memory, ~2MB
with open(GRID_F) as f:
    GRID_LIST = json.load(f)
GRID = {(c["col"], c["row"]): c for c in GRID_LIST}

print(f"  Loaded {len(GRID_LIST):,} cells from grid.json")


# ── Database ─────────────────────────────────────────────────────────────────

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
    conn.commit()
    return conn


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/api/cells")
def api_cells():
    """Lightweight metadata for all cells — loaded at page startup."""
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
    """Full cell data + transmission. Generates on first request, caches after."""
    cell = GRID.get((col, row))
    if not cell:
        abort(404)

    conn = db()
    cached = conn.execute(
        "SELECT message, generated_at FROM messages WHERE col=? AND row=?",
        (col, row)
    ).fetchone()

    if cached:
        conn.close()
        return jsonify({
            "col":          col,
            "row":          row,
            "glon":         cell["glon"],
            "glat":         cell["glat"],
            "score":        cell["score"],
            "notable":      cell.get("notable", ""),
            "letters":      cell.get("letters", ""),
            "words":        cell["words"],
            "message":      cached[0],
            "generated_at": cached[1],
            "is_new":       False,
        })

    # No message yet — generate now
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
        "INSERT INTO messages VALUES (?, ?, ?, ?)",
        (col, row, message, now)
    )
    conn.commit()
    conn.close()

    return jsonify({
        "col":          col,
        "row":          row,
        "glon":         cell["glon"],
        "glat":         cell["glat"],
        "score":        cell["score"],
        "notable":      cell.get("notable", ""),
        "letters":      cell.get("letters", ""),
        "words":        cell["words"],
        "message":      message,
        "generated_at": now,
        "is_new":       True,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5001)
