/* istanbul ignore file */

import {
  readGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  onKeyChange,
} from '../utils/key-store.js';
import { GeminiIECClient, DEFAULT_SAMPLING } from '../utils/gemini-client.js';
import { resizeImageFile, blobToBase64 } from '../utils/image.js';

const SAMPLING_STORAGE_KEY = 'moodcanvas.sampling';
const FINAL_PROMPT =
  'Use the attached base room photo as fixed camera & envelope and the attached selected child image as strict visual target. Produce ONE faithful high-resolution re-render at 1536×1024 (polish only; no new composition). Then return ONE short paragraph of Build Notes (5–7 sentences): materials & finishes, palette accents, lighting layers (day/evening), 1–2 dimensional tips in meters, and any "avoid" reminders. Avoid logos/text.';

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.client = new GeminiIECClient();
    this.keySubscription = null;
    this.state = {
      sampling: this.#readSampling(),
      key: '',
      main: null,
      purpose: '',
      firstNotes: '',
      refs: [],
      roomBrief: null,
      rounds: [],
      selectedCount: 0,
      final: { imageUrl: '', notes: '' },
      candidate: { imageUrl: '', notes: '' },
    };

    this.elements = {};
  }

  async init() {
    this.#renderShell();
    this.#bootstrapKey();
    this.#attachEvents();
    this.#renderKeyBanner();
    this.#renderKeyStatus();
    this.#renderRounds();
  }

  destroy() {
    if (this.keySubscription) {
      this.keySubscription();
      this.keySubscription = null;
    }
  }

  #renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col">
        <header class="sticky top-0 z-30 backdrop-blur bg-bg/70 border-b border-surface2">
          <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
            <h1 class="text-lg font-semibold">MoodCanvas</h1>
            <span class="rounded-full bg-surface2 px-3 py-1 text-xs uppercase tracking-wide">IEC Demo</span>
            <div class="ml-auto flex items-center gap-2">
              <button id="btn-restart" class="rounded-xl2 bg-surface2 px-3 py-2 hover:opacity-90" type="button">Restart</button>
              <button id="btn-settings" class="rounded-xl2 bg-surface2 px-3 py-2 hover:opacity-90" type="button">Settings</button>
            </div>
          </div>
        </header>

        <section id="key-banner" class="hidden max-w-6xl mx-auto mt-3 px-4">
          <div class="rounded-xl2 border border-surface2 bg-surface p-4 space-y-3">
            <p class="text-sm">
              <strong>MoodCanvas</strong> — Get your key from
              <a class="underline text-accent" href="https://aistudio.google.com/app/api-keys" target="_blank" rel="noopener">Google AI Studio</a>.
              The key is stored only in your browser.
            </p>
            <div class="flex flex-col sm:flex-row gap-2">
              <input id="key-input" type="password" placeholder="Paste your Gemini API key" class="flex-1 rounded-xl2 bg-surface2 px-3 py-2 outline-none focus:ring-2 focus:ring-accent/60" />
              <button id="key-save" class="rounded-xl2 bg-cta text-ctaOn px-3 py-2 hover:opacity-90" type="button">Save key</button>
            </div>
            <p class="text-xs text-textMuted">Tip: many Google keys start with <code>AIza</code>.</p>
          </div>
        </section>

        <main class="flex-1 max-w-6xl mx-auto w-full px-4 py-4 space-y-4">
          <section class="rounded-xl2 border border-surface2 bg-surface p-4 space-y-4">
            <div>
              <h2 class="font-medium">1) Main Target Photo</h2>
              <input id="main-file" type="file" accept="image/jpeg,image/png" capture="environment" class="mt-2 block w-full text-sm" />
              <div id="main-preview" class="mt-3"></div>
            </div>
            <div class="grid md:grid-cols-2 gap-3">
              <label class="block text-sm">
                <span class="text-textMuted">Intended use (optional)</span>
                <input id="purpose" class="mt-1 w-full rounded-xl2 bg-surface2 px-3 py-2" placeholder="Living Room, Home Office" />
              </label>
              <label class="block text-sm">
                <span class="text-textMuted">Notes for first round (optional)</span>
                <input id="first-notes" class="mt-1 w-full rounded-xl2 bg-surface2 px-3 py-2" placeholder="warm woods, cozy evening mood" />
              </label>
            </div>
            <div>
              <h3 class="font-medium">2) Reference images (optional, up to 2; order = weight)</h3>
              <div class="grid md:grid-cols-2 gap-3 mt-3">
                <div class="rounded-xl2 border border-surface2 p-3 space-y-2">
                  <div class="text-sm text-textMuted">Reference #1 (main style)</div>
                  <input id="ref1" type="file" accept="image/jpeg,image/png" class="block w-full text-sm" />
                  <div id="ref1-preview"></div>
                </div>
                <div class="rounded-xl2 border border-surface2 p-3 space-y-2">
                  <div class="text-sm text-textMuted">Reference #2 (accent)</div>
                  <input id="ref2" type="file" accept="image/jpeg,image/png" class="block w-full text-sm" />
                  <div id="ref2-preview"></div>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button id="btn-first" class="rounded-xl2 bg-cta text-ctaOn px-4 py-2 hover:opacity-90 disabled:opacity-50" type="button" disabled>Start generating first suggestions</button>
              <span id="first-hint" class="text-sm text-textMuted">Upload the main photo to enable.</span>
            </div>
          </section>

          <section id="room-brief" class="hidden rounded-xl2 border border-surface2 bg-surface p-4 space-y-3">
            <header class="flex items-center justify-between gap-2">
              <h2 class="font-medium">Room brief</h2>
              <span class="text-xs text-textMuted">Auto generated from base photo</span>
            </header>
            <p id="room-brief-paragraph" class="text-sm text-text"></p>
            <ul id="room-brief-bullets" class="list-disc list-inside text-sm text-textMuted space-y-1"></ul>
          </section>

          <section id="iterations" class="space-y-4"></section>
        </main>

        <div id="generate-bar" class="hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 border-t border-surface2">
          <div class="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div id="sel-count" class="text-sm text-textMuted">0 selected</div>
            <input id="round-guidance" class="flex-1 rounded-xl2 bg-surface2 px-3 py-2 text-sm" placeholder="Quick instruction for next round (optional)" />
            <button id="btn-generate" class="rounded-xl2 bg-cta text-ctaOn px-4 py-2 hover:opacity-90" type="button">Generate Next Iteration</button>
          </div>
        </div>

        <div id="settings-backdrop" class="hidden fixed inset-0 z-40 bg-black/60"></div>
        <div id="settings-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="w-full max-w-md rounded-xl2 bg-surface text-text shadow-dialog border border-surface2 overflow-hidden">
            <header class="flex items-center justify-between px-4 py-3 border-b border-surface2">
              <h2 class="text-base font-medium">Settings</h2>
              <button id="settings-close" class="rounded-xl2 px-2 py-1 hover:opacity-80" type="button">✕</button>
            </header>
            <div class="px-4 py-4 space-y-4">
              <section>
                <h3 class="text-sm font-medium">Gemini API key</h3>
                <p id="key-status" class="text-sm text-textMuted mt-1">No key stored.</p>
                <button id="btn-remove-key" class="mt-2 rounded-xl2 bg-cta text-ctaOn px-3 py-2 hover:opacity-90 disabled:opacity-50" type="button" disabled>Remove key from this device</button>
              </section>
              <section class="border-t border-surface2 pt-3">
                <h3 class="text-sm font-medium">Sampling (global)</h3>
                <div class="text-xs text-textMuted">temperature <span id="sampling-temp">0.7</span> • topP <span id="sampling-topP">0.9</span> • topK <span id="sampling-topK">32</span></div>
                <div class="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <label class="flex flex-col gap-1">
                    <span>temperature</span>
                    <input id="s-temp" type="range" min="0" max="1" step="0.05" class="w-full" />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span>topP</span>
                    <input id="s-topp" type="range" min="0" max="1" step="0.05" class="w-full" />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span>topK</span>
                    <input id="s-topk" type="number" min="1" max="128" step="1" class="rounded-xl2 bg-surface2 px-2 py-1" />
                  </label>
                </div>
                <button id="sampling-reset" class="mt-3 rounded-xl2 bg-surface2 px-3 py-2 hover:opacity-90" type="button">Reset to defaults</button>
              </section>
            </div>
            <footer class="px-4 py-3 border-t border-surface2 text-right">
              <button id="settings-done" class="rounded-xl2 bg-surface2 px-3 py-2 hover:opacity-90" type="button">Close</button>
            </footer>
          </div>
        </div>

        <div id="final-backdrop" class="hidden fixed inset-0 z-50 bg-black/70"></div>
        <div id="final-modal" class="hidden fixed inset-0 z-50 p-4 overflow-auto">
          <div class="max-w-6xl mx-auto bg-surface rounded-xl2 border border-surface2 p-4 space-y-3">
            <header class="flex items-center justify-between">
              <h3 class="text-base font-medium">Compare &amp; decide</h3>
              <button id="final-close" class="rounded-xl2 px-2 py-1 hover:opacity-80" type="button">✕</button>
            </header>
            <div class="grid md:grid-cols-2 gap-4">
              <div>
                <div class="text-sm text-textMuted mb-1">Current Final</div>
                <img id="final-current" alt="Current final" class="w-full rounded-xl2" />
                <p id="final-current-notes" class="text-sm text-textMuted mt-1"></p>
              </div>
              <div>
                <div class="text-sm text-textMuted mb-1">Candidate</div>
                <img id="final-candidate" alt="Candidate" class="w-full rounded-xl2" />
                <p id="final-candidate-notes" class="text-sm text-textMuted mt-1"></p>
              </div>
            </div>
            <div class="flex justify-end gap-2">
              <button id="final-keep" class="rounded-xl2 bg-surface2 px-3 py-2 hover:opacity-90" type="button">Keep current</button>
              <button id="final-replace" class="rounded-xl2 bg-cta text-ctaOn px-3 py-2 hover:opacity-90" type="button">Replace with candidate</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.elements = {
      keyBanner: this.root.querySelector('#key-banner'),
      keyInput: this.root.querySelector('#key-input'),
      keySave: this.root.querySelector('#key-save'),
      keyStatus: this.root.querySelector('#key-status'),
      btnRemoveKey: this.root.querySelector('#btn-remove-key'),
      settingsModal: this.root.querySelector('#settings-modal'),
      settingsBackdrop: this.root.querySelector('#settings-backdrop'),
      btnSettings: this.root.querySelector('#btn-settings'),
      btnSettingsClose: this.root.querySelector('#settings-close'),
      btnSettingsDone: this.root.querySelector('#settings-done'),
      btnRestart: this.root.querySelector('#btn-restart'),
      samplingTempValue: this.root.querySelector('#sampling-temp'),
      samplingTopPValue: this.root.querySelector('#sampling-topP'),
      samplingTopKValue: this.root.querySelector('#sampling-topK'),
      samplingTemp: this.root.querySelector('#s-temp'),
      samplingTopP: this.root.querySelector('#s-topp'),
      samplingTopK: this.root.querySelector('#s-topk'),
      samplingReset: this.root.querySelector('#sampling-reset'),
      mainFile: this.root.querySelector('#main-file'),
      mainPreview: this.root.querySelector('#main-preview'),
      refInputs: [this.root.querySelector('#ref1'), this.root.querySelector('#ref2')],
      refPreviews: [this.root.querySelector('#ref1-preview'), this.root.querySelector('#ref2-preview')],
      purpose: this.root.querySelector('#purpose'),
      firstNotes: this.root.querySelector('#first-notes'),
      btnFirst: this.root.querySelector('#btn-first'),
      firstHint: this.root.querySelector('#first-hint'),
      iterations: this.root.querySelector('#iterations'),
      roomBrief: this.root.querySelector('#room-brief'),
      roomBriefParagraph: this.root.querySelector('#room-brief-paragraph'),
      roomBriefBullets: this.root.querySelector('#room-brief-bullets'),
      generateBar: this.root.querySelector('#generate-bar'),
      selCount: this.root.querySelector('#sel-count'),
      roundGuidance: this.root.querySelector('#round-guidance'),
      btnGenerate: this.root.querySelector('#btn-generate'),
      finalBackdrop: this.root.querySelector('#final-backdrop'),
      finalModal: this.root.querySelector('#final-modal'),
      finalClose: this.root.querySelector('#final-close'),
      finalKeep: this.root.querySelector('#final-keep'),
      finalReplace: this.root.querySelector('#final-replace'),
      finalCurrent: this.root.querySelector('#final-current'),
      finalCandidate: this.root.querySelector('#final-candidate'),
      finalCurrentNotes: this.root.querySelector('#final-current-notes'),
      finalCandidateNotes: this.root.querySelector('#final-candidate-notes'),
    };
  }

  #attachEvents() {
    const {
      keySave,
      keyInput,
      btnSettings,
      btnSettingsClose,
      btnSettingsDone,
      settingsBackdrop,
      btnRemoveKey,
      samplingTemp,
      samplingTopP,
      samplingTopK,
      samplingReset,
      mainFile,
      refInputs,
      purpose,
      firstNotes,
      btnFirst,
      btnGenerate,
      btnRestart,
      finalBackdrop,
      finalClose,
      finalKeep,
      finalReplace,
    } = this.elements;

    keySave.addEventListener('click', () => {
      const value = keyInput.value.trim();
      saveGeminiKey(value);
      keyInput.value = '';
      this.state.key = value;
      this.client.setApiKey(this.state.key);
      this.#renderKeyBanner();
      this.#renderKeyStatus();
    });

    btnSettings.addEventListener('click', () => this.#openSettings());
    btnSettingsClose.addEventListener('click', () => this.#closeSettings());
    btnSettingsDone.addEventListener('click', () => this.#closeSettings());
    settingsBackdrop.addEventListener('click', () => this.#closeSettings());

    btnRemoveKey.addEventListener('click', () => {
      clearGeminiKey();
      this.state.key = '';
      this.client.setApiKey('');
      this.#renderKeyBanner();
      this.#renderKeyStatus();
      this.#closeSettings();
    });

    [samplingTemp, samplingTopP].forEach((input) => {
      input.addEventListener('input', () => {
        const updated = {
          temperature: Number.parseFloat(samplingTemp.value),
          topP: Number.parseFloat(samplingTopP.value),
          topK: Number.parseInt(samplingTopK.value, 10) || DEFAULT_SAMPLING.topK,
        };
        this.state.sampling = updated;
        this.#writeSampling();
        this.#renderSamplingInputs();
      });
    });

    samplingTopK.addEventListener('input', () => {
      const updated = {
        temperature: Number.parseFloat(samplingTemp.value),
        topP: Number.parseFloat(samplingTopP.value),
        topK: Number.parseInt(samplingTopK.value, 10) || DEFAULT_SAMPLING.topK,
      };
      this.state.sampling = updated;
      this.#writeSampling();
      this.#renderSamplingInputs();
    });

    samplingReset.addEventListener('click', () => {
      this.state.sampling = { ...DEFAULT_SAMPLING };
      this.#writeSampling();
      this.#renderSamplingInputs();
    });

    mainFile.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        this.state.main = await resizeImageFile(file, 2048, 0.9);
        this.elements.mainPreview.innerHTML = `<img src="${this.state.main.url}" alt="Main photo" class="max-h-64 rounded-xl2" />`;
        this.elements.btnFirst.disabled = false;
        this.elements.firstHint.textContent = 'Ready.';
      } catch (error) {
        console.error(error);
        this.state.main = null;
        this.elements.mainPreview.textContent = 'Unable to load image.';
      }
    });

    refInputs.forEach((input, index) => {
      input.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) {
          this.state.refs[index] = undefined;
          this.elements.refPreviews[index].innerHTML = '';
          this.state.refs = this.state.refs.filter(Boolean);
          return;
        }
        try {
          const resized = await resizeImageFile(file, 2048, 0.9);
          this.state.refs[index] = resized;
          this.elements.refPreviews[index].innerHTML = `<img src="${resized.url}" alt="Reference ${index + 1}" class="max-h-32 rounded-xl2" />`;
          this.state.refs = this.state.refs.filter(Boolean);
        } catch (error) {
          console.error(error);
        }
      });
    });

    purpose.addEventListener('input', () => {
      this.state.purpose = purpose.value;
    });

    firstNotes.addEventListener('input', () => {
      this.state.firstNotes = firstNotes.value;
    });

    btnFirst.addEventListener('click', async () => {
      if (!this.state.main) {
        window.alert('Please upload the main photo first.');
        return;
      }
      btnFirst.textContent = 'Restart';
      this.state.rounds = [];
      this.state.final = { imageUrl: '', notes: '' };
      this.#renderRounds();
      try {
        const brief = await this.#generateRoomBrief();
        this.state.roomBrief = brief;
        this.#renderRoomBrief();
      } catch (error) {
        window.alert(`Room brief failed: ${error.message || error}`);
        return;
      }
      await this.#runRound();
    });

    btnGenerate.addEventListener('click', async () => {
      if (this.state.selectedCount <= 0) return;
      await this.#runRound();
      this.elements.roundGuidance.value = '';
    });

    btnRestart.addEventListener('click', () => {
      if (
        !window.confirm(
          'Restart will clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?'
        )
      ) {
        return;
      }
      this.state.rounds = [];
      this.state.final = { imageUrl: '', notes: '' };
      this.#renderRounds();
      this.#updateSelectedCount();
    });

    finalBackdrop.addEventListener('click', () => this.#closeFinalModal());
    finalClose.addEventListener('click', () => this.#closeFinalModal());
    finalKeep.addEventListener('click', () => this.#closeFinalModal());
    finalReplace.addEventListener('click', () => {
      this.state.final = { ...this.state.candidate };
      this.#closeFinalModal();
      window.alert('Final replaced.');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.#closeFinalModal();
    });
  }

  #bootstrapKey() {
    this.state.key = readGeminiKey();
    this.client.setApiKey(this.state.key);
    this.keySubscription = onKeyChange(() => {
      const next = readGeminiKey();
      this.state.key = next;
      this.client.setApiKey(next);
      this.#renderKeyBanner();
      this.#renderKeyStatus();
    });
  }

  #readSampling() {
    try {
      const raw = localStorage.getItem(SAMPLING_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SAMPLING };
      const parsed = JSON.parse(raw);
      return {
        temperature: Number.parseFloat(parsed.temperature) || DEFAULT_SAMPLING.temperature,
        topP: Number.parseFloat(parsed.topP) || DEFAULT_SAMPLING.topP,
        topK: Number.parseInt(parsed.topK, 10) || DEFAULT_SAMPLING.topK,
      };
    } catch (error) {
      console.warn('Unable to read sampling configuration', error);
      return { ...DEFAULT_SAMPLING };
    }
  }

  #writeSampling() {
    try {
      localStorage.setItem(SAMPLING_STORAGE_KEY, JSON.stringify(this.state.sampling));
    } catch (error) {
      console.warn('Unable to persist sampling configuration', error);
    }
  }

  #renderSamplingInputs() {
    const { sampling } = this.state;
    const {
      samplingTemp,
      samplingTopP,
      samplingTopK,
      samplingTempValue,
      samplingTopPValue,
      samplingTopKValue,
    } = this.elements;

    samplingTemp.value = sampling.temperature;
    samplingTopP.value = sampling.topP;
    samplingTopK.value = sampling.topK;
    samplingTempValue.textContent = sampling.temperature.toFixed(2);
    samplingTopPValue.textContent = sampling.topP.toFixed(2);
    samplingTopKValue.textContent = String(sampling.topK);
  }

  #renderKeyBanner() {
    const hasKey = Boolean(this.state.key);
    this.elements.keyBanner.classList.toggle('hidden', hasKey);
  }

  #renderKeyStatus() {
    const hasKey = Boolean(this.state.key);
    this.elements.keyStatus.textContent = hasKey
      ? 'Key present on this device.'
      : 'No key stored.';
    this.elements.btnRemoveKey.disabled = !hasKey;
  }

  async #generateRoomBrief() {
    const prompt = this.#buildRoomBriefPrompt();
    const { paragraph, bullets } = await this.client.generateRoomBrief({
      promptText: prompt,
      base64Main: this.state.main.base64,
      mimeMain: this.state.main.mime,
      sampling: this.state.sampling,
    });
    return { paragraph, bullets };
  }

  #buildRoomBriefPrompt() {
    const purpose = this.state.purpose?.trim() || 'None';
    const notes = this.state.firstNotes?.trim() || 'None';
    return [
      'ROLE: Create a concise, practical “room brief” for interior styling iterations.',
      '',
      'INPUTS:',
      '- Base room photo (camera pose and architectural envelope must be preserved)',
      `- Intended use: ${purpose}`,
      `- Notes from user (optional): ${notes}`,
      '',
      'OUTPUT FORMAT (plain text only, no headings, no markdown):',
      '1) One paragraph (~60–90 words) summarizing the room’s light, openings, proportions and key opportunities/risks, with the intended use as priority.',
      '2) Then 3–5 bullets (one line each) of strict constraints/guidelines.',
      '',
      'CONSTRAINT HINTS (pick only what’s relevant; do not list all):',
      '• Keep camera pose & envelope; no structural changes unless explicitly asked later.',
      '• 60–30–10 color planning (dominant–secondary–accent).',
      '• Circulation clearance ~0.9 m in main paths; avoid cluttered layouts.',
      '• Sofa–table reach ≈0.35–0.45 m OR desk depth ≥0.60 m depending on use.',
      '• Rug sizing: front legs of seating on rug; workspace rug fully under chair.',
      '• Curtains: rod 10–15 cm above head; total width ≈2× opening.',
      '• Layered lighting: ambient + task + accent; evening ~2700–3000 K.',
      '• If scale is uncertain, keep dimensions conservative and mention low confidence.',
      'Avoid logos/text and unrealistic geometry.',
    ].join('\n');
  }

  #renderRoomBrief() {
    if (!this.state.roomBrief) {
      this.elements.roomBrief.classList.add('hidden');
      return;
    }
    const { paragraph, bullets } = this.state.roomBrief;
    this.elements.roomBriefParagraph.textContent = paragraph;
    this.elements.roomBriefBullets.innerHTML = bullets
      .map((bullet) => `<li>${bullet}</li>`)
      .join('');
    this.elements.roomBrief.classList.remove('hidden');
  }

  #diversityDeck() {
    return [
      'slightly warmer palette; gentler contrast',
      'slightly cooler palette; crisper contrast',
      'increase textile presence; softer layering',
      'reduce textiles; cleaner lines, fewer throws',
      'airier layout with more negative space',
      'denser, cozier seating cluster',
      'wood-forward materials; minimize metal',
      'metal accents slightly emphasized; reduce wood',
      'soft evening lighting (~2700–3000K), cozy ambience',
      'neutral daytime lighting (~4000–4500K), clear ambience',
      'tone-on-tone, low-contrast composition',
      'bolder accents; stronger figure-ground definition',
    ];
  }

  #favoritesBlock() {
    const collected = [];
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        if (tile.fav) {
          const note = tile.note?.trim() ? ` [note: ${tile.note.trim()}]` : '';
          collected.push(`(${collected.length + 1}) ${tile.text || '(no descriptor)'}${note}`);
        }
      });
    });
    return collected.join(' ');
  }

  #buildIterationPrompt(hint, roundGuidance) {
    return [
      'Use the attached base room photo as fixed camera pose and architectural envelope.',
      'If reference images are attached, transfer only their style (palette, textures, furniture mood, lighting mood)—not geometry.',
      'Consider the following guidance:',
      `• Room brief (silent): ${this.state.roomBrief ? [this.state.roomBrief.paragraph, ...(this.state.roomBrief.bullets || [])].join(' ') : 'None'}`,
      `• Intended use: ${this.state.purpose?.trim() || 'None'}`,
      `• User’s global guidance for this round: ${roundGuidance?.trim() || 'None'}`,
      `• Selected favorites (as free-text, raw): ${this.#favoritesBlock() || 'None'}`,
      '',
      `Diversity hint for this image: ${hint || 'None'}`,
      '',
      'Generate ONE updated interior variant at 1024×682. Preserve perspective and room envelope.',
      'Return ONE image and ONE short free-text paragraph (single paragraph) describing the mood, the key changes vs the base, and 2–3 ideas for the next iteration. Avoid logos/text.',
    ].join('\n');
  }

  async #runRound() {
    const roundIndex = this.state.rounds.length + 1;
    const round = {
      index: roundIndex,
      tiles: Array.from({ length: 12 }, () => ({ ok: false })),
      open: true,
    };
    this.state.rounds.push(round);
    this.#renderRounds();

    this.#clearFavorites();

    const deck = this.#diversityDeck();
    let nextIndex = 0;
    const running = new Set();

    const startOne = async (index) => {
      const hint = deck[index];
      const prompt = this.#buildIterationPrompt(hint, this.elements.roundGuidance.value);
      const task = this.client
        .generateVariant({
          promptText: prompt,
          base64Main: this.state.main.base64,
          mimeMain: this.state.main.mime,
          references: this.state.refs,
          sampling: this.state.sampling,
        })
        .then((result) => {
          round.tiles[index] = { ...result, ok: true, fav: false, note: '' };
        })
        .catch((error) => {
          round.tiles[index] = { ok: false, error: error.message || String(error) };
        })
        .finally(() => {
          running.delete(task);
          this.#renderRounds();
        });
      running.add(task);
    };

    const pool = Math.min(6, deck.length);
    for (let i = 0; i < pool; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await startOne(nextIndex);
      nextIndex += 1;
    }

    while (nextIndex < deck.length) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.race([...running]);
      // eslint-disable-next-line no-await-in-loop
      await startOne(nextIndex);
      nextIndex += 1;
    }

    await Promise.allSettled([...running]);
    this.#renderRounds();
  }

  async #retryTile(round, tileIndex) {
    round.tiles[tileIndex] = { ok: false };
    this.#renderRounds();
    try {
      const hint = this.#diversityDeck()[tileIndex];
      const prompt = this.#buildIterationPrompt(hint, this.elements.roundGuidance.value);
      const result = await this.client.generateVariant({
        promptText: prompt,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: this.state.refs,
        sampling: this.state.sampling,
      });
      round.tiles[tileIndex] = { ...result, ok: true, fav: false, note: '' };
    } catch (error) {
      round.tiles[tileIndex] = { ok: false, error: error.message || String(error) };
    }
    this.#renderRounds();
  }

  #clearFavorites() {
    this.state.rounds.forEach((existing) => {
      existing.tiles.forEach((tile) => {
        tile.fav = false;
        tile.note = tile.note || '';
      });
    });
    this.#updateSelectedCount();
  }

  #renderRounds() {
    const container = this.elements.iterations;
    container.innerHTML = '';

    // auto-collapse older rounds (keep last two open)
    this.state.rounds.forEach((round, index) => {
      round.open = index >= this.state.rounds.length - 2;
    });

    this.state.rounds.forEach((round) => {
      const section = document.createElement('section');
      section.className = 'rounded-xl2 border border-surface2 bg-surface p-3 space-y-3';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'rounded-xl2 bg-surface2 px-3 py-2 hover:opacity-90 text-sm';
      toggle.textContent = round.open ? 'Collapse' : 'Expand';
      toggle.addEventListener('click', () => {
        round.open = !round.open;
        this.#renderRounds();
      });

      const title = document.createElement('div');
      title.className = 'font-medium';
      title.textContent = `Iteration #${round.index} (${round.tiles.length} images)`;
      header.append(title, toggle);
      section.append(header);

      const grid = document.createElement('div');
      grid.className = round.open ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3' : 'hidden';

      round.tiles.forEach((tile, tileIndex) => {
        const card = document.createElement('div');
        card.className = 'rounded-xl2 border border-surface2 bg-surface2 p-2 space-y-2';
        if (tile.ok) {
          const image = document.createElement('img');
          image.src = tile.imageUrl;
          image.alt = 'Generated variant';
          image.className = 'w-full rounded-xl2 cursor-pointer';
          image.loading = 'lazy';
          image.addEventListener('click', () => {
            window.open(tile.imageUrl, '_blank');
          });

          const controls = document.createElement('div');
          controls.className = 'flex items-center justify-between gap-2';
          const favButton = document.createElement('button');
          favButton.type = 'button';
          favButton.className = 'rounded-xl2 bg-surface px-2 py-1 text-sm hover:opacity-90';
          favButton.textContent = tile.fav ? '★ Favorited' : '☆ Favorite';
          favButton.addEventListener('click', () => {
            tile.fav = !tile.fav;
            this.#renderRounds();
            this.#updateSelectedCount();
          });

          const finalButton = document.createElement('button');
          finalButton.type = 'button';
          finalButton.className = 'rounded-xl2 bg-surface px-2 py-1 text-sm hover:opacity-90';
          finalButton.textContent = 'Use as final';
          finalButton.addEventListener('click', () => {
            this.#startFinalCompare(tile.imageUrl);
          });

          controls.append(favButton, finalButton);

          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = 'Details anzeigen';
          const descriptor = document.createElement('p');
          descriptor.className = 'text-sm text-textMuted mt-1 whitespace-pre-wrap';
          descriptor.textContent = tile.text || '(no descriptor)';
          details.append(summary, descriptor);

          const note = document.createElement('input');
          note.type = 'text';
          note.placeholder = 'Optional note for next round (this favorite)';
          note.value = tile.note || '';
          note.className = `${tile.fav ? '' : 'hidden '}rounded-xl2 bg-surface px-2 py-1 text-sm`;
          note.addEventListener('input', () => {
            tile.note = note.value;
          });

          card.append(image, controls, details, note);
        } else if (tile.error) {
          const message = document.createElement('p');
          message.className = 'text-sm text-textMuted';
          message.textContent = `Generation failed: ${tile.error}`;
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'rounded-xl2 bg-surface px-3 py-2 text-sm hover:opacity-90';
          retry.textContent = 'Retry';
          retry.addEventListener('click', () => {
            this.#retryTile(round, tileIndex);
          });
          card.append(message, retry);
        } else {
          const placeholder = document.createElement('div');
          placeholder.className = 'animate-pulse h-28 rounded-xl2 bg-surface';
          card.append(placeholder);
        }
        grid.append(card);
      });

      section.append(grid);
      container.append(section);
    });

    this.#updateSelectedCount();
  }

  #updateSelectedCount() {
    const count = this.state.rounds.reduce(
      (total, round) => total + round.tiles.filter((tile) => tile.fav).length,
      0
    );
    this.state.selectedCount = count;
    this.elements.selCount.textContent = `${count} selected`;
    this.elements.generateBar.classList.toggle('hidden', count === 0);
  }

  #openSettings() {
    this.#renderSamplingInputs();
    this.#renderKeyStatus();
    this.elements.settingsModal.classList.remove('hidden');
    this.elements.settingsBackdrop.classList.remove('hidden');
  }

  #closeSettings() {
    this.elements.settingsModal.classList.add('hidden');
    this.elements.settingsBackdrop.classList.add('hidden');
  }

  async #startFinalCompare(imageUrl) {
    try {
      const candidateBlob = await (await fetch(imageUrl)).blob();
      const blobBase64 = await blobToBase64(candidateBlob);
      const result = await this.client.finalizeHiRes({
        promptText: FINAL_PROMPT,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        base64Child: blobBase64,
        mimeChild: candidateBlob.type || 'image/jpeg',
        references: this.state.refs,
        sampling: this.state.sampling,
      });
      this.state.candidate = { imageUrl: result.imageUrl, notes: result.text || '' };
      this.elements.finalCandidate.src = this.state.candidate.imageUrl;
      this.elements.finalCandidateNotes.textContent = this.state.candidate.notes;
      this.elements.finalCurrent.src = this.state.final.imageUrl || imageUrl;
      this.elements.finalCurrentNotes.textContent = this.state.final.notes || '(no build notes yet)';
      this.elements.finalModal.classList.remove('hidden');
      this.elements.finalBackdrop.classList.remove('hidden');
    } catch (error) {
      window.alert(`Finalization failed: ${error.message || error}`);
    }
  }

  #closeFinalModal() {
    this.elements.finalModal.classList.add('hidden');
    this.elements.finalBackdrop.classList.add('hidden');
  }
}
