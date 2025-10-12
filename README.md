# Product overview

**MoodCanvas** is a client-only, iterative interior explorer. Users upload a main target photo of their room, optionally add a purpose and up to two style reference images, and drive an infinite generate–evaluate–continue loop that stays entirely in the browser. The application produces room briefs, 12-image iteration rounds, and a hi-res finalization workflow without requiring any backend infrastructure.

# Goals & non-goals

**Goals**

* Infinite IEC loop: upload base photo → review 12 variants per round → pick favourites and guidance → start the next round.
* Optional reference style transfer (0–2 references, order indicates weighting).
* Every variant call returns a single 1024×682 image together with a single-paragraph descriptor.
* Silent room brief (one-time): paragraph plus 3–5 bullet constraints, automatically updated if the purpose changes.
* Finalization: hi-res polish at 1536×1024 + build notes paragraph with compare/decide modal.
* Mobile-first layout, dark Plum–Peach theme, system sans typography.

**Non-goals (MVP)**

* No exports, backend sync, accounts or pricing integrations.
* No seed control, deduplication, or accessibility targets beyond semantic HTML.
* No consent gate; privacy messaging lives in the help copy.

# Architecture

* Pure client-side app suitable for GitHub Pages hosting.
* Models: `gemini-2.5-flash` (text) and `gemini-2.5-flash-image` (image).
* Local persistence only: BYOK key stored in `localStorage`; media held in-memory for the session (future work: IndexedDB hybrid store).
* Content Security Policy (loose MVP) via `<meta http-equiv="Content-Security-Policy">`.

# Core flow

1. **Setup** – Upload main room photo (JPG/PNG, capture friendly). Optional purpose and first-round guidance text. Up to two reference images (ordered for weighting).
2. **Room brief** – Single silent call against `gemini-2.5-flash`. Returns one paragraph plus 3–5 bullets that persist for the project until purpose changes.
3. **Iterations** – Each round generates 12 variants at 1024×682. Calls run with pool=6 concurrency. Variants stream in tile by tile, each tile exposing favourite toggle, optional per-favourite note input, retry button on failure, and “Use as final”.
4. **Generate bar** – Sticky bottom bar only appears once ≥1 favourite is active. Holds the running favourite count, quick guidance field, and “Generate Next Iteration” button.
5. **Finalization** – “Use as final” opens Compare & Decide modal. Candidate is regenerated at 1536×1024 with build notes paragraph. User can keep current or replace.
6. **Restart** – Hard reset clears generated rounds and favourites but preserves base inputs, room brief, and settings.

# Prompting

* **Room brief** – multi-line instruction emphasising envelope preservation, 60-30-10 palette, circulation guidance, lighting, and scale hints. Output: paragraph + 3–5 bullets.
* **Iteration** – Inputs include room brief text, purpose, global guidance, diversity hint, favourites + notes, base photo, optional references. Instruction ensures one image + one descriptor paragraph, envelope preservation, no text/logos.
* **Finalization** – Base photo + child image + references. Outputs single 1536×1024 render plus build notes paragraph (5–7 sentences) covering materials, palette accents, lighting, dimensional tips, and “avoid” reminders.

# Generation settings

* Default sampling: temperature `0.7`, topP `0.9`, topK `32`. Exposed in settings modal and stored locally.
* No per-round overrides; references remain sticky until replaced.

# Error handling

* Tile-level soft failures display retry action.
* Hybrid parser selects first image and first text part; if text missing, triggers mini text repair call.
* Missing image results in per-tile error state with retry option.
* Restart confirmation message clarifies what is preserved.

# Data handling

* Accepts JPG/PNG with EXIF orientation correction. Resizes uploads to ≤2048 px long edge at ~0.9 quality while retaining metadata.
* Reference ordering preserved; adjustments immediately update stored array.

# Security & privacy

* BYOK banner links to Google AI Studio and clarifies local key storage. Key persisted in `localStorage` and sent via `x-goog-api-key` header.
* CSP limits connections to the Gemini API and blocks external scripts/styles.

# UI structure

* Sticky header with app name, iteration tag, Settings and Restart buttons.
* Key banner appears until API key stored.
* Setup card (main photo, purpose, references, start button).
* Room brief card (auto generated content).
* Iteration stack (last two rounds expanded by default).
* Sticky generate bar, settings modal, restart confirmation, final compare modal.

# Testing plan

* Parser unit tests: missing image → error, missing text → auto repair, image + text → success.
* Resize utility tests ensure base64 round-trip behaviour for binary data.

# Development

* Tailwind utility CSS compiled with `npm run build:css` after HTML/JS updates.
* Run `npm test` regularly (Jest + jsdom).

