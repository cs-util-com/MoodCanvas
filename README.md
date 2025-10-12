# Product overview

**MoodCanvas** is a client-only interior mood boarder built for iterative interior exploration. A user uploads one **main target photo** of the room, optionally sets the **room purpose** and up to **two style references**, and then moves through an **infinite loop** of:

1. capturing a **silent room brief**,
2. generating **12 mood variants @ 1024×682** in parallel (pool of 6),
3. selecting favorites, adding guidance, and triggering the **next round**,
4. finalising any variant into a **hi-res 1536×1024 render** with **build notes** and a **side-by-side decision**.

Any generated image can be opened full size. A lightweight **Restart** keeps the base setup (photo, purpose, references, brief, settings) while clearing every round, favorite, and final.

All AI calls happen via **Google Gemini** with **Bring-Your-Own-Key** (BYOK); no backend exists. The entire workflow runs in-browser with IndexedDB persistence.

# Goals & non-goals

## Goals

* **Infinite IEC loop**: Photo → 12 variants → favorites/feedback → next round.
* **Sticky style references** (0–2) with drag ordering that influences prompt weighting.
* **One response per tile**: exactly one image plus one short descriptor paragraph.
* **Silent room brief**: generated once per project (and refreshed on purpose change) with a paragraph plus 3–5 constraint bullets.
* **Manual round advance**: the generate bar appears only after the user marks ≥1 favorite.
* **Finalisation workflow**: hi-res polish + build notes, compared against the current final with Keep/Replace controls.
* **Mobile-first, dark Plum–Peach palette**, system sans fonts, Tailwind Play CDN.

## Non-goals (MVP)

* No downloads/exports, no backend accounts, no pricing or shopping links.
* No seed/deduplication controls, no advanced accessibility guarantees yet.
* No cancellation mid-round (close the tab to abort).
* No more than two reference images, no automatic dedupe between rounds.

# Architecture

* **Client-only web app** served statically (GitHub Pages friendly).
* **Models**:
  * Text: `gemini-2.5-flash` for room brief generation and descriptor/build-note repairs.
  * Image: `gemini-2.5-flash-image` for iterative variants and hi-res finalisation.
* **Storage**: IndexedDB via the hybrid store (`projects`, `events`, `media`, `artifacts`). Caps: 150 MB per project, 600 MB global; LRU trimming removes full-res renders but keeps thumbs (30 s undo window handled via events).
* **Styling**: Tailwind Play CDN, no build step required for the runtime app.
* **CSP** (loose MVP) set via `<meta http-equiv="Content-Security-Policy">` in `index.html`.

# Core flow

1. **Start** – Upload the main target photo (JPG/PNG, EXIF orientation fixed, resized to ≤ 2048 px long edge). Optional purpose field and up to two reference images with drag ordering.
2. **Room brief** – Silent `gemini-2.5-flash` call returns a 60–90 word paragraph plus 3–5 bullet constraints. Purpose changes automatically trigger a new brief.
3. **Iteration N (12 tiles @ 1024×682)** –
   * Diversity deck ensures warm/cool palette, textile density, layout density, wood/metal, contrast, and day/evening lighting axes are covered.
   * Pool size = 6; tiles stream in as they finish. No global cancel. Per-tile retry for soft fails.
   * Prompt inputs: base photo, ordered references, room brief, purpose, global guidance snapshot, and the raw descriptors + optional notes from this round’s favorites.
4. **Favorites & feedback** – Favorites reset each round; only the actively selected favorites feed into the next prompt. All favorites accumulate in a gallery for reference.
5. **Finalisation** – Any tile can trigger hi-res 1536×1024 re-render plus 5–7 sentence build notes. A side-by-side overlay compares the candidate with the current final (Keep/Replace). Exactly one active final is retained.
6. **Restart** – Clears rounds, favorites, and the current final while preserving base setup (photo, purpose, references, room brief, settings).

# Prompts (concise)

* **Room brief** (`gemini-2.5-flash`): paragraph + 3–5 bullets including camera/envelope, 60-30-10 guidance, spacing heuristics, and layered lighting reminders.
* **Iteration variant** (`gemini-2.5-flash-image`): “Generate ONE updated interior variant at 1024×682. Keep camera & envelope. Transfer only style from references. Return ONE image and ONE short paragraph describing mood, key changes vs base, and 2–3 ideas for the next iteration. Avoid logos/text.”
* **Finalisation** (`gemini-2.5-flash-image`): “Produce ONE faithful high-res re-render at 1536×1024 (polish only, no new composition) and ONE short paragraph of Build Notes (5–7 sentences: materials/finishes, palette accents, lighting layers incl. evening, 1–2 dimensional tips in meters, avoid reminders).”

Missing descriptors/build notes trigger follow-up `gemini-2.5-flash` repair calls using the same context.

# Generation settings

* Global defaults: `temperature = 0.7`, `topP = 0.9`, `topK = 32` (user adjustable in settings for future iterations).
* Variant rounds: 12 images @ 1024×682. Finalisation: 1 image @ 1536×1024.

# Error handling

* **Per-tile soft fail** with Retry button.
* **Parser hybrid** for flash-image responses:
  * Take the first inline image and first text part.
  * Missing text ⇒ repair call (flash) for a replacement paragraph.
  * Missing image ⇒ mark tile error + Retry.
* **No cancel mid-round**; closing the tab aborts.
* **Restart confirm** prompt: “Clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?”

# Data handling

* **Imports**: Accept JPG/PNG, fix EXIF orientation, keep metadata (no stripping), resize to ≤ 2048 px long edge (quality ≈ 0.9). Store original + 512 px thumb.
* **Generated assets**: Variants stored at 1024 px plus thumb; finals at 1536 px plus thumb.
* **References**: Persisted and sticky until changed; order indicates weighting.

# Security & privacy

* **BYOK banner** explains the key is stored only locally and links to Google AI Studio.
* API key saved in `localStorage`, sent as `x-goog-api-key` header.
* CSP (loose) enforced via meta tag.
* Info lives in Help/README — no separate consent gate.

# UI structure

* Header with product name, settings button, restart.
* Key banner shown when no API key is stored.
* Main area stack: setup card, room brief card, favorites gallery, iterations (only last two rounds expanded), final card.
* Sticky bottom generate bar: start button for round one, otherwise a single-line guidance field plus “Generate next iteration” button (visible when ≥ 1 favorite).
* Modals: settings, restart confirm, final compare overlay. Full-view opens images in new tab.

# Testing plan

* Room brief generation persists a paragraph + bullets (non-empty).
* Given at least one favorite + guidance, the iteration engine spawns 12 tiles (pool=6), repairs missing text, and surfaces retry on image failure.
* Finalisation produces hi-res image + build notes and supports Keep/Replace decisions.
* Parser unit tests: image missing ⇒ error; text missing ⇒ repair; both present ⇒ OK.
* Storage caps: LRU removes oldest full-res renders while leaving thumbs.

# Development workflow

* Run `npm test` frequently; unit tests cover prompt builders, parser logic, diversity deck, pool helper, and image utilities.
* Tailwind uses CDN utilities — no build step for CSS during development.
* Serve `index.html` with a simple static server (e.g. VS Code Live Server) to test locally.
