# Stagetime – Dead Code & Unification Audit

**Date:** Pre-cleanup audit. Do not delete until you complete "Comment-Out-First" verification.

---

## 1. CSS audit – classes defined but not used in HTML/JS

The following class selectors appear in **static/css/main.css** and/or **static/css/style.css** but were **not found** in any `.html` or `.js` file (no `class="..."`, `classList`, `querySelector(".class")`, or string concatenation containing the class name).

**Review before removal:** Some may be used in dynamically built HTML (e.g. `el.innerHTML = "... class=\"x\" ..."`). Search the codebase for the exact class string before deleting.

| Class | File(s) | Note |
|-------|---------|------|
| **app-logo** | main.css, style.css | Replaced by `.header-logo`; no HTML/JS references. Safe to remove after verification. |
| **auth-use-local** | main.css | Auth "use local storage" message. Not present in current index/templates. |
| **auth-use-local-btn** | main.css | Button for "use local" – not in HTML. |
| **import-login-btn** | main.css, style.css | Import-from-web login button. Not in current static HTML. |
| **import-do-btn** | main.css, style.css | Import action button. Not in current HTML. |
| **import-login-note** | main.css, style.css | Import login note text. Not in HTML. |
| **import-ready-note** | main.css, style.css | Import ready note. Not in HTML. |
| **header-username** | main.css, style.css | `.header-top-row .header-username` – no element with `class="header-username"` in index or templates. Possibly legacy. |

**Recommendation:** Search app.js for `"auth-use-local"`, `"import-login"`, `"import-do"`, `"import-ready"`, `"header-username"`, `"app-logo"`. If no matches, treat as dead and use Comment-Out-First plan below.

---

## 2. JS function audit – app.js & db.js

### 2.1 app.js – possibly unused

| Function | Location | Finding |
|----------|----------|---------|
| **fetchOpts** | app.js ~line 38 | Defined, **never invoked**. Returns `{ credentials: "same-origin" }`. apiFetch uses its own opts. Safe to comment out then remove. |

All other functions in app.js appear to be used (init functions, event handlers, or called from other functions). Inner functions like `showAuthError`, `hideAuthError`, `returnToJokeList`, `refreshJokeDetailSetDropdown`, etc. are used within their scope.

### 2.2 db.js

- No obviously dead top-level functions found. `now()`, `toLoadedShape()`, `normalizeJoke()`, `normalizeIdea()` and all exported API methods are used.

---

## 3. DOM element analysis – IDs in HTML not targeted by JS

**Source:** All `id="..."` in index.html and templates/index.html.

IDs that **do** appear in JS (no action needed):  
auth-shell, app-shell, user-info, auth-form, auth-username, auth-password, auth-error, auth-submit, settings-dashboard, settings-view-topics, settings-view-import-export, joke-list, joke-detail, jokes-toolbar, set-list, set-detail, idea-list, idea-detail, ideas-toolbar, sets-new-form, filter-status, filter-topic, filter-rating, filter-tags, sort-jokes, idea-detail-read, idea-detail-edit-form, idea-detail-content, idea-detail-meta, idea-detail-edit-title, idea-detail-edit-content, idea-detail-edit-topic, idea-detail-edit-tags, modal-idea-detail, idea-detail-edit, modal-add-joke, modal-add-item, modal-advanced-filter, modal-add-idea-to-set, modal-orphan-reassign, storage-notice-dismiss, **fullscreen-btn** (used in inline script in both HTML files), and others used in dynamically built HTML (e.g. joke-detail-edit-btn, joke-detail-save-btn, add-to-set-joke-select, performance-mode-stopwatch, etc.).

**IDs that appear only in HTML** (no getElementById/querySelector in the searched JS):

| ID | File | Note |
|----|------|------|
| **main-css** | index.html, templates/index.html | Used by inline script: `document.getElementById("main-css")` for cache-busting. **Keep.** |

All other IDs from the HTML list were found in app.js or in inline scripts in the HTML files (getElementById or querySelector). If you have additional JS (e.g. data-layer.js, other bundles), run a project-wide search for each ID before removing.

---

## 4. Safety check – "Comment-Out-First" refactoring plan

Before permanently deleting anything:

1. **CSS**
   - In main.css and style.css, **comment out** the full rule blocks for: `app-logo`, `auth-use-local`, `auth-use-local-btn`, `import-login-btn`, `import-do-btn`, `import-login-note`, `import-ready-note`, `.header-top-row .header-username`.
   - Reload the app; test: Ideas, Jokes, Sets, Settings, Import/Export, Auth (if used), modals, set detail, idea detail, performance mode.
   - If everything works and no layout is broken, **delete** the commented-out blocks (or leave commented with a "Dead code – remove after YYYY-MM-DD" note).

2. **JS**
   - In app.js, **comment out** the entire `fetchOpts` function (lines ~38–40).
   - Run the app; test API calls (e.g. login/register if used, any fetch from app.js).
   - If no regressions, **delete** the commented-out function.

3. **IDs**
   - Do **not** remove `id="main-css"` (used by script). All other checked IDs (including fullscreen-btn, used in inline script) are in use.

---

## 5. Tree-shaking / redundancy – unification opportunities

### 5.1 main.css vs style.css

- **Finding:** The two files are **largely parallel**: same structure, same class names, same layout (header, panels, modals, auth, settings, import, sets, ideas, jokes). Differences are mostly small (e.g. style.css has `body { background: url(...) }`, main.css uses `var(--bg)`; style.css may have extra/legacy rules).
- **Unification:**
  - **Option A:** Use a **single** CSS file (e.g. main.css) for both the static index and the Flask template. In templates/index.html, point `data-href` (or equivalent) to the same path as the static index (e.g. `/static/css/main.css`). Remove or deprecate style.css after verification.
  - **Option B:** Keep two files but **extract shared rules** into a common file (e.g. `common.css`) and load it from both index.html and templates/index.html; then keep only entry-specific overrides in main.css and style.css.

### 5.2 index.html vs templates/index.html

- **Finding:** The two are **almost the same** structure: same sections, same IDs, same modal and panel layout. Differences: root index uses `/static/...` and `main.css`; templates uses `{{ url_for('static', ...) }}` and `style.css`. templates/index.html has a fuller auth form (username/password, auth-form, auth-error, etc.); root index has a minimal auth-shell placeholder.
- **Unification:**
  - If you always serve via Flask, you can **remove** the root index.html and serve the single templates/index.html at `/`. Then use one CSS file (e.g. main.css) and one manifest.
  - If you need both "static host" and "Flask host", keep both HTML files but **share a single CSS file** and minimize duplicate markup (e.g. partials or one generated from the other).

---

## 6. Summary

| Category | Finding | Action |
|----------|---------|--------|
| **CSS classes** | 8 classes (app-logo, auth-use-local, auth-use-local-btn, import-login-btn, import-do-btn, import-login-note, import-ready-note, header-username) not referenced in HTML/JS | Comment out in main.css + style.css → test → remove if safe. |
| **JS** | `fetchOpts()` in app.js never called | Comment out → test → remove. |
| **IDs** | All checked IDs are used (main-css and fullscreen-btn in inline scripts; rest in app.js). | No removal needed. |
| **Redundancy** | main.css ≈ style.css; index.html ≈ templates/index.html | Unify CSS to one file and/or share layout to reduce drift. |

After you run the Comment-Out-First steps and confirm the app still works, you can permanently delete the dead CSS and the `fetchOpts` function.
