# Product overview

**MoodCanvas** is a **client-only** interior design assistant.
A user uploads **one photo** (JPG/PNG, camera capture supported) of an **empty or near-empty room** and chats through a guided flow to:

1. analyze the room, 2) explore **10 full-style renders** (gallery), 3) compare **A/B mini-variants** for up to 3 favorites, and 4) get **3 hero renders (Smart Mixed)** plus a **60-30-10 palette**, **5 quick wins**, and a **mini shopping list** (neutral specs only).
   All AI calls use **Google Gemini** with **Bring-Your-Own-Key** (BYOK). **No backend**; data persists locally.

# Goals & non-goals

**Goals (MVP)**

* Single-photo based advisory for **empty rooms**; secondary cases (near-empty) should still work.
* “Chat-style, linear” UX where each step appends a card; **strict backtrack**: changing an earlier answer removes subsequent cards.
* **Inspiration Pulse** inside the analysis: top usage candidates + style fit.
* **10-style gallery** (1 image per style) with **pool=5** parallel generation; **order by fit score** desc, no “recommended” badge.
* Post-selection: **A/B mini-variants** for up to 3 styles (**Smart Mixed** axes from analysis) after a confirmation step.
* Final: **3 hero renders (Smart Mixed)** after a confirmation step.
* **Mini shopping list** = **3 impact items** from analysis + **2 function staples**, **no prices**.
* **Strict JSON** analysis via Gemini (response schema enforced).
* **Dark, relaxing UI** (Plum–Peach palette) with **Tailwind Play CDN**; **system sans** fonts.

**Non-goals (MVP)**

* No user accounts; no server storage; no exports (ZIP/PDF/HTML) yet.
* No multi-language UI (English only); internal units in **meters** only.
* No accessibility hard targets (postponed).
* No PWA/offline installation; **GitHub Pages** static hosting only.
* No seed control/deduplication for renders; no price or shop links in the mini list.

# Primary use cases (supported room functions)

* Bedroom, Home-Office, Kids Room, Guest Room, Living Room, Dining Room, Hobby/Studio, Fitness/Yoga, Library/Reading, Music/Recording, Walk-in Closet, Storage/Utility, plus free-text “Other”.

# Architecture choices (and rationale)

* **Client-only web app**: privacy-forward, easy hosting (GitHub Pages), zero backend complexity.
* **BYOK (Gemini)**: user supplies API key; no server secrets. Key stored **only in localStorage**.
* **Models**: `gemini-2.5-flash` for **analysis**; `gemini-2.5-flash-image` for **renders**. Balanced cost/latency.
* **Strict JSON** mode for analysis: `responseMimeType:"application/json"` + `responseSchema` → stable, machine-consumable output.
* **Storage**: **IndexedDB** via tiny `idb` lib; **Hybrid model** (projects, events, media, artifacts). Local only.
* **Styling**: Tailwind **Play CDN** (no build); **Plum–Peach** dark palette; system sans.
* **Hosting**: **GitHub Pages**; **CSP meta** (loose MVP) embedded in `index.html`.

# Security & privacy

* **Key handling**:

  * BYOK banner (“Get your key… Google AI Studio. The key is stored only in your browser”).
  * Store in **localStorage**; **Settings modal** offers “Remove key from this device”.
  * No validation calls; optional superficial prefix hint (keys often start `AIza…`).
  * Send key in header `x-goog-api-key` (not query).

* **Images & metadata**:

  * Allow **JPG/PNG**. Accept EXIF orientation; **do not strip metadata** for MVP; send “as-is”.
  * Resize **before upload**: long side **≤ 2048 px** (q≈0.9).
  * No additional consent gate (info lives in Help/README).

* **CSP (loose MVP)**:

  ```
  default-src 'self';
  img-src 'self' blob: data:;
  connect-src https://generativelanguage.googleapis.com;
  script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  object-src 'none'; frame-ancestors 'none'; base-uri 'self';
  ```

# Data model (IndexedDB – Hybrid)

Stores (via `idb`):

* **projects** `{ id, name, createdAt, updatedAt, settings { units:"m", theme:"plum-peach" }, caps { perProjectMB:150 } }`
* **events** (append-only timeline) `{ id, projectId, type, payload, createdAt }`
  Types: `upload_image`, `analysis_done`, `gallery_generated`, `ab_generated`, `hero_generated`, `selection_changed`, `warning`, `error`, etc.
* **media** (blobs & thumbs) `{ id, projectId, kind:"input|render|thumb", bytes|blob, mime, width, height, relatedId, createdAt }`
  Import: store **original** + **512px thumb**. Renders: store full + thumb.
* **artifacts** (JSON/text) `{ id, projectId, kind:"analysis|prompts|palette|quickwins|shoppinglist", json, createdAt }`

**Storage caps & cleanup**

* Output JPEG q≈0.85; thumbs 384px.
* **Per-project cap 150 MB**, **global cap 600 MB**.
* **LRU auto-delete** oldest **full-res renders** when over cap; thumbs remain; 30s undo toast.

# UX flow (chat-like, linear; strict backtrack)

Cards appear top→down; editing an earlier card **removes all later cards**.

1. **UploadCard**

   * `<input type="file" accept="image/jpeg,image/png" capture="environment">`
   * Shows selected image preview.
   * Minimal import normalization: **fix EXIF orientation**, store original + 512 thumb.

2. **KeyBanner** (only if no key is present)

   * Text: “Get your key… Google AI Studio. The key is stored only in your browser.” (link).
   * Paste field to save key. No validation.

3. **Inspiration Pulse + Function/Scope Quick Pick**

   * One **Single-Analysis** call (strict JSON) returns `usage_candidates`.
   * Show top 3 as an “Inspiration” bubble.
   * User explicitly selects **intended use** and **scope (1–4)** (short picker).
   * **Low scale confidence** → small non-blocking warning banner.

4. **AnalysisCard**

   * Renders JSON summary: `photo_findings`, `palette_60_30_10`, `quick_wins` (top 5), `styles_top10` order and scores.

5. **StyleGalleryCard**

   * Generates **10 full renders** (one per style) **in parallel** with **pool=5**; default size **1536×1024**.
   * User can adjust **count (6/8/10)** and **size (1024/1536)** before running.
   * Tiles **ordered by fit_score desc**; **corner chip** shows style name.
   * Per-tile **soft fail** → small error chip + **Retry**.

6. **SelectionCard**

   * Select **up to 3 favorites**.

7. **A/B Mini-Variants**

   * Confirmation card shows “N favorites × 2 images”.
   * Generate per favorite 2 images using **smart_mixed_axes** from analysis; pool=5.

8. **HeroRenderCard** (final)

   * Confirmation card (“3 images @ 1536×1024”).
   * Generate **3 hero renders (Smart Mixed)**.
   * Derive **60-30-10 palette**, **5 Quick Wins**, and **mini shopping list** here.

9. **QuickWins & Mini List**

   * Show **5 actionable items** (concise rules, e.g., distances in meters).
   * **Mini list (5 items)** = 3 highest-impact + 2 function staples; **no prices**.

10. **Settings modal**

* “Remove key from this device”.

**Image viewer**: tapping any image opens it in a **new tab** (full size).

# Rendering models & call strategy

* **Analysis**: `POST v1beta/models/gemini-2.5-flash:generateContent`

  * `contents`: user text prompt (spec below) + **inlineData** image (base64, ≤2048 px long side).
  * `generationConfig`:

    * `responseMimeType: "application/json"`
    * `responseSchema: ANALYSIS_SCHEMA` (see “Strict JSON schema”).
* **Renders (gallery, A/B, hero)**: `gemini-2.5-flash-image` (image-to-image)

  * Inputs: original image + per-style/variant **prompt** from `render_gallery[]` (or templates below).
  * Concurrency: **5 at a time**.
  * Errors: per-tile retry button; analysis errors show a single toast with **Retry**.

**Timeouts & retries (Safe Defaults)**

* Analysis timeout **45s**; Render timeout **120s**.
* Retry up to **2×** on **429 / 5xx / network** with 500ms/1500ms backoff.
* **AbortController** cancels in-flight calls if a prior step changes.

# Prompts (finalized for MVP)

**Single-Analysis (user content)**
Use the version shared earlier (“ROLE: Interior design analyst for empty rooms…”) including context, inputs, and output rules.

* Language: **English**; units **meters**.
* Geometry: treat camera pose + envelope as fixed (unless scope=4).
* Return **only JSON** (no prose) because strict mode is used.

**Render templates**

* 10 styles: **Scandi, Japandi, Modern Minimal, Contemporary Cozy, Mid-Century, Industrial Soft, Boho, Rustic, Mediterranean, Art-Deco**.
* Base constraints for image-to-image: keep camera pose and room envelope; respect **intervention_scope**; reflect **palette_60_30_10** subtly; avoid logos/text; photorealistic lighting.
* A/B Mini: vary along `smart_mixed_axes.axisA` vs `axisB` as specified.
* Hero (3): Smart Mixed (A, B, and best-of-both).

# Strict JSON schema (analysis)

The approved **ANALYSIS_SCHEMA** (JSON Schema 2020-12) is part of the app and sent to Gemini in `responseSchema`.

* Required sections: `usage_candidates`, `photo_findings`, `palette_60_30_10`, `constraints`, `quick_wins`, `styles_top10`, `smart_mixed_axes`, `negative_prompts`, `safety_checks`, `render_gallery`.
* Exact enumerations & lengths enforced (e.g., `styles_top10` length **10**, `render_gallery` length **10**).
* `scale_guesses` allows `null` for width/depth/height with explicit `confidence`.

# UI & styling

* **Theme**: Dark **Plum–Peach**

  * `bg #392338`, `surface #3F2840`, `surface2 #462E49`, `text #EDEDED`, `textMuted #CFC7D2`, `accent #FFCFA4`, `accent2 #FF947F`, `cta #C1264E`.
* **Tailwind**: Play CDN; inline `tailwind.config` extends the above tokens; border radius `xl2`.
* **Components**: Header, HomeGrid, KeyBanner, ChatTimeline (cards listed above), Modals (Settings, Error).

# Error handling & edge cases

* **No key**: show BYOK banner with AI Studio link; block calls; everything else visible.
* **Low scale confidence**: show non-blocking warning; proceed.
* **Analysis invalid**: strict JSON mode prevents schema drift; if API error, show retry toast.
* **Gallery tile fails**: show per-tile error chip + Retry; other tiles continue.
* **Rate limit spikes**: rely on per-tile behavior + two backoff retries; no global pause in MVP.
* **Network loss**: calls fail; show retry.
* **Storage cap exceeded**: auto-purge oldest full-res renders (thumbs remain) + 30s undo.
* **Backtrack**: editing any earlier card **removes** later cards and cancels in-flight requests.

# Browser support

* **Mobile-priority**: Chrome (Android) and Safari (iOS) prioritized; desktop browsers “best effort” (latest Chrome/Edge/Firefox/Safari).
* Camera capture relies on `<input capture="environment">` (browser support varies; gracefully falls back to picker).

# Testing plan (high level, MVP)

* **Analysis Strict-JSON Harness** (in-browser):

  * Given a room photo and a valid hard-coded key, when calling analysis, then the response **parses** and **validates** against `ANALYSIS_SCHEMA` with Ajv → **PASS**.
  * Negative tests: extra fields → FAIL; wrong enum → FAIL; non-10 `styles_top10` length → FAIL.
  * Edge: `scale_guesses` `null` values + low confidence should **PASS**.

* **Prompt sanity**: snapshots of rendered prompts for each style to avoid accidental drift in future edits.

* **Render pipeline smoke**: with mocks (if key absent) ensure UI handles tiles loading, success, and per-tile failure states.

# Deployment

* **GitHub Pages**, single `index.html` entry (root), relative asset paths.
* Add `.nojekyll` to avoid Jekyll processing.
* Keep CSP meta in `index.html`.

# Iteration development process rules 

1. **Do exactly one prioritized task per iteration.** Before/after: run relevant checks (build/lint/tests or in-browser harness).
2. **When adding/updating tests**, include a brief “why this test matters” note to guide future changes.
3. **Before adding functionality**, search the codebase (ripgrep) to confirm it’s missing; if present, prefer **refactor** over re-implementation.
4. **After each iteration**, add a concise update to `docs/implementation-progress.md` (what changed, decisions, follow-ups).
5. **Prefer CI-friendly, non-interactive commands/reporters** where possible so runs can be automated later.