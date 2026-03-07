"""Export all jokes and ideas from the database to a text file."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import joke_db as db

OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "jokes_and_ideas_export.txt")


def main():
    lines = []
    lines.append("=" * 60)
    lines.append("JOKES AND IDEAS EXPORT")
    lines.append("=" * 60)

    with db.with_conn() as conn:
        jokes = conn.execute(
            "SELECT * FROM jokes ORDER BY id"
        ).fetchall()
        ideas = conn.execute(
            "SELECT * FROM ideas ORDER BY id"
        ).fetchall()

    # Jokes
    lines.append("")
    lines.append("--- JOKES ---")
    lines.append("")
    if not jokes:
        lines.append("(no jokes)")
    else:
        for row in jokes:
            j = {k: row[k] for k in row.keys()}
            lines.append("Joke #" + str(j.get("id", "")))
            lines.append("  Title: " + (j.get("title") or "(no title)"))
            if j.get("premise"):
                lines.append("  Body: " + str(j.get("premise", "")))
            if j.get("punchline"):
                lines.append("  Act Out: " + str(j.get("punchline", "")))
            lines.append("  Status: " + str(j.get("status", "")))
            if j.get("setup_notes"):
                lines.append("  Setup notes: " + str(j.get("setup_notes", "")))
            lines.append("")

    # Ideas
    lines.append("")
    lines.append("--- IDEAS ---")
    lines.append("")
    if not ideas:
        lines.append("(no ideas)")
    else:
        for row in ideas:
            i = {k: row[k] for k in row.keys()}
            lines.append("Idea #" + str(i.get("id", "")) + ": " + (i.get("content") or ""))

    text = "\n".join(lines)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(text)
    print("Exported to:", OUTPUT_FILE)


if __name__ == "__main__":
    main()
