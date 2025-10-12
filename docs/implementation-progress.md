# Implementation progress — MoodCanvas

## 2024-11-24

- Bootstrapped the client-only MoodCanvas application shell with Tailwind Play CDN and dark Plum–Peach theme.
- Implemented local BYOK handling, IndexedDB project store, and sequential chat-like timeline for the room design workflow.
- Added prompt builders, Gemini client integration scaffolding, and unit tests covering prompt generation utilities.
- Persisted project media/artifacts locally and wired gallery, A/B, and hero render cards with concurrency scaffolding.

## 2025-10-02

- Fixed Gemini client fetch invocation to run within the browser global context, resolving the "Illegal invocation" runtime error when running analysis.
- Added a unit test ensuring the client binds the fetch implementation correctly to prevent regressions.
- Sanitized the analysis response schema to match Gemini's structured output format and added regression tests to block unsupported keywords.
- Relaxed the analysis response schema constraints to keep Gemini structured output under the serving complexity limits and updated the related unit test.
- Tweaked the scale guess fields to rely on Gemini-supported nullable numbers while keeping numeric bounds out of the schema.
- Further simplified the structured-output schema (removed enums and nested `required` lists) to avoid Gemini's "too many states" errors.

## 2025-10-02 (palette selection)

- Added a selectable 60-30-10 palette chooser that surfaces five options and gates the style gallery until a palette is confirmed.
- Extended the analysis schema and gallery prompt builder to accept palette overrides, including new tests for the override behavior.
- Implemented palette synthesis helpers to generate fallback palette variations when the analysis response does not provide five distinct options.

## 2025-10-02 (palette diversity upgrade)

- Reworked palette option synthesis to operate in HSL space and inject stronger hue/saturation shifts plus complementary fallbacks so the five palettes feel distinct.
- Extracted the palette helpers into their own utility module and updated the app shell to consume the shared logic.
- Added extensive unit coverage for edge cases (invalid hex values, provided-only palettes, grayscale inputs) to keep the global coverage gate above 90%.

## 2025-10-04 (Iteration loop overhaul)

- Replaced the analysis-first workflow with the Iteration 2 spec: single photo ingest, optional drag-sort references, silent room brief regeneration, and a 12-tile iterative gallery powered by a diversity deck.
- Added a sticky generate bar with guidance input that only appears once favorites are queued, plus modal compare-and-replace finalization using hi-res re-renders and build notes.
- Implemented Gemini iteration utilities (room brief, variant, finalization parsers) with resilient text auto-repair and a pool-based runner, backed by unit tests covering parser edge cases and prompt construction.
- Updated the silent room-brief prompt to match the Iteration 2 spec block format, including explicit input listings and constraint hints.
- Converted the initial "Start" control into a dual-purpose restart button that clears generated iterations per spec, and we now reset queued favorites as soon as a new round begins so the next selection cycle starts cleanly.

## 2025-10-12 (gallery layout tweak)

- Expanded the iteration timeline container to the full viewport width, forced iteration tiles into a single-column grid, and switched the preview frames to a 3:2 aspect ratio so each render scales tall enough to fill the available space on every screen size.

## 2025-10-12 (tile details toggle)

- Replaced the unused tile "Details" button with a click-to-expand description that shows only a short preview by default and reveals the full copy plus user notes on demand, reducing visual noise while keeping the annotation flow intact.

## 2025-10-12 (room structure guardrails)

- Clarified iteration, gallery, and finalization prompts so Gemini keeps walls, openings, and ceiling heights fixed to the source photo.
- Documented that reference images serve style cues only and must not influence room geometry.
- Added unit test expectations around the new guardrail language to prevent regressions.

## 2025-10-12 (first-run focus)

- Moved the first-iteration launch control into its own post-brief section so the "Start generating" button lives directly beneath the Silent Room Brief card.
- Hid the generate-next-iteration bar until the first gallery exists and stopped mounting the compare-final modal until a hi-res candidate is available, keeping the pre-run UI minimal.
- Added layout/unit tests that lock in the new control order and lazy modal creation to catch regressions.

```

```
