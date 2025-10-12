# Product overview

**MoodCanvas** is a **client-only** iteration studio for interior styling. Users upload a **main room photo**, optionally add the room's **purpose** and **up to two reference images**, and then explore an **infinite loop of 12-image suggestion rounds** powered by Google Gemini. Each round surfaces descriptors, supports favorite selection with per-image notes, and feeds that feedback into the next batch. Any image can be finalized as a **hi-res 1536×1024 render** with **build notes**, letting the user keep or replace the current hero.

# Goals & non-goals

**Goals (Iteration 2)**

- Infinite IEC loop: base photo → 12 suggestions → favorites & guidance → next round.
- Reference style transfer (0–2 sticky images, order-weighted).
- One call per variant returning a single image and descriptor paragraph.
- Silent **Room Brief** (paragraph + 3–5 bullets) that auto-updates on purpose changes.
- Finalization flow: hi-res re-gen + build notes with side-by-side keep/replace.
- Mobile-first Plum–Peach dark theme using Tailwind Play CDN.

**Non-goals (MVP)**

- No exports, accounts, pricing, seeds/deduplication, or accessibility guarantees yet.
- No backend; storage remains local-only.

# Architecture

- **Client-only web app** hosted on static infrastructure (e.g., GitHub Pages).
- **Models**: `gemini-2.5-flash` for text (room brief, descriptor repair) and `gemini-2.5-flash-image` for image variants/finalization.
- **Storage**: In-memory state for MVP; room brief/regeneration triggered on demand. (IndexedDB hooks reserved for later iteration.)
- **Key handling**: BYOK stored in `localStorage`, header `x-goog-api-key`.
- **Styling**: Tailwind Play CDN with Plum–Peach palette.

# UX flow

1. **Project setup**
   - Upload main photo (`≤2048px` long side, EXIF orientation respected).
   - Optional purpose + initial notes.
   - Optional 0–2 reference images (order represents weighting).

2. **Room Brief** (silent)
   - Generated once per purpose change; displays paragraph + 3–5 constraints.

3. **Iteration rounds**
   - Each round returns 12 variants (1024×682) with descriptor paragraph.
   - Sticky generate bar appears when ≥1 favorite selected.
   - Favorites reset between rounds; per-favorite notes feed into next prompt.
   - Diversity deck covers palette warmth, layout density, material emphasis, and lighting.
   - Pool=6 concurrency with per-tile retries.

4. **Finalization**
   - Any image can trigger hi-res re-gen (1536×1024) + build notes (5–7 sentences).
   - Side-by-side compare modal lets the user keep or replace the current final.

5. **Restart**
   - Clears generated rounds/favorites/final while preserving base photo, purpose, references, room brief, and sampling settings.

# Prompts

- **Room Brief**: concise guidance paragraph + bullet constraints (see `buildRoomBriefPrompt`).
- **Iteration variant**: includes room brief, purpose, global guidance, favorites, and diversity hint per tile.
- **Finalization**: strict visual match with build notes paragraph.

# Generation settings

- Global sampling defaults: `temperature 0.7`, `topP 0.9`, `topK 32` (tunable in settings modal).
- Gallery iterations: 12 × 1024×682.
- Finalization: 1536×1024.

# Error handling

- Per-tile retries when generation fails.
- Descriptor auto-repair via fallback text call if Gemini omits the paragraph.
- Restart confirmation ensures main inputs persist while clearing generated data.

# Development

- Run `npm test` (format → lint → dependency checks → unit tests) before commits.
- Tailwind styles live in `styles/app.css`; update via `npm run build:css` when adjusting classes.
- Specs for iteration progress live in `Iteration2Spec.md`; updates recorded in `docs/implementation-progress.md`.
