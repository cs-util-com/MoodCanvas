/* istanbul ignore file */
/* eslint-disable complexity */

import {
  readGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  onKeyChange,
} from '../utils/key-store.js';
import {
  fileToResized,
  blobToBase64,
  blobUrlToBase64,
} from '../utils/image.js';
import { GeminiFlows, DEFAULT_SAMPLING } from '../utils/gemini-flows.js';
import {
  buildRoomBriefPrompt,
  favoritesToTextBlock,
  buildFinalizationPrompt,
  runIterationBatch,
  buildIterationPrompt,
} from '../utils/prompts.js';
import { diversityDeck } from '../utils/diversity.js';

const SAMPLING_STORAGE_KEY = 'moodcanvas.sampling';

function formatRoomBriefText(roomBrief) {
  if (!roomBrief || (!roomBrief.paragraph && !roomBrief.bullets?.length)) {
    return '';
  }
  const bullets = Array.isArray(roomBrief.bullets)
    ? roomBrief.bullets.map((item) => `• ${item}`).join('\n')
    : '';
  return [roomBrief.paragraph, bullets].filter(Boolean).join('\n');
}

function createButton(classes, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = classes;
  button.textContent = text;
  return button;
}

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.state = {
      apiKey: '',
      sampling: { ...DEFAULT_SAMPLING },
      main: null,
      purpose: '',
      firstNotes: '',
      references: [],
      roomBrief: {
        status: 'idle',
        paragraph: '',
        bullets: [],
        error: null,
        raw: '',
      },
      rounds: [],
      final: { imageUrl: '', notes: '' },
      candidate: { imageUrl: '', notes: '' },
      selectedCount: 0,
      runningRound: false,
    };
    this.gemini = new GeminiFlows();
    this.unsubscribeKey = null;
    this.roomBriefTimeout = null;
  }

  async init() {
    this.renderShell();
    this.bootstrapSampling();
    this.bootstrapKey();
    this.bindEvents();
    this.renderKeyStatus();
    this.renderKeyBanner();
    this.renderRoomBrief();
    this.renderRounds();
    this.updateGenerateBar();
  }

  destroy() {
    if (this.unsubscribeKey) {
      this.unsubscribeKey();
      this.unsubscribeKey = null;
    }
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col bg-plum text-plum-text">
        <header class="border-b border-plum-border/40 bg-plum-surface">
          <div class="mx-auto w-full max-w-6xl px-6 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.35em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-2xl md:text-3xl font-semibold">Iterative concept studio</h1>
              <p class="text-sm text-plum-muted max-w-xl">
                Upload one room photo, add optional purpose and style references, then iterate in 12-image rounds with notes, favorites, and hi-res finalization — all on-device with your Gemini API key.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span id="keyStatus" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs uppercase tracking-[0.3em] text-plum-muted"></span>
              <button id="settingsBtn" class="rounded-full bg-raspberry px-4 py-2 text-sm font-medium hover:bg-raspberry/80 transition">Settings</button>
            </div>
          </div>
        </header>
        <main class="flex-1">
          <div class="mx-auto w-full max-w-6xl px-6 py-8 flex flex-col gap-6">
            <section id="keyBanner" class="rounded-xl2 border border-raspberry/40 bg-raspberry/10 px-6 py-5 flex flex-col gap-4 hidden">
              <div>
                <h2 class="text-lg font-semibold">Bring your own Gemini key</h2>
                <p class="text-sm text-plum-muted">
                  Retrieve an API key from <a class="text-peach underline" href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>. The key is stored only in this browser.
                </p>
              </div>
              <div class="flex flex-col gap-3 md:flex-row md:items-center">
                <input id="bannerKeyInput" type="password" placeholder="AIza..." class="flex-1 rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/60" />
                <button id="bannerKeySave" class="rounded-xl2 bg-peach text-plum px-4 py-2 text-sm font-medium hover:bg-peach/80 transition">Save key</button>
              </div>
            </section>
            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface px-6 py-6 flex flex-col gap-5">
              <header class="flex items-center justify-between flex-wrap gap-2">
                <h2 class="text-xl font-semibold">Project setup</h2>
                <button id="btnFirst" class="rounded-full bg-peach text-plum px-4 py-2 text-sm font-medium hover:bg-peach/80 transition">Start generating first suggestions</button>
              </header>
              <div class="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div class="flex flex-col gap-4">
                  <label class="flex flex-col gap-2 text-sm">
                    <span class="text-plum-muted uppercase tracking-[0.2em] text-xs">Main room photo</span>
                    <input id="mainFile" type="file" accept="image/jpeg,image/png" capture="environment" class="rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-3 py-2" />
                  </label>
                  <div id="mainPreview" class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 min-h-[160px] flex items-center justify-center text-plum-muted text-sm">
                    Upload a room photo to begin.
                  </div>
                  <label class="flex flex-col gap-2 text-sm">
                    <span class="text-plum-muted uppercase tracking-[0.2em] text-xs">Intended use</span>
                    <input id="purposeInput" type="text" placeholder="e.g. Cozy living room for evening gatherings" class="rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/60" />
                  </label>
                  <label class="flex flex-col gap-2 text-sm">
                    <span class="text-plum-muted uppercase tracking-[0.2em] text-xs">Initial notes (optional)</span>
                    <textarea id="firstNotesInput" rows="3" placeholder="Key functional goals or atmosphere cues" class="rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/60"></textarea>
                  </label>
                </div>
                <div class="flex flex-col gap-3">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium">Style references (0–2)</span>
                    <span class="text-xs text-plum-muted">First = strongest influence</span>
                  </div>
                  <div id="refsContainer" class="flex flex-col gap-3"></div>
                </div>
              </div>
              <p id="firstHint" class="text-sm text-plum-muted"></p>
            </section>
            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface px-6 py-5 flex flex-col gap-4">
              <header class="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 class="text-xl font-semibold">Room brief</h2>
                  <p class="text-sm text-plum-muted">Generated silently from the base photo and intended use. Updates automatically if the purpose changes.</p>
                </div>
                <button id="regenBrief" class="rounded-full border border-plum-border/50 px-4 py-2 text-sm hover:bg-plum-surface-2 transition">Regenerate</button>
              </header>
              <div id="roomBriefContent" class="text-sm text-plum-muted"></div>
            </section>
            <section class="flex flex-col gap-3">
              <div class="flex items-center justify-between flex-wrap gap-2">
                <h2 class="text-xl font-semibold">Iterations</h2>
                <button id="btnRestart" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm hover:bg-plum-surface/80 transition">Restart (clear generated rounds)</button>
              </div>
              <div id="iterations" class="flex flex-col gap-4"></div>
            </section>
          </div>
        </main>
        <div id="generateBar" class="hidden border-t border-plum-border/50 bg-plum-surface px-6 py-4">
          <div class="mx-auto flex w-full max-w-6xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex flex-col gap-2 md:flex-row md:items-center md:gap-4 w-full">
              <span id="selCount" class="text-sm text-plum-muted">0 selected</span>
              <input id="roundGuidance" type="text" placeholder="Guidance for next iteration" class="flex-1 rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/60" />
            </div>
            <button id="btnGenerate" class="rounded-full bg-peach text-plum px-5 py-2 text-sm font-semibold hover:bg-peach/80 transition md:self-start">Generate next iteration</button>
          </div>
        </div>
      </div>
      <div id="finalBackdrop" class="hidden fixed inset-0 z-40 bg-black/70"></div>
      <div id="finalModal" class="hidden fixed inset-0 z-40 flex items-center justify-center px-4 py-8 overflow-auto">
        <div class="w-full max-w-5xl rounded-xl2 border border-plum-border/40 bg-plum-surface px-6 py-6 shadow-dialog">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">Compare & decide</h3>
            <button id="finalClose" class="rounded-full border border-plum-border/60 px-3 py-1 text-sm hover:bg-plum-surface-2">Close</button>
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p class="text-sm text-plum-muted mb-2">Current final</p>
              <img id="finalCurrent" class="w-full rounded-xl2 border border-plum-border/40 bg-plum-surface-2" alt="Current final render" />
              <p id="finalCurrentNotes" class="mt-2 text-sm text-plum-muted whitespace-pre-wrap"></p>
            </div>
            <div>
              <p class="text-sm text-plum-muted mb-2">Candidate</p>
              <img id="finalCandidate" class="w-full rounded-xl2 border border-plum-border/40 bg-plum-surface-2" alt="Candidate render" />
              <p id="finalCandidateNotes" class="mt-2 text-sm text-plum-muted whitespace-pre-wrap"></p>
            </div>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button id="finalKeep" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm hover:bg-plum-surface-2">Keep current</button>
            <button id="finalReplace" class="rounded-full bg-peach text-plum px-4 py-2 text-sm font-semibold hover:bg-peach/80">Replace with candidate</button>
          </div>
        </div>
      </div>
      <dialog id="settingsModal" class="backdrop:bg-black/70 rounded-xl2 bg-plum-surface text-plum-text shadow-dialog p-0">
        <form method="dialog" class="flex flex-col gap-6 p-6 min-w-[320px]">
          <header class="flex flex-col gap-1">
            <h2 class="text-xl font-semibold">Settings</h2>
            <p class="text-sm text-plum-muted">Manage sampling settings and your Gemini API key.</p>
          </header>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between text-sm">
              <span>Gemini API key</span>
              <span id="settingsKeyStatus" class="text-xs text-plum-muted"></span>
            </div>
            <input id="settingsKeyInput" type="password" placeholder="AIza..." class="rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/60" />
            <button id="settingsRemoveKey" type="button" class="self-start rounded-full border border-raspberry/60 px-3 py-1 text-sm text-raspberry hover:bg-raspberry/10">Remove key from this device</button>
          </div>
          <fieldset class="flex flex-col gap-4">
            <legend class="text-sm font-semibold">Sampling</legend>
            <label class="flex flex-col gap-1 text-sm">
              <span>Temperature: <span id="tempValue"></span></span>
              <input id="tempSlider" type="range" min="0" max="1.2" step="0.1" />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>topP: <span id="topPValue"></span></span>
              <input id="topPSlider" type="range" min="0" max="1" step="0.05" />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span>topK: <span id="topKValue"></span></span>
              <input id="topKSlider" type="range" min="1" max="64" step="1" />
            </label>
            <button id="samplingReset" type="button" class="self-start rounded-full border border-plum-border/60 px-3 py-1 text-sm hover:bg-plum-surface-2">Reset to defaults</button>
          </fieldset>
          <div class="flex justify-end gap-3">
            <button type="button" id="settingsCancel" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm hover:bg-plum-surface-2">Cancel</button>
            <button type="submit" class="rounded-full bg-peach text-plum px-4 py-2 text-sm font-semibold hover:bg-peach/80">Save</button>
          </div>
        </form>
      </dialog>
    `;

    this.elements = {
      keyStatus: this.root.querySelector('#keyStatus'),
      keyBanner: this.root.querySelector('#keyBanner'),
      bannerKeyInput: this.root.querySelector('#bannerKeyInput'),
      bannerKeySave: this.root.querySelector('#bannerKeySave'),
      settingsBtn: this.root.querySelector('#settingsBtn'),
      settingsModal: this.root.querySelector('#settingsModal'),
      settingsKeyInput: this.root.querySelector('#settingsKeyInput'),
      settingsKeyStatus: this.root.querySelector('#settingsKeyStatus'),
      settingsRemoveKey: this.root.querySelector('#settingsRemoveKey'),
      settingsCancel: this.root.querySelector('#settingsCancel'),
      tempSlider: this.root.querySelector('#tempSlider'),
      topPSlider: this.root.querySelector('#topPSlider'),
      topKSlider: this.root.querySelector('#topKSlider'),
      tempValue: this.root.querySelector('#tempValue'),
      topPValue: this.root.querySelector('#topPValue'),
      topKValue: this.root.querySelector('#topKValue'),
      samplingReset: this.root.querySelector('#samplingReset'),
      mainFile: this.root.querySelector('#mainFile'),
      mainPreview: this.root.querySelector('#mainPreview'),
      purposeInput: this.root.querySelector('#purposeInput'),
      firstNotesInput: this.root.querySelector('#firstNotesInput'),
      refsContainer: this.root.querySelector('#refsContainer'),
      btnFirst: this.root.querySelector('#btnFirst'),
      btnRestart: this.root.querySelector('#btnRestart'),
      firstHint: this.root.querySelector('#firstHint'),
      regenBrief: this.root.querySelector('#regenBrief'),
      roomBriefContent: this.root.querySelector('#roomBriefContent'),
      iterations: this.root.querySelector('#iterations'),
      generateBar: this.root.querySelector('#generateBar'),
      selCount: this.root.querySelector('#selCount'),
      roundGuidance: this.root.querySelector('#roundGuidance'),
      btnGenerate: this.root.querySelector('#btnGenerate'),
      finalBackdrop: this.root.querySelector('#finalBackdrop'),
      finalModal: this.root.querySelector('#finalModal'),
      finalClose: this.root.querySelector('#finalClose'),
      finalCurrent: this.root.querySelector('#finalCurrent'),
      finalCandidate: this.root.querySelector('#finalCandidate'),
      finalCurrentNotes: this.root.querySelector('#finalCurrentNotes'),
      finalCandidateNotes: this.root.querySelector('#finalCandidateNotes'),
      finalKeep: this.root.querySelector('#finalKeep'),
      finalReplace: this.root.querySelector('#finalReplace'),
    };
  }

  bootstrapSampling() {
    try {
      const stored = window.localStorage.getItem(SAMPLING_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          typeof parsed === 'object' &&
          parsed &&
          'temperature' in parsed &&
          'topP' in parsed &&
          'topK' in parsed
        ) {
          this.state.sampling = {
            temperature: Number(parsed.temperature),
            topP: Number(parsed.topP),
            topK: Number(parsed.topK),
          };
        }
      }
    } catch (error) {
      console.warn('Unable to restore sampling settings', error);
    }
    this.updateSamplingUI();
  }

  saveSampling() {
    try {
      window.localStorage.setItem(
        SAMPLING_STORAGE_KEY,
        JSON.stringify(this.state.sampling)
      );
    } catch (error) {
      console.warn('Unable to persist sampling settings', error);
    }
  }

  bootstrapKey() {
    const key = readGeminiKey();
    this.state.apiKey = key;
    this.gemini.setApiKey(key);
    this.unsubscribeKey = onKeyChange(() => {
      const next = readGeminiKey();
      this.state.apiKey = next;
      this.gemini.setApiKey(next);
      this.renderKeyStatus();
      this.renderKeyBanner();
    });
  }

  bindEvents() {
    this.elements.bannerKeySave.addEventListener('click', () => {
      const key = this.elements.bannerKeyInput.value.trim();
      saveGeminiKey(key);
      this.elements.bannerKeyInput.value = '';
    });

    this.elements.settingsBtn.addEventListener('click', () => {
      this.openSettings();
    });

    this.elements.settingsModal
      .querySelector('form')
      .addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const key = formData.get('settingsKeyInput');
        saveGeminiKey(typeof key === 'string' ? key : '');
        this.closeSettings();
      });

    this.elements.settingsCancel.addEventListener('click', () => {
      this.closeSettings();
    });

    this.elements.settingsRemoveKey.addEventListener('click', () => {
      clearGeminiKey();
      this.elements.settingsKeyInput.value = '';
      this.renderKeyStatus();
      this.renderKeyBanner();
    });

    this.elements.tempSlider.addEventListener('input', () => {
      this.state.sampling.temperature = Number(this.elements.tempSlider.value);
      this.updateSamplingUI();
      this.saveSampling();
    });

    this.elements.topPSlider.addEventListener('input', () => {
      this.state.sampling.topP = Number(this.elements.topPSlider.value);
      this.updateSamplingUI();
      this.saveSampling();
    });

    this.elements.topKSlider.addEventListener('input', () => {
      this.state.sampling.topK = Number(this.elements.topKSlider.value);
      this.updateSamplingUI();
      this.saveSampling();
    });

    this.elements.samplingReset.addEventListener('click', () => {
      this.state.sampling = { ...DEFAULT_SAMPLING };
      this.updateSamplingUI();
      this.saveSampling();
    });

    this.elements.mainFile.addEventListener('change', (event) => {
      this.handleMainFile(event).catch((error) => {
        console.error(error);
        alert('Failed to process main photo.');
      });
    });

    this.elements.purposeInput.addEventListener('input', () => {
      this.state.purpose = this.elements.purposeInput.value;
      this.scheduleRoomBriefRegeneration();
    });

    this.elements.firstNotesInput.addEventListener('input', () => {
      this.state.firstNotes = this.elements.firstNotesInput.value;
      this.scheduleRoomBriefRegeneration();
    });

    this.elements.btnFirst.addEventListener('click', () => {
      this.startFirstRound().catch((error) => {
        console.error(error);
        alert(error.message || 'Failed to start iteration.');
      });
    });

    this.elements.btnRestart.addEventListener('click', () => {
      if (
        window.confirm(
          'Restart will clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?'
        )
      ) {
        this.resetGeneratedState();
      }
    });

    this.elements.btnGenerate.addEventListener('click', () => {
      this.generateNextRound().catch((error) => {
        console.error(error);
        alert(error.message || 'Failed to generate next iteration.');
      });
    });

    this.elements.regenBrief.addEventListener('click', () => {
      this.refreshRoomBrief(true).catch((error) => {
        console.error(error);
        alert(error.message || 'Failed to regenerate room brief.');
      });
    });

    this.elements.finalClose.addEventListener('click', () =>
      this.closeFinalModal()
    );
    this.elements.finalBackdrop.addEventListener('click', () =>
      this.closeFinalModal()
    );
    this.elements.finalKeep.addEventListener('click', () =>
      this.closeFinalModal()
    );
    this.elements.finalReplace.addEventListener('click', () => {
      if (this.state.candidate.imageUrl) {
        this.state.final = { ...this.state.candidate };
        this.closeFinalModal();
        alert('Final image updated.');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeFinalModal();
        if (this.elements.settingsModal.open) {
          this.closeSettings();
        }
      }
    });

    this.renderReferences();
  }

  renderKeyStatus() {
    if (!this.elements.keyStatus) return;
    if (this.state.apiKey) {
      this.elements.keyStatus.textContent = 'Key stored locally';
      this.elements.keyStatus.classList.remove('text-raspberry');
    } else {
      this.elements.keyStatus.textContent = 'No API key';
      this.elements.keyStatus.classList.add('text-raspberry');
    }
  }

  renderKeyBanner() {
    if (!this.elements.keyBanner) return;
    const hasKey = Boolean(this.state.apiKey);
    this.elements.keyBanner.classList.toggle('hidden', hasKey);
  }

  openSettings() {
    if (!this.elements.settingsModal.open) {
      this.elements.settingsKeyInput.value = this.state.apiKey;
      this.elements.settingsKeyStatus.textContent = this.state.apiKey
        ? 'Key present on this device.'
        : 'No key set.';
      this.elements.settingsRemoveKey.disabled = !this.state.apiKey;
      this.updateSamplingUI();
      this.elements.settingsModal.showModal();
    }
  }

  closeSettings() {
    if (this.elements.settingsModal.open) {
      this.elements.settingsModal.close();
    }
  }

  updateSamplingUI() {
    this.elements.tempSlider.value = String(this.state.sampling.temperature);
    this.elements.topPSlider.value = String(this.state.sampling.topP);
    this.elements.topKSlider.value = String(this.state.sampling.topK);
    this.elements.tempValue.textContent =
      this.state.sampling.temperature.toFixed(1);
    this.elements.topPValue.textContent = this.state.sampling.topP.toFixed(2);
    this.elements.topKValue.textContent = String(
      Math.round(this.state.sampling.topK)
    );
  }

  async handleMainFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (this.state.main?.url) {
      URL.revokeObjectURL(this.state.main.url);
    }
    const processed = await fileToResized(file, 2048, 0.9);
    const thumbBase64 = await blobToBase64(processed.blob);
    this.state.main = {
      base64: thumbBase64,
      mime: processed.mime,
      url: processed.url,
      width: processed.width,
      height: processed.height,
    };
    this.elements.mainPreview.innerHTML = '';
    const img = document.createElement('img');
    img.src = processed.url;
    img.alt = 'Main room photo';
    img.className = 'w-full rounded-xl2';
    this.elements.mainPreview.appendChild(img);
    this.elements.firstHint.textContent = 'Main photo ready.';
  }

  async handleReferenceFile(index, file) {
    if (!file) {
      const removed = this.state.references.splice(index, 1)[0];
      if (removed?.url) {
        URL.revokeObjectURL(removed.url);
      }
      this.renderReferences();
      return;
    }
    if (this.state.references[index]?.url) {
      URL.revokeObjectURL(this.state.references[index].url);
    }
    const processed = await fileToResized(file, 2048, 0.9);
    const base64 = await blobToBase64(processed.blob);
    const reference = {
      base64,
      mime: processed.mime,
      url: processed.url,
      name: file.name,
    };
    this.state.references[index] = reference;
    this.state.references = this.state.references.filter(Boolean).slice(0, 2);
    this.renderReferences();
  }

  renderReferences() {
    const container = this.elements.refsContainer;
    container.innerHTML = '';
    this.state.references.forEach((ref, index) => {
      const wrapper = document.createElement('div');
      wrapper.className =
        'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-3 flex flex-col gap-3';
      const preview = document.createElement('img');
      preview.src = ref.url;
      preview.alt = ref.name || `Reference ${index + 1}`;
      preview.className = 'rounded-xl2 max-h-48 object-cover';
      preview.addEventListener('click', () => window.open(ref.url, '_blank'));

      const controls = document.createElement('div');
      controls.className = 'flex flex-wrap items-center gap-2 text-sm';

      if (index > 0) {
        const moveUp = createButton(
          'rounded-full border border-plum-border/60 px-3 py-1 text-xs hover:bg-plum-surface',
          'Move up'
        );
        moveUp.addEventListener('click', () => {
          const temp = this.state.references[index - 1];
          this.state.references[index - 1] = this.state.references[index];
          this.state.references[index] = temp;
          this.renderReferences();
        });
        controls.appendChild(moveUp);
      }

      const remove = createButton(
        'rounded-full border border-raspberry/60 px-3 py-1 text-xs text-raspberry hover:bg-raspberry/10',
        'Remove'
      );
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(ref.url);
        this.state.references.splice(index, 1);
        this.renderReferences();
      });
      controls.appendChild(remove);

      wrapper.append(preview, controls);
      container.appendChild(wrapper);
    });

    if (this.state.references.length < 2) {
      const addWrapper = document.createElement('div');
      addWrapper.className =
        'rounded-xl2 border border-dashed border-plum-border/60 bg-plum-surface-2 p-3 flex flex-col gap-2';
      const label = document.createElement('span');
      label.className = 'text-sm text-plum-muted';
      label.textContent = `Add reference ${this.state.references.length + 1}`;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png';
      input.className =
        'rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm';
      input.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        this.handleReferenceFile(this.state.references.length, file).catch(
          (error) => {
            console.error(error);
            alert('Failed to process reference image.');
          }
        );
      });
      addWrapper.append(label, input);
      container.appendChild(addWrapper);
    }
  }

  scheduleRoomBriefRegeneration() {
    if (!this.state.main) return;
    if (this.roomBriefTimeout) {
      clearTimeout(this.roomBriefTimeout);
    }
    this.roomBriefTimeout = setTimeout(() => {
      this.refreshRoomBrief(false).catch((error) => console.error(error));
    }, 600);
  }

  async refreshRoomBrief(forced) {
    if (!this.state.main) {
      throw new Error(
        'Upload the main photo before generating the room brief.'
      );
    }
    if (!this.state.apiKey) {
      throw new Error(
        'Add your Gemini API key before generating the room brief.'
      );
    }
    this.state.roomBrief = {
      ...this.state.roomBrief,
      status: 'loading',
      error: null,
    };
    this.renderRoomBrief();
    try {
      const promptText = buildRoomBriefPrompt({
        purpose: this.state.purpose,
        notes: this.state.firstNotes,
      });
      const result = await this.gemini.generateRoomBrief({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
      });
      this.state.roomBrief = {
        status: 'ready',
        paragraph: result.paragraph,
        bullets: result.bullets,
        raw: result.raw,
        error: null,
      };
      if (forced) {
        this.elements.firstHint.textContent = 'Room brief regenerated.';
      }
    } catch (error) {
      this.state.roomBrief = {
        status: 'error',
        paragraph: '',
        bullets: [],
        raw: '',
        error: error.message || 'Failed to generate room brief',
      };
      throw error;
    } finally {
      this.renderRoomBrief();
    }
  }

  renderRoomBrief() {
    const container = this.elements.roomBriefContent;
    const brief = this.state.roomBrief;
    container.innerHTML = '';
    if (brief.status === 'loading') {
      container.textContent = 'Generating room brief…';
      return;
    }
    if (brief.status === 'error') {
      container.innerHTML = `<span class="text-raspberry">${brief.error}</span>`;
      return;
    }
    if (!brief.paragraph) {
      container.textContent =
        'Room brief will appear here after the first generation.';
      return;
    }
    const paragraph = document.createElement('p');
    paragraph.className = 'text-sm text-plum-text';
    paragraph.textContent = brief.paragraph;
    container.appendChild(paragraph);
    if (brief.bullets?.length) {
      const list = document.createElement('ul');
      list.className = 'mt-3 list-disc space-y-1 pl-6 text-sm text-plum-muted';
      brief.bullets.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        list.appendChild(li);
      });
      container.appendChild(list);
    }
  }

  resetGeneratedState() {
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        if (tile.imageUrl) {
          URL.revokeObjectURL(tile.imageUrl);
        }
      });
    });
    this.state.rounds = [];
    this.state.final = { imageUrl: '', notes: '' };
    this.state.candidate = { imageUrl: '', notes: '' };
    this.state.selectedCount = 0;
    this.elements.roundGuidance.value = '';
    this.renderRounds();
    this.updateGenerateBar();
  }

  async startFirstRound() {
    if (!this.state.main) {
      throw new Error('Please upload the main photo first.');
    }
    await this.refreshRoomBrief(false);
    this.resetGeneratedState();
    await this.runRound();
    this.elements.btnFirst.textContent = 'Restart';
  }

  async generateNextRound() {
    if (this.state.selectedCount <= 0) {
      return;
    }
    await this.runRound();
    this.elements.roundGuidance.value = '';
  }

  getSelectedFavorites() {
    const favorites = [];
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        if (tile.fav && tile.status === 'ok') {
          favorites.push(tile);
        }
      });
    });
    return favorites;
  }

  clearFavorites() {
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        tile.fav = false;
      });
    });
    this.state.selectedCount = 0;
  }

  async runRound() {
    if (this.state.runningRound) {
      return;
    }
    if (!this.state.apiKey) {
      throw new Error('Add your Gemini API key before generating iterations.');
    }
    this.state.runningRound = true;
    const roundIndex = this.state.rounds.length + 1;
    const round = {
      index: roundIndex,
      open: true,
      tiles: Array.from({ length: 12 }, () => ({
        status: 'loading',
        fav: false,
        note: '',
        warnings: [],
      })),
    };
    this.state.rounds.push(round);
    this.renderRounds();

    const favorites = this.getSelectedFavorites();
    const favoritesTextBlock = favoritesToTextBlock(favorites);
    this.clearFavorites();
    this.updateGenerateBar();

    const references = this.state.references
      .filter(Boolean)
      .slice(0, 2)
      .map((ref) => ({ mime: ref.mime, base64: ref.base64 }));

    const guidance = this.elements.roundGuidance.value;
    round.guidance = guidance;
    round.references = references;
    round.favoritesTextBlock = favoritesTextBlock;
    round.roomBriefText = formatRoomBriefText(this.state.roomBrief);
    round.deck = diversityDeck();
    try {
      await runIterationBatch({
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references,
        roomBrief: round.roomBriefText,
        purpose: this.state.purpose,
        roundGuidance: guidance,
        favoritesTextBlock,
        sampling: this.state.sampling,
        generateVariant: (payload) => this.gemini.generateVariant(payload),
        onProgress: ({ index, ok, result, error }) => {
          const tile = round.tiles[index];
          if (ok) {
            tile.status = 'ok';
            tile.imageUrl = result.imageUrl;
            tile.text = result.text;
            tile.warnings = result.warnings ?? [];
            tile.fav = false;
            tile.note = '';
          } else {
            tile.status = 'error';
            tile.error = error?.message || String(error);
          }
          this.renderRounds();
        },
        deck: round.deck,
      });
    } finally {
      this.state.runningRound = false;
    }
  }

  renderRounds() {
    const container = this.elements.iterations;
    container.innerHTML = '';
    // auto-collapse older rounds except last two
    this.state.rounds.forEach((round, index) => {
      round.open = index >= this.state.rounds.length - 2;
    });

    this.state.rounds.forEach((round, roundIdx) => {
      const section = document.createElement('section');
      section.className =
        'rounded-xl2 border border-plum-border/40 bg-plum-surface px-4 py-4';

      const header = document.createElement('div');
      header.className = 'flex items-center justify-between flex-wrap gap-2';
      const title = document.createElement('h3');
      title.className = 'text-lg font-semibold';
      title.textContent = `Iteration #${round.index}`;
      const toggle = createButton(
        'rounded-full border border-plum-border/60 px-3 py-1 text-xs hover:bg-plum-surface-2',
        round.open ? 'Collapse' : 'Expand'
      );
      toggle.addEventListener('click', () => {
        round.open = !round.open;
        this.renderRounds();
      });
      header.append(title, toggle);
      section.appendChild(header);

      const grid = document.createElement('div');
      grid.className = round.open
        ? 'mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3'
        : 'hidden';

      round.tiles.forEach((tile, tileIndex) => {
        const card = document.createElement('div');
        card.className =
          'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-3 flex flex-col gap-3';
        if (tile.status === 'loading') {
          const skeleton = document.createElement('div');
          skeleton.className = 'animate-pulse h-28 rounded-xl2 bg-plum-surface';
          card.appendChild(skeleton);
        } else if (tile.status === 'error') {
          const message = document.createElement('p');
          message.className = 'text-sm text-plum-muted';
          message.textContent = `Generation failed: ${tile.error}`;
          const retry = createButton(
            'self-start rounded-full border border-plum-border/60 px-3 py-1 text-xs hover:bg-plum-surface',
            'Retry'
          );
          retry.addEventListener('click', () => {
            this.retryTile(roundIdx, tileIndex).catch((error) => {
              console.error(error);
              alert(error.message || 'Retry failed.');
            });
          });
          card.append(message, retry);
        } else {
          const img = document.createElement('img');
          img.src = tile.imageUrl;
          img.alt = `Iteration ${round.index} image`;
          img.className = 'w-full rounded-xl2 cursor-pointer';
          img.addEventListener('click', () =>
            window.open(tile.imageUrl, '_blank')
          );

          const controls = document.createElement('div');
          controls.className =
            'flex flex-wrap items-center justify-between gap-2 text-xs';

          const favBtn = createButton(
            tile.fav
              ? 'rounded-full bg-peach text-plum px-3 py-1'
              : 'rounded-full border border-plum-border/60 px-3 py-1 hover:bg-plum-surface',
            tile.fav ? '★ Favorited' : '☆ Favorite'
          );
          favBtn.addEventListener('click', () => {
            tile.fav = !tile.fav;
            this.updateGenerateBar();
            this.renderRounds();
          });

          const finalBtn = createButton(
            'rounded-full border border-plum-border/60 px-3 py-1 hover:bg-plum-surface',
            'Use as final'
          );
          finalBtn.addEventListener('click', () => {
            this.startFinalCompare(tile).catch((error) => {
              console.error(error);
              alert(error.message || 'Finalization failed.');
            });
          });

          controls.append(favBtn, finalBtn);

          const details = document.createElement('details');
          const summary = document.createElement('summary');
          summary.className = 'cursor-pointer text-sm text-plum-muted';
          summary.textContent = 'Details';
          const desc = document.createElement('p');
          desc.className = 'mt-2 whitespace-pre-wrap text-sm text-plum-text';
          desc.textContent = tile.text || '(No descriptor provided)';
          details.append(summary, desc);

          const warnings = document.createElement('div');
          if (tile.warnings?.length) {
            warnings.className = 'text-xs text-raspberry';
            warnings.textContent = tile.warnings.join(' • ');
          }

          const note = document.createElement('textarea');
          note.className = tile.fav
            ? 'rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm'
            : 'hidden';
          note.rows = 2;
          note.placeholder = 'Optional note for next round';
          note.value = tile.note || '';
          note.addEventListener('input', () => {
            tile.note = note.value;
          });

          card.append(img, controls, details);
          if (tile.warnings?.length) {
            card.appendChild(warnings);
          }
          card.appendChild(note);
        }

        grid.appendChild(card);
      });

      section.appendChild(grid);
      container.appendChild(section);
    });

    this.updateGenerateBar();
  }

  updateGenerateBar() {
    const favorites = this.getSelectedFavorites();
    this.state.selectedCount = favorites.length;
    this.elements.selCount.textContent = `${favorites.length} selected`;
    this.elements.generateBar.classList.toggle(
      'hidden',
      favorites.length === 0
    );
  }

  async retryTile(roundIndex, tileIndex) {
    const round = this.state.rounds[roundIndex];
    const tile = round.tiles[tileIndex];
    tile.status = 'loading';
    tile.error = undefined;
    this.renderRounds();
    try {
      const deck = round.deck || diversityDeck();
      const diversityHint = deck[tileIndex % deck.length];
      const promptText = buildIterationPrompt({
        roomBrief: round.roomBriefText,
        purpose: this.state.purpose,
        roundGuidance: round.guidance,
        favoritesTextBlock: round.favoritesTextBlock,
        diversityHint,
      });
      const result = await this.gemini.generateVariant({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: round.references,
        sampling: this.state.sampling,
      });
      tile.status = 'ok';
      if (tile.imageUrl) {
        URL.revokeObjectURL(tile.imageUrl);
      }
      tile.imageUrl = result.imageUrl;
      tile.text = result.text;
      tile.warnings = result.warnings ?? [];
      tile.fav = false;
      tile.note = '';
    } catch (error) {
      tile.status = 'error';
      tile.error = error.message || String(error);
    }
    this.renderRounds();
  }

  async startFinalCompare(tile) {
    if (!this.state.main) {
      throw new Error('Main photo missing.');
    }
    const promptText = buildFinalizationPrompt();
    const base64Child = await blobUrlToBase64(tile.imageUrl);
    const references = this.state.references
      .filter(Boolean)
      .slice(0, 2)
      .map((ref) => ({ mime: ref.mime, base64: ref.base64 }));
    const result = await this.gemini.finalizeHiRes({
      promptText,
      base64Main: this.state.main.base64,
      mimeMain: this.state.main.mime,
      base64Child,
      mimeChild: 'image/jpeg',
      references,
      sampling: this.state.sampling,
    });
    this.state.candidate = {
      imageUrl: result.imageUrl,
      notes: result.text || '',
    };
    this.elements.finalCandidate.src = result.imageUrl;
    this.elements.finalCandidateNotes.textContent = result.text || '';
    this.elements.finalCurrent.src = this.state.final.imageUrl || tile.imageUrl;
    this.elements.finalCurrentNotes.textContent =
      this.state.final.notes || '(No build notes yet)';
    this.openFinalModal();
  }

  openFinalModal() {
    this.elements.finalBackdrop.classList.remove('hidden');
    this.elements.finalModal.classList.remove('hidden');
  }

  closeFinalModal() {
    this.elements.finalBackdrop.classList.add('hidden');
    this.elements.finalModal.classList.add('hidden');
  }
}
