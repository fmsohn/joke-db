# Joke Management Database for Comedians

A small SQLite-based database and Python helpers for comedians to manage jokes, sets, tags, venues, and performance notes.

## Setup

1. **Create the database** (from the `joke-db` folder):

   ```bash
   python init_db.py
   ```

   To also seed a default comedian and sample tags:

   ```bash
   python init_db.py --seed
   ```

2. **Use the helpers** in your own scripts:

   ```python
   from joke_db import add_joke, get_joke, list_jokes, add_tag_to_joke, create_set, add_joke_to_set
   ```

## Schema Overview

| Table | Purpose |
|-------|--------|
| **users** | Login accounts (username, password hash) |
| **comedians** | One profile per user; data is scoped by comedian_id |
| **jokes** | Premise, punchline, status (draft/testing/active/retired), performance stats |
| **tags** | Categories (e.g. observational, one-liner, crowd work) |
| **joke_tags** | Links jokes to tags |
| **sets** | Named routines/setlists |
| **set_jokes** | Jokes in a set with position order |
| **venues** | Venue name, city, capacity |
| **performances** | When/where a set was performed, duration, rating |
| **performance_joke_notes** | Per-joke notes and ratings for a performance |

## Example Usage

```python
from joke_db import init_db
import joke_db as db

# One-time: init_db() is in init_db.py; use that script to create DB

# Add a joke
joke_id = db.add_joke(
    premise="I told my doctor I broke my arm in two places.",
    punchline="He said: stay out of those two places.",
    title="Doctor joke",
    status="active",
)
db.add_tag_to_joke(joke_id, "one-liner")

# List active jokes
for j in db.list_jokes(status="active"):
    print(j["title"], "-", j["premise"][:50])

# Build a set
set_id = db.create_set("Friday Open Mic", "5 min spot")
db.add_joke_to_set(set_id, joke_id, position=1)
```

## Multi-user (login)

The web app supports multiple users. Each person **registers** with a username and password; their ideas, jokes, and sets are stored separately. No one can see or edit another user’s data.

- **First visit:** You see a Log in / Register screen. Use **Register** to create an account (username + password).
- **Later:** Use **Log in** with the same username and password.
- **Log out:** Use the “Log out” button in the header.

**Username and password:** Both can be any length; only requirement is non-empty. Username is case-insensitive. "Invalid username or password" means either no account with that username exists or the password is wrong—use **Register** first if you don't have an account.

For production, set a strong **SECRET_KEY** (used to sign session cookies):

```bash
set SECRET_KEY=your-random-secret-here
python app.py
```

(On Linux/macOS use `export SECRET_KEY=...`.)

## Mobile app (Android / phone)

A mobile-friendly web app lets you use Joke DB from your phone on the same Wi‑Fi as your computer.

1. **Install Flask** (one time):

   ```bash
   pip install -r requirements.txt
   ```

2. **Start the server** on your PC (from the `joke-db` folder):

   ```bash
   python app.py
   ```

3. **Find your PC’s IP address** (so your phone can reach it):
   - Windows: open Command Prompt and run `ipconfig`. Look for **IPv4 Address** under your Wi‑Fi adapter (e.g. `192.168.1.105`).
   - Or run: `python -c "import socket; print([l for l in ([ip for ip in socket.gethostbyname_ex(socket.gethostname())[2] if not ip.startswith(\"127.\")][:1], [[(s.connect((\"8.8.8.8\", 53)), s.getsockname()[0], s.close()) for s in [socket.socket(socket.AF_INET, socket.SOCK_DGRAM)]][0][1]]) if l][0][0])"`

4. **On your Android phone**: connect to the **same Wi‑Fi** as your PC, open Chrome (or any browser), and go to:

   ```
   http://YOUR_PC_IP:5000
   ```
   Example: `http://192.168.1.105:5000`

5. **Add to home screen** (optional): In Chrome on your phone, open the menu (⋮) → **Add to Home screen**. The app will appear like an app icon and open full-screen.

The app shows **Jokes** (list and filter), **Sets** (create and view setlists), and **Add Joke** (premise, punchline, status). Data is stored in `jokes.db` on the computer running `app.py`.

## Files

- **schema.sql** – Table definitions and indexes
- **init_db.py** – Creates `jokes.db` and optionally seeds sample data
- **joke_db.py** – CRUD helpers (jokes, tags, sets, venues, performances)
- **app.py** – Web server for the mobile app (Flask)
- **static/** – Web UI (HTML, CSS, JS, manifest)
- **jokes.db** – SQLite database (created after running `init_db.py` or `app.py`)
