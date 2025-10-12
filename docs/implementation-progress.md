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

## 2025-10-03 (Iteration v2 rebuild)

- Replaced the chat-style workflow with the Iteration 2 spec: upload main room photo, optional purpose, and drag-sortable references feeding a silent room brief and 12-image iteration rounds.
- Implemented Gemini flash wrappers for room briefs, iterative variants, and hi-res finalization with hybrid parsing and text auto-repair, plus a diversity deck pool runner (6 concurrent).
- Added the new sticky generate bar, per-tile favorites with optional notes, restart flow, and final compare modal, keeping BYOK handling and sampling controls intact.
- Introduced unit tests for the flash-image parser to cover successful, missing-image, and text-repair scenarios.
