# Product overview

Client-only Web-App (plain HTML+JS, Tailwind Play CDN, kein Build). User lädt **Main Target Photo** (Raumfoto) hoch, optional **Raumzweck** + **bis zu 2 Referenzbilder** (Stil, Reihenfolge = Gewichtung). App erzeugt **iterativ** rundenweise **12 Varianten @ 1024×682** (Pool=6). Nutzer wählt Favoriten, gibt **globalen Freitext** + **optionale Mini-Notizen je Favorit**, startet **manuell** die nächste Runde. Beliebiges Bild kann in Großansicht **finalisiert** werden: **Hi-Res Re-Gen @ 1536×1024 + Build Notes**; Vergleich **Side-by-Side** mit aktuellem Final (Keep/Replace). **Restart** löscht nur generierte Runden/Bilder/Favoriten/Final (Main-Foto, Zweck, Referenzen, Room Brief, Settings bleiben).

# Goals / Non-goals

**Goals**

* Unendlicher IEC-Loop: Foto → 12 Vorschläge → Favoriten/Feedback → nächste Runde.
* Referenz-Stiltransfer (0–2 Bilder, sticky bis geändert).
* **Ein Call pro Variante**: Bild **+** kurzer **Freitext-Descriptor** (ein Absatz) im selben Response.
* **Room Brief (silent)**: 1× pro Projekt (Foto+Zweck), kurzer Absatz + 3–5 Bullets, automatisch an jeden Prompt angehängt; bei Zweck-Änderung neu erzeugen.
* **Finalisierung**: Hi-Res Re-Gen + Build Notes (5–7 Sätze) + Compare & Decide.
* Mobile-first; Dark Theme „Plum–Peach“; system-sans.

**Non-goals (MVP)**

* Keine Exporte, kein Backend/Accounts, keine Preise/Shop-Links, keine Seeds/Dedupe, keine Accessibility-Ziele (später).

# Architecture

* **Rein clientseitig**, Hosting: **GitHub Pages**.
* **Models**:

  * Text: `gemini-2.5-flash` (Room Brief, Fallback-Descriptor).
  * Bild/Text: `gemini-2.5-flash-image` (Varianten, Final-Re-Gen + Build Notes).
* **Storage**: IndexedDB via `idb` (Hybrid):

  * `projects`, `events` (timeline), `media` (input, renders, thumbs), `artifacts` (roomBrief, descriptors).
  * Caps: per Projekt 150 MB, global 600 MB; LRU löscht nur Full-Res, Thumbs bleiben (undo 30 s).
* **CSP (loose MVP)** in `<meta http-equiv="Content-Security-Policy">` wie zuvor festgelegt.

# Core flow (UI)

1. **Start**
   Upload Main Target Photo → Button **Start generating first suggestions** erscheint (bleibt später als **Restart** für Hard-Reset). Optional: Zweck (Text/Chip), 0–2 Referenzen (drag-sort), Guidance (Text).

2. **Room Brief (silent, 1×)**
   `gemini-2.5-flash`, Output: 1 Absatz (60–90 Wörter) + 3–5 Bullets (Constraints). Bei Zweck-Änderung automatisch neu erzeugen.

3. **Iteration N (12 Varianten @ 1024×682)**

   * **Generate-Leiste (sticky bottom)** erscheint erst, wenn ≥1 Favorit gewählt ist (ab Runde 2), in Runde 1 ist ein **Start**-Button sichtbar.
   * Inputs je Runde: Room Brief, Zweck, sticky Referenzen (reihenfolge-gewichtet), globaler Freitext, **alle Favoriten-Beschreibungen 1:1** dieser Runde (+ optionale per-Favorit-Notizen).
   * **Diversity (intern)**: Balanced Achsen-Deck (Palette warm/kühl, Textilanteil, Layoutdichte, Holz/Metall, Kontrast, Licht Tag/Abend).
   * **Parallelisierung**: Pool=6, Tiles erscheinen as-they-finish. **Kein Cancel**. Per-Tile **Retry** bei Fehler.

4. **Bewertung**
   Kacheln mit „Details anzeigen“ (Descriptor standardmäßig verborgen). Favoriten sind **kumulativ verfügbar**, aber **nach jeder Runde resetten wir die Auswahl** (User wählt aktiv, was in die nächste Runde einfließt).

5. **Finalisierung**
   Großansicht → **Use as final**: ein Call erzeugt **Hi-Res 1536×1024 + Build Notes** (5–7 Sätze). **Compare & Decide** gegen aktuelles Final: Keep/Replace (genau 1 aktives Final).

6. **Restart (Hard Reset)**
   Löscht alle generierten Runden/Bilder/Favoriten/Final; **behält** Main-Foto, Zweck, Referenzen, Room Brief, Settings.

**Bildanzeige**: Klick öffnet **in neuem Tab** (full size).
**Generate-Bar (minimal)**: einzeiliges Textfeld + Button „Generate Next Iteration“ (erscheint, wenn ≥1 Favorit).

# Prompts (concise)

**Room Brief (flash, 1×)** – Absatz + 3–5 Bullets; enthält unsere Best-Practice-Heuristiken (Kamera/Envelope fix, 60-30-10, Abstände, Lighting).

**Iteration-Variante (flash-image, pro Bild)**

* Inputs: base room photo (fix), 0–2 reference images (Style only), RoomBrief-Text, Zweck, global guidance, **raw favorite descriptions** (+ per-favorite notes).
* Instruktion: „Generate ONE updated interior variant at 1024×682. Keep camera & envelope. Transfer only style from references. Return ONE image and ONE short free-text paragraph (single paragraph) describing mood, key changes vs base, and 2–3 ideas for the next iteration. Avoid logos/text.“

**Finalization (flash-image, 1×)**

* Inputs: base room photo, selected child image (strict visual target), sticky references.
* Instruktion: „Produce ONE faithful high-res re-render at 1536×1024 (polish only, no new composition) and ONE short paragraph of Build Notes (5–7 sentences: materials/finishes, palette accents, lighting layers incl. evening, 1–2 dimensional tips in meters, avoid reminders).“

# Generation settings

* **Global (Settings)**: `temperature 0.7`, `topP 0.9`, `topK 32` (änderbar, global).
* Per Runde **keine** Overrides.
* Galerie/Iterationen: 12× @ 1024×682; Final-Re-Gen @ 1536×1024.

# Error handling

* **Per-Tile soft fail** mit Retry.
* **Parser Hybrid (flash-image)**:

  * Nimm **erstes** Bild + **ersten** Text.
  * **Text fehlt** → Mini-Text-Call (flash) zur Ein-Absatz-Beschreibung (auto-repair).
  * **Bild fehlt** → Tile-Fehler + Retry.
* **Kein Cancel** während Runde; Abbruch via Tab schließen (bewusst einfach).
* **Restart Confirm**: „Clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?“

# Data handling

* Import: JPG/PNG, EXIF-Orientierung korrigieren, **Metadaten nicht strippen** (MVP), vor Upload auf **≤ 2048 px** lange Kante (q≈0.9).
* Speichern: Original + 512px-Thumb (input); Varianten @1024 + Thumb; Final @1536 + Thumb.
* **Referenzen sticky** bis geändert; Reihenfolge = Gewichtung (drag-sort).

# Security & privacy

* **BYOK-Banner**: Link zu AI Studio; „Key wird nur im Browser gespeichert“. Key in `localStorage`, Header `x-goog-api-key`.
* **CSP** wie festgelegt.
* Hinweis in Help statt Consent-Gate.

# UI structure (ohne Build)

* Header (Name, Settings), Key-Banner (wenn kein Key), Main Area (Runden-Stack; nur letzte 2 offen), Sticky Generate-Bar, Modals (Settings, Restart confirm), Full-view (neuer Tab), Final-Compare (Side-by-Side Overlay).

# Testing plan (MVP)

* **Given** base photo + optional purpose/refs, **When** Room Brief call runs, **Then** we persist paragraph+bullets (non-empty).
* **Given** at least 1 favorite + guidance, **When** 12 calls (pool=6) run, **Then** each tile shows first image + first paragraph or a per-tile retry (and auto-repair adds text if missing).
* **Given** a selected child, **When** finalization runs, **Then** hi-res image + Build Notes paragraph appear; **Compare & Decide** replaces or keeps current Final.
* Parser unit tests: image-missing → error; text-missing → repair; both present → OK.
* Storage caps LRU removes oldest full-res renders, thumbs preserved.

# Iterative plan (bottom-up, one task per iteration)

**Regeln**: (1) exakt **eine** priorisierte Änderung pro Iteration; (2) Tests mit kurzem „why this test matters“; (3) vor Implementierung Codebasis durchsuchen (prefer refactor); (4) nach jeder Iteration Update in `docs/implementation-progress.md`; (5) CI-freundliche, non-interactive Runs.

### I1 — Key & Theme baseline

* Build: Header, Tailwind config (Plum–Peach), Key-Banner, Settings (Remove key).
* Tests: key save/remove; theme tokens render.

### I2 — Image ingest (main photo + refs)

* `<input accept="image/jpeg,image/png" capture="environment">`, EXIF-Fix, resize ≤2048, thumb 512.
* Refs: max 2, drag-sort.
* Tests: ingest + thumb; order persists.

### I3 — Room Brief (silent)

* `gemini-2.5-flash` call; store paragraph+bullets; auto-regen on purpose change.
* Tests: non-empty brief; purpose change triggers new brief.

### I4 — Iteration engine (12× @1024, pool=6)

* Call wrapper `flash-image`; sticky Generate-Bar appears per rules; no cancel.
* Parser Hybrid + per-tile Retry.
* Tests: 12 tiles appear; missing text auto-repaired; missing image → retry UI.

### I5 — Favorites & feedback

* Favorite selection resets each round; global guidance field; optional per-favorite notes.
* Tests: only actively selected favorites flow into next prompt.

### I6 — Diversity deck (internal)

* Axis coverage injection across 12 subprompts.
* Tests: ensure coverage mapping created per round (unit).

### I7 — History UX

* Auto-collapse older rounds; only last 2 open.
* Tests: DOM state across >2 rounds.

### I8 — Finalization

* Full-view → Use as final → Hi-Res 1536 + Build Notes; **Compare & Decide** (Keep/Replace).
* Tests: candidate vs current final swap; build notes non-empty.

### I9 — Restart (Hard Reset)

* Confirm dialog; clear generated rounds/bilder/favorites/final; keep base, purpose, refs, room brief, settings.
* Tests: state cleared/preserved as specified.

### I10 — Settings: Sampling (global)

* temperature/topP/topK sliders; reset-to-defaults.
* Tests: settings persist + used in calls.


---

# 1) Prompt blocks 

## A) Room Brief (silent, 1× per project)

**Model:** `gemini-2.5-flash` (text only)
**Response:** plain text = one short paragraph (≈60–90 words) + **3–5 bullets** (one line each)

```
ROLE: Create a concise, practical “room brief” for interior styling iterations.

INPUTS:
- Base room photo (camera pose and architectural envelope must be preserved)
- Intended use: <USER_PURPOSE or "None">
- Notes from user (optional): <USER_NOTES or "None">

OUTPUT FORMAT (plain text only, no headings, no markdown):
1) One paragraph (~60–90 words) summarizing the room’s light, openings, proportions and key opportunities/risks, with the intended use as priority.
2) Then 3–5 bullets (one line each) of strict constraints/guidelines.

CONSTRAINT HINTS (pick only what’s relevant; do not list all):
• Keep camera pose & envelope; no structural changes unless explicitly asked later.
• 60–30–10 color planning (dominant–secondary–accent).
• Circulation clearance ~0.9 m in main paths; avoid cluttered layouts.
• Sofa–table reach ≈0.35–0.45 m OR desk depth ≥0.60 m depending on use.
• Rug sizing: front legs of seating on rug; workspace rug fully under chair.
• Curtains: rod 10–15 cm above head; total width ≈2× opening.
• Layered lighting: ambient + task + accent; evening ~2700–3000 K.
• If scale is uncertain, keep dimensions conservative and mention low confidence.
Avoid logos/text and unrealistic geometry.
```

**Parts:**

* `{ text: <the block above with placeholders filled> }`
* `{ inlineData: { mimeType, data: <BASE64_MAINPHOTO> } }`

---

## B) Iteration variant (12× per round @1024×682)

**Model:** `gemini-2.5-flash-image`
**Response:** **exactly one image** + **one short paragraph** (single paragraph)

```
Use the attached base room photo as fixed camera pose and architectural envelope.
If reference images are attached, transfer only their style (palette, textures, furniture mood, lighting mood)—not geometry.
Consider the following guidance:
• Room brief (silent): <ROOM_BRIEF_TEXT>
• Intended use: <USER_PURPOSE_SHORT>
• User’s global guidance for this round: <ROUND_GUIDANCE or "None">
• Selected favorites (as free-text, raw): <FAVORITES_TEXT_BLOCK>

Diversity hint for this image: <DIVERSITY_SUBPROMPT>  // e.g., “warmer palette, softer contrast” (internal axis deck)

Generate ONE updated interior variant at 1024×682. Preserve perspective and room envelope.
Return ONE image and ONE short free-text paragraph (single paragraph) describing the mood, the key changes vs the base, and 2–3 ideas for the next iteration. Avoid logos/text.
```

**Parts order:**

1. `{ text: <the block above> }`
2. `{ inlineData: { mimeType, data: <BASE64_MAINPHOTO> } }`
3. (optional) `{ inlineData: { mimeType, data: <BASE64_REFERENCE_1> } }`
4. (optional) `{ inlineData: { mimeType, data: <BASE64_REFERENCE_2> } }`

> **Weighting:** the **first** reference is the main style, the second is an accent (as per our spec). Phrase it subtly in your `ROUND_GUIDANCE` if you like: “favor first reference; second is accent only”.

---

## C) Finalization (Hi-Res Re-Gen + Build Notes)

**Model:** `gemini-2.5-flash-image`
**Response:** **one hi-res image (1536×1024)** + **one paragraph of Build Notes (5–7 sentences)**

```
Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target.
Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition).
Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any “avoid” reminders. Avoid logos/text.
```

**Parts order:**

1. `{ text: <the block above> }`
2. `{ inlineData: { mimeType, data: <BASE64_MAINPHOTO> } }`
3. `{ inlineData: { mimeType, data: <BASE64_SELECTED_CHILD> } }`
4. (optional) references (same order logic)

---

# 2) Minimal API wrappers (plain JS)

> These are drop-in ES-module style snippets you can put in `/js/api.js`.
> Uses header `x-goog-api-key`. No auto-retries (per your choice). Pool=6 handled below.

```js
// --- Config ---
export const GEMINI_TEXT_MODEL  = "gemini-2.5-flash";
export const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_SAMPLING = { temperature: 0.7, topP: 0.9, topK: 32 };

// Key helpers (you already store in localStorage)
export const getKey = () => (localStorage.getItem("gemini_api_key") || "").trim();

// --- Core fetch ---
async function gemFetch(model, body) {
  const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": getKey() },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`gemini_${model}_http_${res.status}`);
  return res.json();
}

// --- Utilities to build parts ---
export const inlinePart = (mimeType, base64) => ({ inlineData: { mimeType, data: base64 } });
export const textPart   = (text) => ({ text });

// --- Room Brief (silent) ---
/**
 * @param {Object} p
 * @param {string} p.promptText - final prompt text block (A)
 * @param {string} p.base64Main  - base64 of main room image (<=2048px long side)
 * @param {string} p.mimeMain    - "image/jpeg" or "image/png"
 * @returns {Promise<{paragraph:string, bullets:string[] , raw:string}>}
 */
export async function generateRoomBrief({ promptText, base64Main, mimeMain }) {
  const body = {
    contents: [{ parts: [ textPart(promptText), inlinePart(mimeMain, base64Main) ] }],
    generationConfig: { ...DEFAULT_SAMPLING }
  };
  const json = await gemFetch(GEMINI_TEXT_MODEL, body);
  const raw = (json?.candidates?.[0]?.content?.parts || [])
                .map(p => p.text).filter(Boolean).join("\n").trim();
  if (!raw) throw new Error("room_brief_empty");

  // Parse: first paragraph + 3–5 bullets (plain text)
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const paragraph = lines[0] || "";
  const bullets = lines.slice(1).map(s => s.replace(/^[•\-–]\s?/, "")).filter(Boolean);
  return { paragraph, bullets, raw };
}

// --- Iteration: single variant (image + 1 paragraph) ---
/**
 * @param {Object} p
 * @param {string} p.promptText - final prompt text block (B) with guidance and diversity hint injected
 * @param {string} p.base64Main
 * @param {string} p.mimeMain
 * @param {Array<{mime:string,base64:string}>} [p.references] - up to 2, in order
 * @param {Object} [p.sampling] - temperature/topP/topK
 * @returns {Promise<{imageUrl:string, text:string, warnings:string[]}>}
 */
export async function generateVariant({ promptText, base64Main, mimeMain, references = [], sampling = DEFAULT_SAMPLING }) {
  const parts = [ textPart(promptText), inlinePart(mimeMain, base64Main) ];
  references.forEach(ref => parts.push(inlinePart(ref.mime, ref.base64)));

  const body = { contents: [{ parts }], generationConfig: { ...sampling } };
  const json = await gemFetch(GEMINI_IMAGE_MODEL, body);
  return await parseFlashImageResponse(json); // see parser below
}

// --- Finalization: hi-res + build notes ---
/**
 * @param {Object} p
 * @param {string} p.promptText - finalization block (C)
 * @param {string} p.base64Main
 * @param {string} p.mimeMain
 * @param {string} p.base64Child
 * @param {string} p.mimeChild
 * @param {Array<{mime:string,base64:string}>} [p.references]
 */
export async function finalizeHiRes({ promptText, base64Main, mimeMain, base64Child, mimeChild, references = [], sampling = DEFAULT_SAMPLING }) {
  const parts = [ textPart(promptText), inlinePart(mimeMain, base64Main), inlinePart(mimeChild, base64Child) ];
  references.forEach(ref => parts.push(inlinePart(ref.mime, ref.base64)));

  const body = { contents: [{ parts }], generationConfig: { ...sampling } };
  const json = await gemFetch(GEMINI_IMAGE_MODEL, body);
  return await parseFlashImageResponse(json); // image + paragraph
}
```

### Robust parser + mini text-repair (as agreed)

*(Drop this into the same module; identical policy we just finalized.)*

```js
export async function parseFlashImageResponse(json) {
  const out = { imageUrl: null, text: "", warnings: [] };
  const cand = json?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  for (const p of parts) {
    if (!out.imageUrl && p.inlineData && /^image\//i.test(p.inlineData.mimeType || "")) {
      const b64 = p.inlineData.data || p.inlineData.bytes || "";
      out.imageUrl = URL.createObjectURL(base64ToBlob(b64, p.inlineData.mimeType));
    }
    if (!out.text && typeof p.text === "string" && p.text.trim()) out.text = p.text.trim();
    if (out.imageUrl && out.text) break;
  }
  if (!out.imageUrl) throw new Error("no_image_in_response");
  if (!out.text) { out.warnings.push("auto-fixed: descriptor missing"); out.text = await autoDescribeFromBlobUrl(out.imageUrl); }
  return out;
}

async function autoDescribeFromBlobUrl(imageUrl) {
  const blob = await (await fetch(imageUrl)).blob();
  const b64 = await blobToBase64(blob);
  const body = {
    contents: [{
      parts: [
        { text: "Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for next iteration). Avoid lists, headings or markdown." },
        { inlineData: { mimeType: blob.type || "image/jpeg", data: b64 } }
      ]
    }],
    generationConfig: { temperature: 0.7 }
  };
  const json = await gemFetch(GEMINI_TEXT_MODEL, body);
  const txt = (json?.candidates?.[0]?.content?.parts || []).map(p => p.text).filter(Boolean).join(" ").trim();
  if (!txt) throw new Error("mini_text_call_empty");
  return txt;
}

// tiny utils
function base64ToBlob(b64, mime) {
  const bin = atob(b64); const len = bin.length; const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime || "application/octet-stream" });
}
async function blobToBase64(blob) {
  const ab = await blob.arrayBuffer(); const bytes = new Uint8Array(ab);
  let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  return btoa(binary);
}
```

---

# 3) Diversity deck & batch runner

## A) Internal diversity deck (balanced, 12 hints)

Use one hint per image (you can permute each round):

```js
export function diversityDeck() {
  return [
    "slightly warmer palette; gentler contrast",
    "slightly cooler palette; crisper contrast",
    "increase textile presence; softer layering",
    "reduce textiles; cleaner lines, fewer throws",
    "airier layout with more negative space",
    "denser, cozier seating cluster",
    "wood-forward materials; minimize metal",
    "metal accents slightly emphasized; reduce wood",
    "soft evening lighting (~2700–3000K), cozy ambience",
    "neutral daytime lighting (~4000–4500K), clear ambience",
    "tone-on-tone, low-contrast composition",
    "bolder accents; stronger figure-ground definition"
  ];
}
```

## B) Build the iteration prompt text (per image)

```js
export function buildIterationPrompt({ roomBrief, purpose, roundGuidance, favoritesTextBlock, diversityHint }) {
  return [
    "Use the attached base room photo as fixed camera pose and architectural envelope.",
    "If reference images are attached, transfer only their style (palette, textures, furniture mood, lighting mood)—not geometry.",
    "Consider the following guidance:",
    `• Room brief (silent): ${roomBrief || "None"}`,
    `• Intended use: ${purpose || "None"}`,
    `• User’s global guidance for this round: ${roundGuidance || "None"}`,
    `• Selected favorites (as free-text, raw): ${favoritesTextBlock || "None"}`,
    "",
    `Diversity hint for this image: ${diversityHint || "None"}`,
    "",
    "Generate ONE updated interior variant at 1024×682. Preserve perspective and room envelope.",
    "Return ONE image and ONE short free-text paragraph (single paragraph) describing the mood, the key changes vs the base, and 2–3 ideas for the next iteration. Avoid logos/text."
  ].join("\n");
}
```

## C) Pool runner (6 concurrent), per-tile errors are surfaced to the UI

```js
export async function runIterationBatch({
  base64Main, mimeMain, references, roomBrief, purpose, roundGuidance,
  favoritesTextBlock, sampling, onProgress
}) {
  const deck = diversityDeck(); // 12
  const tasks = deck.map((hint, idx) => async () => {
    const promptText = buildIterationPrompt({ roomBrief, purpose, roundGuidance, favoritesTextBlock, diversityHint: hint });
    try {
      const result = await generateVariant({ promptText, base64Main, mimeMain, references, sampling });
      onProgress?.({ index: idx, ok: true, result });
    } catch (err) {
      onProgress?.({ index: idx, ok: false, error: err });
    }
  });
  await pool(tasks, 6);
}

async function pool(taskFns, size) {
  let i = 0;
  const running = new Set();
  async function runNext() {
    if (i >= taskFns.length) return;
    const fn = taskFns[i++]; const p = fn().finally(() => running.delete(p));
    running.add(p);
    if (running.size < size) await runNext();
  }
  const starters = Math.min(size, taskFns.length);
  for (let k = 0; k < starters; k++) await runNext();
  await Promise.allSettled([...running]);
}
```

---

# 4) Finalization prompt builder (hi-res @1536 + build notes)

```js
export function buildFinalizationPrompt() {
  return [
    "Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target.",
    "Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition).",
    "Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any 'avoid' reminders. Avoid logos/text."
  ].join(" ");
}
```

Usage:

```js
// references optional, same order logic (first = main style, second = accent)
const promptText = buildFinalizationPrompt();
const { imageUrl, text: buildNotes } = await finalizeHiRes({
  promptText, base64Main, mimeMain, base64Child, mimeChild, references, sampling: DEFAULT_SAMPLING
});
// imageUrl → candidate final (side-by-side compare), buildNotes → copy block
```

---

# 5) Tiny helpers you’ll likely want

```js
// Build a single block from selected favorites (1:1 text, no trimming, as decided)
export function favoritesToBlock(favs) {
  // favs = array of { descriptorText: string, userNote?: string }
  return favs.map((f, i) => {
    const note = f.userNote && f.userNote.trim() ? ` [note: ${f.userNote.trim()}]` : "";
    return `(${i+1}) ${f.descriptorText.trim()}${note}`;
  }).join(" ");
}

// Example: get ordered references (max 2) for the request
export function refsToArray(refs) {
  // refs = [{ mime:'image/jpeg', base64:'...' }, ...] already resized to <=2048 long side
  return (refs || []).slice(0, 2);
}
```

---

# Suggested implementation as a single-file demo

Here’s a **single-file demo `index.html`** 
It implements the new IEC flow: upload **Main Target Photo**, optional **purpose** & up to **2 reference images** (ordered), generate a **Room Brief** once, then iterate in **rounds of 12 variants @ 1024×682** (pool=6). 
Pick favorites, write a quick global note, hit **Generate Next Iteration** (sticky bar). Each tile returns **one image + one short paragraph**; details are collapsed by default; per-tile **Retry** supported. 
Finalization runs **Hi-Res @ 1536×1024 + Build Notes** with **Compare & Decide**. “Restart” clears generated rounds but keeps base photo, purpose, references, and room brief.

> Uses plain HTML+JS, Tailwind Play CDN. No build. BYOK via banner (stored in `localStorage`).
> You only need to paste your Gemini API key in the banner once.

!!Important!!
This demo html page cant be uses as is, e.g. it does not have the js code in separate files but it provides a good start to look at the code and apply it to the current v1. Its design  is also much worse then the current v1 design, there are no tests etc, so only use it to understand the goal of the v2. 

---

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MoodCanvas — Iterative Interior Explorer (Demo)</title>

<!-- CSP (loose MVP) -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  img-src 'self' blob: data:;
  connect-src https://generativelanguage.googleapis.com;
  script-src 'self' https://cdn.tailwindcss.com 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  object-src 'none'; frame-ancestors 'none'; base-uri 'self';
">

<!-- Tailwind Play CDN + theme -->
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: {
    colors: {
      bg:'#392338', surface:'#3F2840', surface2:'#462E49',
      text:'#EDEDED', textMuted:'#CFC7D2',
      accent:'#FFCFA4', accentOn:'#392338',
      accent2:'#FF947F', accent2On:'#392338',
      cta:'#C1264E', ctaOn:'#FFFFFF'
    },
    borderRadius: { xl2: '1.25rem' }
  }}};
</script>
<style>
  .chip { @apply text-xs px-2 py-1 rounded-full bg-surface2; }
  .btn  { @apply rounded-xl2 px-3 py-2 hover:opacity-90; }
  .btn-cta { @apply bg-cta text-ctaOn; }
  .btn-soft{ @apply bg-surface2 text-text; }
  .btn-ghost{ @apply text-text; }
  .grid-auto { display:grid; grid-template-columns: repeat(auto-fill, minmax(180px,1fr)); gap: .75rem; }
</style>
</head>

<body class="bg-bg text-text min-h-screen">
  <!-- Header -->
  <header class="sticky top-0 z-30 backdrop-blur bg-bg/70 border-b border-surface2">
    <div class="max-w-6xl mx-auto px-3 py-3 flex items-center gap-2">
      <h1 class="text-lg font-semibold">MoodCanvas</h1>
      <span class="chip">IEC Demo</span>
      <div class="ml-auto flex items-center gap-2">
        <button id="btn-restart" class="btn btn-soft" title="Restart (hard reset of generated rounds)">Restart</button>
        <button id="btn-settings" class="btn btn-soft" title="Settings">Settings</button>
      </div>
    </div>
  </header>

  <!-- Key Banner (BYOK) -->
  <section id="key-banner" class="hidden max-w-6xl mx-auto mt-3 px-3">
    <div class="rounded-xl2 border border-surface2 bg-surface p-4">
      <p class="mb-2">
        <strong>MoodCanvas</strong> — Get your key from
        <a class="underline text-accent" href="https://aistudio.google.com/app/api-keys" target="_blank" rel="noopener">Google AI Studio</a>.
        The key is stored only in your browser.
      </p>
      <div class="flex flex-col sm:flex-row gap-2">
        <input id="key-input" type="password" placeholder="Paste your Gemini API key"
               class="flex-1 bg-surface2 rounded-xl2 px-3 py-2 outline-none focus:ring-2 focus:ring-accent/60" />
        <button id="key-save" class="btn btn-cta">Save key</button>
      </div>
      <p class="text-sm text-textMuted mt-2">Tip: many Google keys start with <code>AIza</code>.</p>
    </div>
  </section>

  <!-- Settings Modal -->
  <div id="settings-backdrop" class="hidden fixed inset-0 z-40 bg-black/60"></div>
  <div id="settings-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
    <div class="w-full max-w-md rounded-xl2 bg-surface text-text shadow-lg border border-surface2">
      <div class="flex items-center justify-between px-4 py-3 border-b border-surface2">
        <h2 class="text-base font-medium">Settings</h2>
        <button id="settings-close" class="btn btn-ghost" aria-label="Close">✕</button>
      </div>
      <div class="px-4 py-4 space-y-4">
        <section>
          <h3 class="text-sm font-medium mb-1">Gemini API key</h3>
          <p id="key-status" class="text-sm text-textMuted mb-2">Checking…</p>
          <button id="btn-remove-key" class="btn btn-cta disabled:opacity-40" disabled>Remove key from this device</button>
        </section>
        <section class="pt-2 border-t border-surface2">
          <h3 class="text-sm font-medium mb-1">Sampling (global)</h3>
          <div class="text-sm text-textMuted">temperature <span id="t-val">0.7</span> • topP <span id="p-val">0.9</span> • topK <span id="k-val">32</span></div>
          <div class="mt-2 grid grid-cols-3 gap-2">
            <label class="text-xs">temperature
              <input id="s-temp" type="range" min="0" max="1" step="0.05" value="0.7" class="w-full">
            </label>
            <label class="text-xs">topP
              <input id="s-topp" type="range" min="0" max="1" step="0.05" value="0.9" class="w-full">
            </label>
            <label class="text-xs">topK
              <input id="s-topk" type="number" min="1" max="128" step="1" value="32" class="w-full bg-surface2 rounded-xl2 px-2 py-1">
            </label>
          </div>
          <button id="s-reset" class="btn btn-soft mt-2">Reset to defaults</button>
        </section>
      </div>
      <div class="px-4 py-3 border-t border-surface2 flex justify-end">
        <button id="settings-done" class="btn btn-soft">Close</button>
      </div>
    </div>
  </div>

  <!-- Main setup -->
  <main class="max-w-6xl mx-auto px-3 py-4 space-y-4">
    <!-- Setup card -->
    <section class="rounded-xl2 border border-surface2 bg-surface p-4">
      <h2 class="font-medium mb-2">1) Main Target Photo</h2>
      <input id="main-file" type="file" accept="image/jpeg,image/png" capture="environment"
             class="block w-full" />
      <div id="main-preview" class="mt-3"></div>

      <div class="mt-4 grid md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm text-textMuted">Intended use (optional)</span>
          <input id="purpose" class="mt-1 w-full rounded-xl2 px-3 py-2 bg-surface2" placeholder="e.g., Living Room, Home Office" />
        </label>
        <label class="block">
          <span class="text-sm text-textMuted">Notes for first round (optional)</span>
          <input id="first-notes" class="mt-1 w-full rounded-xl2 px-3 py-2 bg-surface2" placeholder="warm woods, soft textiles, cozy evening mood" />
        </label>
      </div>

      <div class="mt-4">
        <h3 class="font-medium">2) Reference images (optional, up to 2; first = main style)</h3>
        <div class="grid md:grid-cols-2 gap-3 mt-2">
          <div class="rounded-xl2 border border-surface2 p-3">
            <div class="text-sm text-textMuted mb-1">Reference #1 (main style)</div>
            <input id="ref1" type="file" accept="image/jpeg,image/png" class="block w-full" />
            <div id="ref1-preview" class="mt-2"></div>
          </div>
          <div class="rounded-xl2 border border-surface2 p-3">
            <div class="text-sm text-textMuted mb-1">Reference #2 (accent)</div>
            <input id="ref2" type="file" accept="image/jpeg,image/png" class="block w-full" />
            <div id="ref2-preview" class="mt-2"></div>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <button id="btn-first" class="btn btn-cta" disabled>Start generating first suggestions</button>
        <span id="first-hint" class="ml-2 text-sm text-textMuted">Upload the main photo to enable.</span>
      </div>
    </section>

    <!-- Iterations stack -->
    <section id="iterations"></section>
  </main>

  <!-- Sticky Generate Bar (hidden until ≥1 favorite selected) -->
  <div id="generate-bar" class="hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 border-t border-surface2">
    <div class="max-w-6xl mx-auto px-3 py-3 flex items-center gap-2">
      <div id="sel-count" class="text-sm text-textMuted">0 selected</div>
      <input id="round-guidance" class="flex-1 rounded-xl2 px-3 py-2 bg-surface2"
             placeholder="Quick instruction for next round (optional)" />
      <button id="btn-generate" class="btn btn-cta">Generate Next Iteration</button>
    </div>
  </div>

  <!-- Final compare modal -->
  <div id="final-backdrop" class="hidden fixed inset-0 z-50 bg-black/70"></div>
  <div id="final-modal" class="hidden fixed inset-0 z-50 p-4 overflow-auto">
    <div class="max-w-6xl mx-auto bg-surface rounded-xl2 border border-surface2 p-3">
      <div class="flex items-center justify-between">
        <h3 class="font-medium">Compare & Decide</h3>
        <button id="final-close" class="btn btn-ghost">✕</button>
      </div>
      <div class="grid md:grid-cols-2 gap-3 mt-3">
        <div>
          <div class="text-sm text-textMuted mb-1">Current Final</div>
          <img id="final-current" class="w-full rounded-xl2" />
          <p id="final-current-notes" class="text-sm text-textMuted mt-1"></p>
        </div>
        <div>
          <div class="text-sm text-textMuted mb-1">Candidate</div>
          <img id="final-candidate" class="w-full rounded-xl2" />
          <p id="final-candidate-notes" class="text-sm text-textMuted mt-1"></p>
        </div>
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <button id="final-keep" class="btn btn-soft">Keep current</button>
        <button id="final-replace" class="btn btn-cta">Replace with candidate</button>
      </div>
    </div>
  </div>

<script type="module">
/*** ---------- CONFIG / STATE ---------- ***/
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_TEXT  = "gemini-2.5-flash";
const MODEL_IMAGE = "gemini-2.5-flash-image";
const KEY_STORAGE = "gemini_api_key";
const DEFAULT_SAMPLING = { temperature: 0.7, topP: 0.9, topK: 32 };

const state = {
  key: (localStorage.getItem(KEY_STORAGE) || "").trim(),
  sampling: JSON.parse(localStorage.getItem("sampling") || JSON.stringify(DEFAULT_SAMPLING)),
  main: null,          // { base64, mime, url, w, h }
  purpose: "",
  firstNotes: "",
  refs: [],            // [{base64,mime,url}]
  roomBrief: "",       // paragraph + bullets joined
  rounds: [],          // [{ index, tiles:[{imageUrl,text,fav,note,ok,error}], open }]
  selectedCount: 0,
  final: { imageUrl: "", notes: "" },
  candidate: { imageUrl: "", notes: "" }
};

function saveSampling() {
  localStorage.setItem("sampling", JSON.stringify(state.sampling));
}

/*** ---------- BYOK BANNER / SETTINGS ---------- ***/
const banner = document.getElementById('key-banner');
const keyInput = document.getElementById('key-input');
const keySave = document.getElementById('key-save');
function hasKey(){ return !!state.key; }
function showBanner(){ banner.classList.toggle('hidden', hasKey()); }
keySave.onclick = () => {
  state.key = (keyInput.value || "").trim();
  localStorage.setItem(KEY_STORAGE, state.key);
  keyInput.value = "";
  showBanner();
};
showBanner();

// Settings
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const settingsBackdrop = document.getElementById('settings-backdrop');
const keyStatus = document.getElementById('key-status');
const btnRemoveKey = document.getElementById('btn-remove-key');
const sTemp = document.getElementById('s-temp');
const sTopp = document.getElementById('s-topp');
const sTopk = document.getElementById('s-topk');
const sReset= document.getElementById('s-reset');
const tVal = document.getElementById('t-val'); const pVal=document.getElementById('p-val'); const kVal=document.getElementById('k-val');

function openSettings(){
  keyStatus.textContent = hasKey()? "Key present on this device." : "No key set.";
  btnRemoveKey.disabled = !hasKey();
  sTemp.value = state.sampling.temperature; sTopp.value = state.sampling.topP; sTopk.value = state.sampling.topK;
  tVal.textContent = sTemp.value; pVal.textContent = sTopp.value; kVal.textContent = sTopk.value;
  settingsModal.classList.remove('hidden'); settingsBackdrop.classList.remove('hidden');
}
function closeSettings(){ settingsModal.classList.add('hidden'); settingsBackdrop.classList.add('hidden'); }
btnSettings.onclick = openSettings;
document.getElementById('settings-close').onclick = closeSettings;
document.getElementById('settings-done').onclick = closeSettings;
settingsBackdrop.onclick = closeSettings;
btnRemoveKey.onclick = () => { localStorage.removeItem(KEY_STORAGE); state.key=""; showBanner(); closeSettings(); };
[sTemp,sTopp,sTopk].forEach(inp=>{
  inp.addEventListener('input', ()=>{
    state.sampling = { temperature: +sTemp.value, topP:+sTopp.value, topK:+sTopk.value };
    tVal.textContent = sTemp.value; pVal.textContent = sTopp.value; kVal.textContent = sTopk.value;
    saveSampling();
  });
});
sReset.onclick = () => {
  state.sampling = {...DEFAULT_SAMPLING}; saveSampling(); openSettings();
};

/*** ---------- UI ELEMENTS ---------- ***/
const mainFile = document.getElementById('main-file');
const mainPrev = document.getElementById('main-preview');
const ref1 = document.getElementById('ref1'), ref2=document.getElementById('ref2');
const ref1Prev = document.getElementById('ref1-preview'), ref2Prev=document.getElementById('ref2-preview');
const purpose = document.getElementById('purpose');
const firstNotes = document.getElementById('first-notes');
const btnFirst = document.getElementById('btn-first');
const firstHint = document.getElementById('first-hint');

const iterations = document.getElementById('iterations');
const generateBar = document.getElementById('generate-bar');
const selCount = document.getElementById('sel-count');
const roundGuidance = document.getElementById('round-guidance');
const btnGenerate = document.getElementById('btn-generate');

const btnRestart = document.getElementById('btn-restart');

/*** ---------- FILE UTILS ---------- ***/
async function fileToResized(file, maxSide=2048, quality=0.9){
  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
  const w=img.naturalWidth, h=img.naturalHeight;
  const s = Math.min(1, maxSide/Math.max(w,h));
  const cw = Math.round(w*s), ch=Math.round(h*s);
  const canvas = document.createElement('canvas'); canvas.width=cw; canvas.height=ch;
  const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,cw,ch);
  const mime = file.type === 'image/png' ? 'image/png':'image/jpeg';
  const dataUrl = canvas.toDataURL(mime, quality);
  URL.revokeObjectURL(url);
  return { base64: dataUrl.split(',')[1], mime, url: dataUrl, w:cw, h:ch };
}

/*** ---------- API CORE ---------- ***/
async function gemFetch(model, body){
  if(!state.key){ alert("Missing API key."); throw new Error("no_key"); }
  const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type":"application/json", "x-goog-api-key": state.key },
    body: JSON.stringify(body)
  });
  if(!res.ok){ const t = await res.text(); throw new Error(`http_${res.status}:${t.slice(0,120)}`); }
  return res.json();
}
const textPart = (text)=>({text});
const inlinePart = (mime, b64)=>({inlineData:{mimeType:mime, data:b64}});

/*** ---------- ROOM BRIEF ---------- ***/
function roomBriefPrompt(){
  const p = state.purpose?.trim() || "None";
  const n = state.firstNotes?.trim() || "None";
  return [
    "ROLE: Create a concise, practical “room brief” for interior styling iterations.",
    "",
    "INPUTS:",
    "- Base room photo (camera pose and architectural envelope must be preserved)",
    `- Intended use: ${p}`,
    `- Notes from user (optional): ${n}`,
    "",
    "OUTPUT FORMAT (plain text only, no headings, no markdown):",
    "1) One paragraph (~60–90 words) summarizing the room’s light, openings, proportions and key opportunities/risks, with the intended use as priority.",
    "2) Then 3–5 bullets (one line each) of strict constraints/guidelines.",
    "",
    "CONSTRAINT HINTS (pick only what’s relevant; do not list all):",
    "• Keep camera pose & envelope; no structural changes unless explicitly asked later.",
    "• 60–30–10 color planning (dominant–secondary–accent).",
    "• Circulation clearance ~0.9 m in main paths; avoid cluttered layouts.",
    "• Sofa–table reach ≈0.35–0.45 m OR desk depth ≥0.60 m depending on use.",
    "• Rug sizing: front legs of seating on rug; workspace rug fully under chair.",
    "• Curtains: rod 10–15 cm above head; total width ≈2× opening.",
    "• Layered lighting: ambient + task + accent; evening ~2700–3000 K.",
    "• If scale is uncertain, keep dimensions conservative and mention low confidence.",
    "Avoid logos/text and unrealistic geometry."
  ].join("\n");
}
async function generateRoomBrief(){
  const body = {
    contents: [{ parts: [ textPart(roomBriefPrompt()), inlinePart(state.main.mime, state.main.base64) ]}],
    generationConfig: { ...state.sampling }
  };
  const json = await gemFetch(MODEL_TEXT, body);
  const raw = (json?.candidates?.[0]?.content?.parts || []).map(p=>p.text).filter(Boolean).join("\n").trim();
  const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const paragraph = lines[0] || "";
  const bullets = lines.slice(1).map(s => s.replace(/^[•\-–]\s?/, "")).filter(Boolean);
  state.roomBrief = [paragraph, ...bullets.map(b=>"• "+b)].join("\n");
}

/*** ---------- DIVERSITY DECK ---------- ***/
function diversityDeck(){
  return [
    "slightly warmer palette; gentler contrast",
    "slightly cooler palette; crisper contrast",
    "increase textile presence; softer layering",
    "reduce textiles; cleaner lines, fewer throws",
    "airier layout with more negative space",
    "denser, cozier seating cluster",
    "wood-forward materials; minimize metal",
    "metal accents slightly emphasized; reduce wood",
    "soft evening lighting (~2700–3000K), cozy ambience",
    "neutral daytime lighting (~4000–4500K), clear ambience",
    "tone-on-tone, low-contrast composition",
    "bolder accents; stronger figure-ground definition"
  ];
}

/*** ---------- ITERATION BUILDER ---------- ***/
function favoritesToBlock(){
  const arr = [];
  state.rounds.forEach(r=>{
    r.tiles.forEach((t,idx)=>{
      if(t.fav){
        const note = t.note?.trim()? ` [note: ${t.note.trim()}]` : "";
        arr.push(`(${arr.length+1}) ${t.text || "(no descriptor)"}${note}`);
      }
    });
  });
  return arr.join(" ");
}
function buildIterationPrompt(diversityHint, roundGuidance){
  return [
    "Use the attached base room photo as fixed camera pose and architectural envelope.",
    "If reference images are attached, transfer only their style (palette, textures, furniture mood, lighting mood)—not geometry.",
    "Consider the following guidance:",
    `• Room brief (silent): ${state.roomBrief || "None"}`,
    `• Intended use: ${state.purpose?.trim() || "None"}`,
    `• User’s global guidance for this round: ${roundGuidance?.trim() || "None"}`,
    `• Selected favorites (as free-text, raw): ${favoritesToBlock() || "None"}`,
    "",
    `Diversity hint for this image: ${diversityHint || "None"}`,
    "",
    "Generate ONE updated interior variant at 1024×682. Preserve perspective and room envelope.",
    "Return ONE image and ONE short free-text paragraph (single paragraph) describing the mood, the key changes vs the base, and 2–3 ideas for the next iteration. Avoid logos/text."
  ].join("\n");
}

/*** ---------- IMAGE GEN / PARSER (Hybrid policy) ---------- ***/
async function generateVariant(promptText){
  const parts = [ textPart(promptText), inlinePart(state.main.mime, state.main.base64) ];
  state.refs.forEach(r => parts.push(inlinePart(r.mime, r.base64)));
  const body = { contents: [{ parts }], generationConfig: { ...state.sampling } };
  const json = await gemFetch(MODEL_IMAGE, body);
  return await parseFlashImageResponse(json);
}
async function finalizeHiRes(childBlobUrl){
  const base64Child = await blobUrlToBase64(childBlobUrl);
  const parts = [
    textPart("Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target. Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition). Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any 'avoid' reminders. Avoid logos/text."),
    inlinePart(state.main.mime, state.main.base64),
    inlinePart("image/jpeg", base64Child)
  ];
  state.refs.forEach(r => parts.push(inlinePart(r.mime, r.base64)));
  const body = { contents: [{ parts }], generationConfig: { ...state.sampling } };
  const json = await gemFetch(MODEL_IMAGE, body);
  return await parseFlashImageResponse(json);
}

async function parseFlashImageResponse(json){
  const out = { imageUrl:null, text:"", warnings:[] };
  const parts = json?.candidates?.[0]?.content?.parts || [];
  for(const p of parts){
    if(!out.imageUrl && p.inlineData && /^image\//i.test(p.inlineData.mimeType||"")){
      const b64 = p.inlineData.data || p.inlineData.bytes || "";
      out.imageUrl = URL.createObjectURL(base64ToBlob(b64, p.inlineData.mimeType));
    }
    if(!out.text && typeof p.text === "string" && p.text.trim()){
      out.text = p.text.trim();
    }
    if(out.imageUrl && out.text) break;
  }
  if(!out.imageUrl) throw new Error("no_image_in_response");
  if(!out.text){
    out.warnings.push("auto-fixed: descriptor missing");
    out.text = await autoDescribeFromBlobUrl(out.imageUrl);
  }
  return out;
}

async function autoDescribeFromBlobUrl(url){
  const blob = await (await fetch(url)).blob();
  const b64 = await blobToBase64(blob);
  const body = {
    contents: [{ parts: [
      textPart("Write ONE short free-text paragraph describing this interior image (mood, key changes vs base, 2–3 ideas for next iteration). Avoid lists, headings or markdown."),
      inlinePart(blob.type || "image/jpeg", b64)
    ]}],
    generationConfig: { ...state.sampling, temperature: 0.7 }
  };
  const json = await gemFetch(MODEL_TEXT, body);
  const txt = (json?.candidates?.[0]?.content?.parts || []).map(p=>p.text).filter(Boolean).join(" ").trim();
  if(!txt) throw new Error("mini_text_call_empty");
  return txt;
}

/*** ---------- UTILS ---------- ***/
function base64ToBlob(b64, mime){
  const bin = atob(b64); const len=bin.length; const buf=new Uint8Array(len);
  for(let i=0;i<len;i++) buf[i]=bin.charCodeAt(i);
  return new Blob([buf], {type: mime || "application/octet-stream"});
}
async function blobToBase64(blob){
  const ab = await blob.arrayBuffer(); const bytes = new Uint8Array(ab);
  let binary = ""; const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk));
  return btoa(binary);
}
async function blobUrlToBase64(url){
  const blob = await (await fetch(url)).blob();
  return blobToBase64(blob);
}

/*** ---------- ROUNDS UI ---------- ***/
function renderRounds(){
  iterations.innerHTML = "";
  const openCount = state.rounds.filter(r=>r.open).length;
  // auto-collapse: keep last 2 open
  state.rounds.forEach((r,idx)=>{
    r.open = (idx >= state.rounds.length-2);
  });

  state.rounds.forEach((round)=>{
    const sec = document.createElement('section');
    sec.className = "rounded-xl2 border border-surface2 bg-surface p-3 mb-3";
    const head = document.createElement('div');
    head.className = "flex items-center justify-between";
    head.innerHTML = `
      <div class="font-medium">Iteration #${round.index} <span class="text-textMuted text-sm">(${round.tiles.length} images)</span></div>
      <button class="btn btn-soft">${round.open? "Collapse":"Expand"}</button>
    `;
    const btn = head.querySelector('button');
    btn.onclick = ()=>{ round.open=!round.open; renderRounds(); };

    const grid = document.createElement('div');
    grid.className = round.open? "mt-3 grid-auto" : "hidden";

    round.tiles.forEach((tile,ti)=>{
      const card = document.createElement('div');
      card.className = "rounded-xl2 border border-surface2 bg-surface2 p-2 flex flex-col gap-2";
      if(tile.ok){
        const img = document.createElement('img');
        img.src = tile.imageUrl; img.className = "w-full rounded-xl2 cursor-pointer";
        img.title = "Open full size in new tab";
        img.onclick = ()=> window.open(tile.imageUrl, "_blank");

        const row = document.createElement('div');
        row.className = "flex items-center justify-between gap-2";
        const favBtn = document.createElement('button');
        favBtn.className = "btn btn-soft";
        favBtn.textContent = tile.fav? "★ Favorited" : "☆ Favorite";
        favBtn.onclick = ()=>{ tile.fav=!tile.fav; updateSelectedCount(); renderRounds(); };

        const useFinal = document.createElement('button');
        useFinal.className = "btn btn-soft";
        useFinal.textContent = "Use as final";
        useFinal.onclick = ()=> startFinalCompare(tile.imageUrl);

        const details = document.createElement('details');
        details.className = "mt-1";
        const sum = document.createElement('summary');
        sum.textContent = "Details anzeigen";
        const p = document.createElement('p');
        p.className = "text-sm text-textMuted mt-1 whitespace-pre-wrap";
        p.textContent = tile.text || "(no descriptor)";
        details.append(sum, p);

        const note = document.createElement('input');
        note.placeholder = "Optional note for next round (this favorite)";
        note.value = tile.note || "";
        note.oninput = ()=> tile.note = note.value;
        note.className = (tile.fav? "":"hidden ") + "bg-surface rounded-xl2 px-2 py-1 text-sm";

        row.append(favBtn, useFinal);
        card.append(img, row, details, note);
      } else if (tile.error) {
        const err = document.createElement('div');
        err.className = "text-sm text-textMuted";
        err.textContent = "Generation failed: " + tile.error;
        const retry = document.createElement('button');
        retry.className = "btn btn-soft mt-1";
        retry.textContent = "Retry";
        retry.onclick = ()=> retryTile(round, ti);
        card.append(err, retry);
      } else {
        const sh = document.createElement('div');
        sh.className = "animate-pulse h-28 bg-surface rounded-xl2";
        card.append(sh);
      }
      grid.append(card);
    });

    sec.append(head, grid);
    iterations.append(sec);
  });

  updateSelectedCount();
}

function clearAllFavorites(){
  state.rounds.forEach(r=> r.tiles.forEach(t=> t.fav=false));
  updateSelectedCount();
}

function updateSelectedCount(){
  const count = state.rounds.reduce((acc,r)=> acc + r.tiles.filter(t=>t.fav).length, 0);
  state.selectedCount = count;
  selCount.textContent = `${count} selected`;
  generateBar.classList.toggle('hidden', count===0);
}

/*** ---------- RUN BATCH (12 @ pool=6) ---------- ***/
async function runRound(){
  const roundIndex = state.rounds.length + 1;
  const round = { index: roundIndex, tiles: Array.from({length:12}, ()=>({ok:false})), open: true };
  state.rounds.push(round);
  renderRounds();

  const deck = diversityDeck();
  const refs = state.refs.slice(0,2);

  // after starting next round, clear all favorites (must re-select every round)
  clearAllFavorites();

  let nextI = 0;
  const running = new Set();
  async function startOne(i){
    const hint = deck[i];
    const promptText = buildIterationPrompt(hint, roundGuidance.value);
    const p = generateVariant(promptText).then((res)=>{
      round.tiles[i] = { ...res, ok:true, fav:false, note:"" };
      renderRounds();
    }).catch(err=>{
      round.tiles[i] = { ok:false, error: err.message || String(err) };
      renderRounds();
    }).finally(()=> running.delete(p));
    running.add(p);
  }
  // start pool=6
  const startN = Math.min(6, deck.length);
  for(let i=0;i<startN;i++){ await startOne(nextI++); }
  while(nextI < deck.length){
    await Promise.race([...running]);
    await startOne(nextI++);
  }
  await Promise.allSettled([...running]);
}

async function retryTile(round, ti){
  round.tiles[ti] = { ok:false }; renderRounds();
  try{
    const hint = diversityDeck()[ti];
    const promptText = buildIterationPrompt(hint, roundGuidance.value);
    const res = await generateVariant(promptText);
    round.tiles[ti] = { ...res, ok:true, fav:false, note:"" };
  }catch(err){
    round.tiles[ti] = { ok:false, error: err.message || String(err) };
  }
  renderRounds();
}

/*** ---------- FINAL COMPARE ---------- ***/
const finalBackdrop = document.getElementById('final-backdrop');
const finalModal = document.getElementById('final-modal');
const finalClose = document.getElementById('final-close');
const finalCurrent = document.getElementById('final-current');
const finalCand = document.getElementById('final-candidate');
const finalCurrNotes = document.getElementById('final-current-notes');
const finalCandNotes = document.getElementById('final-candidate-notes');
const finalKeep = document.getElementById('final-keep');
const finalReplace = document.getElementById('final-replace');

function openFinalModal(){ finalBackdrop.classList.remove('hidden'); finalModal.classList.remove('hidden'); }
function closeFinalModal(){ finalBackdrop.classList.add('hidden'); finalModal.classList.add('hidden'); }

finalClose.onclick = closeFinalModal; finalBackdrop.onclick = closeFinalModal;
finalKeep.onclick = ()=>{ closeFinalModal(); /* keep current */ };
finalReplace.onclick = ()=>{ state.final = { imageUrl: state.candidate.imageUrl, notes: state.candidate.notes }; closeFinalModal(); alert("Final replaced."); };

async function startFinalCompare(childUrl){
  try{
    const res = await finalizeHiRes(childUrl);
    state.candidate = { imageUrl: res.imageUrl, notes: res.text || "" };
    finalCand.src = state.candidate.imageUrl; finalCandNotes.textContent = state.candidate.notes;
    finalCurrent.src = state.final.imageUrl || childUrl;
    finalCurrNotes.textContent = state.final.notes || "(no build notes yet)";
    openFinalModal();
  }catch(err){
    alert("Finalization failed: " + (err.message || err));
  }
}

/*** ---------- HANDLERS: SETUP ---------- ***/
mainFile.onchange = async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  state.main = await fileToResized(f, 2048, 0.9);
  mainPrev.innerHTML = `<img src="${state.main.url}" class="max-h-64 rounded-xl2">`;
  btnFirst.disabled = false; firstHint.textContent = "Ready.";
};

ref1.onchange = async (e)=>{
  const f = e.target.files[0]; if(!f){ state.refs[0]=null; ref1Prev.innerHTML=""; return; }
  const r = await fileToResized(f, 2048, 0.9);
  state.refs[0] = r; ref1Prev.innerHTML = `<img src="${r.url}" class="max-h-32 rounded-xl2">`;
  state.refs = state.refs.filter(Boolean);
};
ref2.onchange = async (e)=>{
  const f = e.target.files[0]; if(!f){ state.refs[1]=null; ref2Prev.innerHTML=""; return; }
  const r = await fileToResized(f, 2048, 0.9);
  state.refs[1] = r; ref2Prev.innerHTML = `<img src="${r.url}" class="max-h-32 rounded-xl2">`;
  state.refs = state.refs.filter(Boolean);
};

purpose.oninput = ()=> state.purpose = purpose.value;
firstNotes.oninput = ()=> state.firstNotes = firstNotes.value;

/*** ---------- FIRST ROUND + ROOM BRIEF ---------- ***/
btnFirst.onclick = async ()=>{
  if(!state.main){ alert("Please upload the main photo first."); return; }
  // rename button to Restart behavior
  btnFirst.textContent = "Restart";
  // hard reset of generated rounds / favorites / final
  state.rounds = []; state.final={imageUrl:"",notes:""}; iterations.innerHTML="";
  // generate or regenerate room brief
  try{
    await generateRoomBrief();
  }catch(err){
    alert("Room Brief failed: " + (err.message || err));
    return;
  }
  // run first round (no favorites required)
  await runRound();
};

/*** ---------- GENERATE NEXT (sticky bar) ---------- ***/
btnGenerate.onclick = async ()=>{
  if(state.selectedCount <= 0){ return; }
  await runRound();
  // After starting a new round, clear bar and selections (already cleared on start)
  roundGuidance.value = "";
};
function refreshGenerateBarVisibility(){
  updateSelectedCount();
}
refreshGenerateBarVisibility();

/*** ---------- RESTART ---------- ***/
btnRestart.onclick = ()=>{
  if(!confirm("Restart will clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?")) return;
  state.rounds=[]; state.final={imageUrl:"",notes:""}; renderRounds(); updateSelectedCount();
};

/*** ---------- INIT ---------- ***/
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeFinalModal(); });
</script>
</body>
</html>
```
