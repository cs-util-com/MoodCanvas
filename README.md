# Product overview

**MoodCanvas Iteration Flow** is a **client-only** interior design assistant that runs entirely in the browser. A user uploads a **main target room photo** (JPG/PNG, camera capture supported), optionally sets a **room purpose**, adds up to **two reference style images**, and steps through iterative AI-assisted rounds. Each round delivers **12 interior variants at 1024×682** (generated in a pool of 6). The user chooses favorites, adds **global guidance** plus **optional per-favorite notes**, and manually triggers the next iteration. Any generated variant can be **finalized** into a **high-res 1536×1024 render** accompanied by **build notes**. Final renders are compared side-by-side so the user can keep or replace the active final image. A **restart** wipes generated content while keeping inputs, settings, and the silent room brief.

# Goals & non-goals

## Goals

- Support a continuous IEC loop: upload → 12 suggestions → favorites & feedback → next round.
- Allow 0–2 drag-sortable reference images that persist until changed.
- Bundle each variant response as **one image plus one short text descriptor**.
- Generate a **room brief** once per project (refresh when purpose changes) and append it to every prompt.
- Provide manual **finalization**: high-res re-render + build notes with a compare-and-decide workflow.
- Deliver a **mobile-first**, **dark Plum–Peach** themed UI with system sans typography.

## Non-goals (MVP)

- No exports, backend services, accounts, pricing, or shop integrations.
- No seed control, deduplication, or advanced accessibility targets in this iteration.

# Architecture

- **Client-only** web app hosted on GitHub Pages.
- **Models**:
  - `gemini-2.5-flash` for room briefs and descriptor repair.
  - `gemini-2.5-flash-image` for iteration variants and finalization.
- **Storage**: IndexedDB (via `idb`) using stores for `projects`, `events`, `media`, and `artifacts`.
  - Per-project cap **150 MB**, global cap **600 MB**. LRU removes only full-resolution renders; thumbnails remain with a 30s undo window.
- **Content Security Policy**: shipped via `<meta http-equiv="Content-Security-Policy">` inline with a loose MVP policy.

# Core UI flow

1. **Start** – Upload the main photo (long edge ≤ 2048 px) and optionally provide purpose, reference images (drag-sort), and initial guidance.
2. **Room brief (silent)** – One call to `gemini-2.5-flash` producing a paragraph plus 3–5 bullet constraints; regenerates automatically when the purpose changes.
3. **Iteration rounds** – Each round requests 12 variants at 1024×682 using a pool size of 6; tiles appear as soon as each finishes. Round prompts include the room brief, purpose, references (order-weighted), global guidance, and raw favorite descriptions (with optional notes). Round 1 exposes a start button; subsequent rounds surface a sticky generate bar once at least one favorite is chosen. Tiles support per-item retry on failure.
4. **Favorites & feedback** – Users mark favorites (selection resets each round but remains visible for reference) and may add per-favorite notes. Favorites feed directly into the next iteration prompt block alongside global guidance.
5. **Finalization** – Selecting "Use as final" launches a high-res regeneration (1536×1024) plus build notes (5–7 sentences). Results open in a compare modal to keep or replace the current final render.
6. **Restart** – Clears generated rounds, favorites, and final renders while preserving the base photo, purpose, references, room brief, and sampling settings.

Clicking any image opens it in a new tab at full resolution. The sticky generate bar provides a single-line guidance input, "Generate next iteration" button, and a Restart control.

# Prompt outlines

- **Room brief (flash)** – Produce one paragraph (60–90 words) plus 3–5 bullets capturing constraints, camera/envelope discipline, and core heuristics.
- **Iteration variant (flash-image)** – Inputs: base photo, 0–2 references (style transfer only), room brief, purpose, global guidance, raw favorite descriptions, and per-favorite notes. Instruct Gemini to return exactly one updated variant image (1024×682) and one short paragraph describing the mood, key changes, and 2–3 ideas for the next iteration.
- **Finalization (flash-image)** – Inputs: base photo, selected variant (strict target), references. Request a faithful 1536×1024 polish plus one paragraph of build notes (5–7 sentences covering materials, palette, lighting, and 1–2 dimensional tips in meters).

# Generation settings

- Global sampling defaults: `temperature 0.7`, `topP 0.9`, `topK 32`. Stored in localStorage and applied to every call.
- Iteration gallery size fixed at 1024×682; finalization renders at 1536×1024.

# Error handling

- Per-tile soft failures expose a retry button; no round-level cancel is available.
- Hybrid parser for `flash-image` responses:
  - Use the first image and first text segment.
  - If text is missing, run an automatic mini call to `gemini-2.5-flash` to repair the descriptor.
  - If the image is missing, mark the tile as failed and offer retry.
- Restart confirmation prompts: “Clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?”

# Data handling

- Accept JPG/PNG imports, correct EXIF orientation, and retain metadata.
- Resize inputs before upload (long edge ≤ 2048 px at ~0.9 JPEG quality).
- Persist originals plus 512 px thumbnails for inputs; store 1024 px variants (with thumbs) and 1536 px finals (with thumbs).
- References remain sticky until replaced; their order reflects weighting.

# Security & privacy

- **Bring Your Own Key** banner links to Google AI Studio and explains that the API key stays in the browser.
- Keys are stored in `localStorage` and added to requests via the `x-goog-api-key` header.
- Informational help replaces any consent gate.

# UI structure

- Header with app name and settings button.
- Key banner (visible when no API key is stored).
- Main area containing: project setup card, room brief summary, and a stack of iteration rounds (only the last two remain expanded).
- Sticky generate bar at the bottom once favorites exist.
- Modals: settings and restart confirmation; final compare overlay for high-res results.
- Full-screen image views open in a new browser tab.

# Testing plan

- Room brief generation persists paragraph and bullets and regenerates when the purpose changes.
- Iteration runs surface 12 tiles with descriptors, repairing missing text and exposing retry for missing images.
- Finalization yields a high-res render plus build notes and allows keep/replace against the current final.
- Parser utilities cover success, missing-image, and text-repair paths.
- Storage caps trigger LRU removal of oldest full-resolution renders while preserving thumbnails.
