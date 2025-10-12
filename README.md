# Product overview

MoodCanvas is a client-only, iterative interior design assistant. A user uploads one main room photo, optionally adds a purpose and up to two reference images, and explores rounds of twelve 1024×682 variants (pool size six). Favourites feed guidance into the next round, and any image can be finalized into a high-resolution 1536×1024 render with build notes via a side-by-side compare modal. Restarting clears generated rounds while keeping the base assets, brief, and settings.

# Goals and non-goals

**Goals**

- Infinite IEC loop: base photo → 12 variants → user guidance → next round.
- Sticky reference style transfer (0–2 images, ordered by weight).
- Each variant response returns one image plus a single descriptive paragraph.
- Silent room brief (one paragraph plus 3–5 bullets) regenerated on purpose change and appended to every prompt.
- Finalization flow provides hi-res regeneration with build notes and compare/replace controls.
- Mobile-first dark Plum–Peach UI with Tailwind Play CDN and no build step.

**Non-goals**

- No exports, pricing, accounts, seeds, or dedupe logic.
- No backend services; no accessibility targets yet.

# Architecture

- Pure client-side web app served statically (ideal for GitHub Pages).
- Gemini models: `gemini-2.5-flash` (room brief, descriptor repair) and `gemini-2.5-flash-image` (variants and hi-res).
- Storage is in-memory for generated rounds; browser APIs provide object URLs for images.
- CSP delivered via meta tag in `index.html`.
- Tailwind Play CDN provides styling tokens; no bundlers.

# Core flow

1. **Prepare session** – Upload main photo (EXIF orientation respected, resized to ≤2048px, metadata preserved), add optional purpose, initial notes, and up to two drag-sortable references.
2. **Room brief** – One-time Gemini text call generating a paragraph plus 3–5 constraint bullets; regenerates when purpose or initial notes change.
3. **Iteration rounds** – Twelve variants generated concurrently (pool=6) using diversity hints. Tiles display once ready, support favourite toggles, descriptor details, optional notes, retry on failure, and open full-size in a new tab.
4. **Guidance bar** – Appears once at least one favourite exists; user enters one-line guidance and launches the next round (favourites reset afterwards but their descriptors feed the prompt).
5. **Finalization** – Any tile can be finalized to a 1536×1024 image with build notes, displayed beside the current final for keep/replace decisions.
6. **Restart** – Clears generated rounds, favourites, and final render, retaining base photo, purpose, references, brief, and sampling settings.

# Prompt strategy

- **Room brief** – Injects purpose and first-round notes, requesting one paragraph plus 3–5 actionable bullets drawn from curated constraint hints.
- **Iteration variant** – Assembles room brief, purpose, global guidance, raw favourite descriptors, and diversity hint into a single prompt; requires one image and one paragraph response.
- **Finalization** – Instructs Gemini to polish the candidate at 1536×1024 and produce 5–7 sentence build notes covering materials, palette, lighting, and dimensional tips.
- Missing descriptors trigger an automatic describe call using `gemini-2.5-flash` to maintain a single-paragraph summary.

# Generation settings

- Default sampling: temperature 0.7, topP 0.9, topK 32 (editable via settings modal, persisted in `localStorage`).
- Pool size: 6 concurrent variant jobs per round.

# Error handling

- Per-tile retry on generation failure.
- Parser ensures first image and text are captured; missing text invokes the describe fallback.
- Missing API key prompts the settings modal; restart confirms before clearing rounds.

# Data handling

- Input and reference images resized to ≤2048 px long edge (quality ≈0.9); thumbnails created for previews.
- References remain until removed or reordered; order conveys style weighting.
- Favourites recorded per round; notes accompany favourites and flow into prompts while selected.

# UI structure

- Header with key status and settings.
- Prepare session card with photo inputs, purpose, notes, and references.
- Room brief card showing paragraph plus bullet constraints.
- Iterations stack showing only the two latest rounds expanded by default.
- Sticky generate bar with guidance input and selected count.
- Settings modal for key management and sampling controls.
- Final compare overlay for hi-res candidate vs current final.

# Testing plan

- Utility coverage: prompt builders, diversity deck, iteration runner concurrency, and Gemini client parser/fallback.
- Image helpers validate base64 round-trips and future-proof for resizing logic.
- Manual smoke test: upload photo, add references, run rounds, retry a tile, finalize an image, restart session.
