/* istanbul ignore file */
import {
  readGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  onKeyChange,
} from '../utils/key-store.js';
import {
  normalizeImageFile,
  blobToBase64,
  blobToDataUrl,
} from '../utils/image.js';
import {
  DEFAULT_SAMPLING,
  generateRoomBrief,
  finalizeHiRes,
  generateVariant,
} from '../utils/gemini-iteration.js';
import {
  buildRoomBriefPrompt,
  buildFavoritesTextBlock,
  buildFinalizationPrompt,
  buildIterationPrompt,
} from '../utils/iteration-prompts.js';
import { runIterationBatch } from '../utils/iteration-runner.js';
import { ensureProject, getProject } from '../utils/project-store.js';
import { diversityDeck } from '../utils/diversity.js';

const STORAGE_PROJECT_KEY = 'moodcanvas.currentProjectId';
const STORAGE_SAMPLING_KEY = 'moodcanvas.iteration.sampling';

function loadSampling() {
  try {
    const raw = localStorage.getItem(STORAGE_SAMPLING_KEY);
    return raw
      ? { ...DEFAULT_SAMPLING, ...JSON.parse(raw) }
      : { ...DEFAULT_SAMPLING };
  } catch (error) {
    console.warn('Failed to read sampling', error);
    return { ...DEFAULT_SAMPLING };
  }
}

function saveSampling(sampling) {
  try {
    localStorage.setItem(STORAGE_SAMPLING_KEY, JSON.stringify(sampling));
  } catch (error) {
    console.warn('Failed to persist sampling', error);
  }
}

function emptyRoomBrief() {
  return {
    status: 'idle',
    paragraph: '',
    bullets: [],
    raw: '',
    error: null,
  };
}

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.state = {
      apiKey: '',
      sampling: loadSampling(),
      main: null,
      purpose: '',
      firstNotes: '',
      refs: [],
      roomBrief: emptyRoomBrief(),
      rounds: [],
      selectedCount: 0,
      roundGuidance: '',
      isGenerating: false,
      project: null,
      final: { imageUrl: '', notes: '', base64: '', mime: '' },
      candidate: { imageUrl: '', notes: '' },
    };
    this.unsubscribeKey = null;
    this.dragIndex = null;
  }

  async init() {
    this.renderShell();
    await this.bootstrapProject();
    this.bootstrapKey();
    this.render();
  }

  destroy() {
    if (this.unsubscribeKey) {
      this.unsubscribeKey();
      this.unsubscribeKey = null;
    }
  }

  async bootstrapProject() {
    const existingId = localStorage.getItem(STORAGE_PROJECT_KEY);
    let project = await getProject(existingId);
    if (!project) {
      project = await ensureProject({ name: 'Iteration Session' });
      localStorage.setItem(STORAGE_PROJECT_KEY, project.id);
    }
    this.state.project = project;
  }

  bootstrapKey() {
    const key = readGeminiKey();
    this.state.apiKey = key;
    this.unsubscribeKey = onKeyChange(() => {
      this.state.apiKey = readGeminiKey();
      this.renderKeyStatus();
      this.renderKeyBanner();
    });
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full bg-plum text-plum-text flex flex-col">
        <header class="border-b border-plum-border/50 bg-plum-surface">
          <div class="mx-auto w-full max-w-5xl px-4 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.3em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-3xl font-semibold">Iterative Interior Canvas</h1>
              <p class="text-sm text-plum-muted max-w-2xl">
                Upload a base room photo, explore iterative AI variants, and converge on a final design without leaving your browser.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span id="keyStatus" class="rounded-full border border-plum-border/50 px-3 py-1 text-xs uppercase tracking-wide"></span>
              <button id="settingsBtn" class="rounded-full bg-raspberry text-white px-4 py-2 text-sm font-medium hover:bg-raspberry/90 transition">Settings</button>
            </div>
          </div>
        </header>
        <main class="flex-1">
          <div class="mx-auto w-full max-w-5xl px-4 py-8 flex flex-col gap-6">
            <section id="keyBanner" class="hidden rounded-xl2 border border-raspberry/60 bg-raspberry/15 p-5 flex flex-col gap-3 text-sm text-raspberry"></section>
            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-5 flex flex-col gap-5">
              <div class="flex flex-col gap-2">
                <h2 class="text-lg font-semibold">1. Set up your project</h2>
                <p class="text-sm text-plum-muted">Upload the main target photo, optionally add a purpose and two style references.</p>
              </div>
              <div class="flex flex-col gap-5 lg:flex-row">
                <div class="flex-1 flex flex-col gap-3">
                  <label class="flex flex-col gap-2 text-sm">
                    <span>Main room photo</span>
                    <div class="relative rounded-xl2 border border-dashed border-peach/60 bg-plum-surface text-center p-6 flex flex-col items-center gap-3">
                      <input id="mainFile" type="file" accept="image/jpeg,image/png" capture="environment" class="absolute inset-0 opacity-0 cursor-pointer" />
                      <span class="text-sm">Tap to upload</span>
                      <span class="text-xs text-plum-muted">Long edge ≤ 2048 px • Metadata preserved</span>
                    </div>
                  </label>
                  <div id="mainPreview" class="rounded-xl2 border border-plum-border/40 bg-plum-surface overflow-hidden hidden"></div>
                </div>
                <div class="flex-1 flex flex-col gap-4">
                  <label class="flex flex-col gap-2 text-sm">
                    <span>Intended purpose</span>
                    <input id="purposeInput" type="text" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="e.g., Cozy reading lounge" />
                  </label>
                  <label class="flex flex-col gap-2 text-sm">
                    <span>Notes for the first brief</span>
                    <textarea id="firstNotesInput" rows="3" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="Optional context"></textarea>
                  </label>
                  <div>
                    <button id="startButton" class="rounded-full bg-peach/90 text-plum px-4 py-2 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">Start generating first suggestions</button>
                    <p id="startHint" class="text-xs text-plum-muted mt-2">Upload a photo to unlock the first round.</p>
                  </div>
                </div>
              </div>
              <div class="flex flex-col gap-3">
                <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Style references (optional, drag to reorder)</h3>
                <div id="references" class="grid gap-3 sm:grid-cols-2"></div>
              </div>
            </section>
            <section id="roomBriefSection" class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-5 hidden flex flex-col gap-3"></section>
            <section id="roundsContainer" class="flex flex-col gap-4"></section>
          </div>
        </main>
        <footer class="p-4 text-xs text-plum-muted text-center">All data stays in your browser. Restart clears only generated iterations.</footer>
        <div id="generateBar" class="hidden sticky bottom-0 z-40 border-t border-plum-border/40 bg-plum-surface/95 backdrop-blur px-4 py-3">
          <div class="mx-auto flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="flex items-center gap-3 text-sm">
              <span id="selectedCount" class="rounded-full bg-plum-surface-2 px-3 py-1">0 selected</span>
              <input id="roundGuidanceInput" type="text" class="w-64 max-w-full rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="Guidance for next iteration" />
            </div>
            <div class="flex items-center gap-3">
              <button id="generateNextButton" class="rounded-full bg-peach/90 text-plum px-4 py-2 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed">Generate next iteration</button>
              <button id="restartButton" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm hover:bg-plum-surface-2">Restart</button>
            </div>
          </div>
        </div>
        <div id="settingsBackdrop" class="hidden fixed inset-0 z-40 bg-black/60"></div>
        <div id="settingsModal" class="hidden fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="max-w-md w-full rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4">
            <header class="flex items-start justify-between">
              <div>
                <h2 class="text-xl font-semibold">Settings</h2>
                <p class="text-sm text-plum-muted">Manage your Gemini key and sampling parameters.</p>
              </div>
              <button id="settingsClose" class="text-sm text-plum-muted">Close</button>
            </header>
            <label class="flex flex-col gap-2 text-sm">
              <span>Gemini API key</span>
              <input id="settingsKey" type="password" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="AIza..." />
            </label>
            <div class="grid gap-3 text-sm">
              <label class="flex flex-col gap-1">
                <span>Temperature <span class="text-xs text-plum-muted" id="tempValue"></span></span>
                <input id="temperatureInput" type="range" min="0" max="1" step="0.05" />
              </label>
              <label class="flex flex-col gap-1">
                <span>topP <span class="text-xs text-plum-muted" id="toppValue"></span></span>
                <input id="toppInput" type="range" min="0" max="1" step="0.05" />
              </label>
              <label class="flex flex-col gap-1">
                <span>topK <span class="text-xs text-plum-muted" id="topkValue"></span></span>
                <input id="topkInput" type="range" min="1" max="64" step="1" />
              </label>
              <button id="samplingReset" class="self-start rounded-full border border-plum-border/60 px-3 py-1 text-xs">Reset defaults</button>
            </div>
            <div class="flex justify-between items-center">
              <button id="removeKey" class="text-sm text-raspberry">Remove key from this device</button>
              <button id="settingsSave" class="rounded-full bg-peach/90 text-plum px-4 py-2 text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
        <div id="finalBackdrop" class="hidden fixed inset-0 z-50 bg-black/70"></div>
        <div id="finalModal" class="hidden fixed inset-0 z-50 overflow-auto p-4">
          <div class="mx-auto max-w-5xl rounded-xl2 border border-plum-border/50 bg-plum-surface-2 p-4 flex flex-col gap-4">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">Compare & Decide</h3>
              <button id="finalClose" class="text-sm text-plum-muted">Close</button>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <p class="text-sm text-plum-muted mb-2">Current final</p>
                <img id="finalCurrent" class="w-full rounded-xl2 border border-plum-border/30 bg-plum-surface" alt="Current final render" />
                <p id="finalCurrentNotes" class="text-sm text-plum-muted mt-2 whitespace-pre-wrap"></p>
              </div>
              <div>
                <p class="text-sm text-plum-muted mb-2">Candidate</p>
                <img id="finalCandidate" class="w-full rounded-xl2 border border-plum-border/30 bg-plum-surface" alt="Candidate render" />
                <p id="finalCandidateNotes" class="text-sm text-plum-muted mt-2 whitespace-pre-wrap"></p>
              </div>
            </div>
            <div class="flex justify-end gap-3">
              <button id="finalKeep" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm">Keep current</button>
              <button id="finalReplace" class="rounded-full bg-peach/90 text-plum px-4 py-2 text-sm font-medium">Replace with candidate</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.keyStatusEl = this.root.querySelector('#keyStatus');
    this.keyBannerEl = this.root.querySelector('#keyBanner');
    this.keyBannerInput = null;
    this.mainFileInput = this.root.querySelector('#mainFile');
    this.mainPreview = this.root.querySelector('#mainPreview');
    this.purposeInput = this.root.querySelector('#purposeInput');
    this.firstNotesInput = this.root.querySelector('#firstNotesInput');
    this.startButton = this.root.querySelector('#startButton');
    this.startHint = this.root.querySelector('#startHint');
    this.referencesEl = this.root.querySelector('#references');
    this.roomBriefEl = this.root.querySelector('#roomBriefSection');
    this.roundsContainer = this.root.querySelector('#roundsContainer');
    this.generateBar = this.root.querySelector('#generateBar');
    this.selectedCountEl = this.root.querySelector('#selectedCount');
    this.roundGuidanceInput = this.root.querySelector('#roundGuidanceInput');
    this.generateNextButton = this.root.querySelector('#generateNextButton');
    this.restartButton = this.root.querySelector('#restartButton');
    this.settingsBtn = this.root.querySelector('#settingsBtn');
    this.settingsBackdrop = this.root.querySelector('#settingsBackdrop');
    this.settingsModal = this.root.querySelector('#settingsModal');
    this.settingsClose = this.root.querySelector('#settingsClose');
    this.settingsKeyInput = this.root.querySelector('#settingsKey');
    this.temperatureInput = this.root.querySelector('#temperatureInput');
    this.toppInput = this.root.querySelector('#toppInput');
    this.topkInput = this.root.querySelector('#topkInput');
    this.tempValue = this.root.querySelector('#tempValue');
    this.toppValue = this.root.querySelector('#toppValue');
    this.topkValue = this.root.querySelector('#topkValue');
    this.samplingReset = this.root.querySelector('#samplingReset');
    this.removeKeyBtn = this.root.querySelector('#removeKey');
    this.settingsSaveBtn = this.root.querySelector('#settingsSave');
    this.finalBackdrop = this.root.querySelector('#finalBackdrop');
    this.finalModal = this.root.querySelector('#finalModal');
    this.finalClose = this.root.querySelector('#finalClose');
    this.finalCurrent = this.root.querySelector('#finalCurrent');
    this.finalCandidate = this.root.querySelector('#finalCandidate');
    this.finalCurrentNotes = this.root.querySelector('#finalCurrentNotes');
    this.finalCandidateNotes = this.root.querySelector('#finalCandidateNotes');
    this.finalKeep = this.root.querySelector('#finalKeep');
    this.finalReplace = this.root.querySelector('#finalReplace');

    this.mainFileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importMainPhoto(file).catch((error) => this.reportError(error));
      }
    });
    this.purposeInput.addEventListener('change', () => {
      this.state.purpose = this.purposeInput.value;
      if (this.state.main && this.hasRoomBrief()) {
        this.generateRoomBrief().catch((error) => this.reportError(error));
      }
    });
    this.firstNotesInput.addEventListener('input', () => {
      this.state.firstNotes = this.firstNotesInput.value;
    });
    this.startButton.addEventListener('click', () => {
      if (this.state.rounds.length === 0) {
        this.startFirstRound().catch((error) => this.reportError(error));
      } else {
        this.confirmRestart();
      }
    });
    this.generateNextButton.addEventListener('click', () => {
      this.generateNextIteration().catch((error) => this.reportError(error));
    });
    this.restartButton.addEventListener('click', () => this.confirmRestart());
    this.roundGuidanceInput.addEventListener('input', () => {
      this.state.roundGuidance = this.roundGuidanceInput.value;
    });

    this.settingsBtn.addEventListener('click', () => this.openSettings());
    this.settingsClose.addEventListener('click', () => this.closeSettings());
    this.settingsBackdrop.addEventListener('click', () => this.closeSettings());
    this.samplingReset.addEventListener('click', () => this.resetSampling());
    this.removeKeyBtn.addEventListener('click', () => {
      clearGeminiKey();
      this.settingsKeyInput.value = '';
      this.renderKeyBanner();
      this.renderKeyStatus();
    });
    this.settingsSaveBtn.addEventListener('click', () => {
      saveGeminiKey(this.settingsKeyInput.value ?? '');
      this.closeSettings();
    });

    this.temperatureInput.addEventListener('input', () => {
      this.state.sampling.temperature = Number.parseFloat(
        this.temperatureInput.value
      );
      this.renderSamplingInputs();
      saveSampling(this.state.sampling);
    });
    this.toppInput.addEventListener('input', () => {
      this.state.sampling.topP = Number.parseFloat(this.toppInput.value);
      this.renderSamplingInputs();
      saveSampling(this.state.sampling);
    });
    this.topkInput.addEventListener('input', () => {
      this.state.sampling.topK = Number.parseInt(this.topkInput.value, 10);
      this.renderSamplingInputs();
      saveSampling(this.state.sampling);
    });

    this.finalClose.addEventListener('click', () => this.closeFinalModal());
    this.finalBackdrop.addEventListener('click', () => this.closeFinalModal());
    this.finalKeep.addEventListener('click', () => this.closeFinalModal());
    this.finalReplace.addEventListener('click', () => {
      if (this.state.candidate.imageUrl) {
        this.state.final = {
          imageUrl: this.state.candidate.imageUrl,
          notes: this.state.candidate.notes,
          base64: this.state.candidate.base64,
          mime: this.state.candidate.mime,
        };
        this.closeFinalModal();
        this.renderRounds();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeSettings();
        this.closeFinalModal();
      }
    });
  }

  render() {
    this.renderKeyStatus();
    this.renderKeyBanner();
    if (this.purposeInput) {
      this.purposeInput.value = this.state.purpose;
    }
    if (this.firstNotesInput) {
      this.firstNotesInput.value = this.state.firstNotes;
    }
    if (this.roundGuidanceInput) {
      this.roundGuidanceInput.value = this.state.roundGuidance;
    }
    this.renderMainPreview();
    this.renderReferences();
    this.renderRoomBrief();
    this.renderRounds();
    this.renderGenerateBar();
    this.renderSamplingInputs();
  }

  renderKeyStatus() {
    if (!this.keyStatusEl) return;
    if (this.state.apiKey) {
      this.keyStatusEl.textContent = 'Key stored locally';
      this.keyStatusEl.classList.remove('bg-raspberry/20', 'text-raspberry');
    } else {
      this.keyStatusEl.textContent = 'No API key';
      this.keyStatusEl.classList.add('bg-raspberry/20', 'text-raspberry');
    }
  }

  renderKeyBanner() {
    if (!this.keyBannerEl) return;
    if (this.state.apiKey) {
      this.keyBannerEl.classList.add('hidden');
      this.keyBannerEl.innerHTML = '';
      return;
    }
    this.keyBannerEl.classList.remove('hidden');
    this.keyBannerEl.innerHTML = `
      <div class="font-medium">Bring your own Gemini API key</div>
      <p>Get a key from <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" class="underline">Google AI Studio</a>. The key is stored only in your browser.</p>
      <div class="flex gap-2">
        <input id="bannerKeyInput" type="text" class="flex-1 rounded-xl2 border border-raspberry/60 bg-plum px-3 py-2" placeholder="AIza..." />
        <button id="bannerKeySave" class="rounded-full border border-raspberry/60 px-4 py-2 text-sm">Save</button>
      </div>
    `;
    this.keyBannerInput = this.keyBannerEl.querySelector('#bannerKeyInput');
    const saveButton = this.keyBannerEl.querySelector('#bannerKeySave');
    saveButton.addEventListener('click', () => {
      const value = this.keyBannerInput?.value ?? '';
      saveGeminiKey(value);
      this.state.apiKey = readGeminiKey();
      this.renderKeyStatus();
      this.renderKeyBanner();
    });
  }

  async importMainPhoto(file) {
    this.startHint.textContent = 'Processing image…';
    const normalized = await normalizeImageFile(file, {
      maxSide: 2048,
      thumbSide: 512,
      quality: 0.9,
    });
    const base64 = await blobToBase64(normalized.original);
    const dataUrl = await blobToDataUrl(normalized.original);
    this.state.main = {
      base64,
      mime: file.type || 'image/jpeg',
      url: dataUrl,
      width: normalized.width,
      height: normalized.height,
    };
    this.resetGeneratedContent();
    this.startButton.disabled = false;
    this.startHint.textContent =
      'Ready. Generate your first iteration when you are set.';
    this.renderMainPreview();
  }

  renderMainPreview() {
    if (!this.mainPreview) return;
    if (!this.state.main) {
      this.mainPreview.classList.add('hidden');
      this.mainPreview.innerHTML = '';
      this.startButton.disabled = true;
      return;
    }
    this.mainPreview.classList.remove('hidden');
    this.mainPreview.innerHTML = `
      <img src="${this.state.main.url}" alt="Main room" class="w-full rounded-xl2 object-cover" />
    `;
  }

  renderReferences() {
    if (!this.referencesEl) return;
    this.referencesEl.innerHTML = '';
    const slots = [0, 1];
    slots.forEach((slot) => {
      const ref = this.state.refs[slot];
      if (ref) {
        const card = document.createElement('div');
        card.className =
          'rounded-xl2 border border-plum-border/40 bg-plum-surface p-3 flex flex-col gap-2';
        card.draggable = true;
        card.dataset.index = String(slot);
        card.innerHTML = `
          <img src="${ref.url}" alt="Reference ${slot + 1}" class="h-40 w-full rounded-xl2 object-cover" />
          <div class="flex justify-between items-center text-xs text-plum-muted">
            <span>Reference ${slot + 1}</span>
            <button class="text-peach underline" data-action="remove">Remove</button>
          </div>
        `;
        card.addEventListener('dragstart', (event) => {
          this.dragIndex = slot;
          event.dataTransfer?.setData('text/plain', String(slot));
        });
        card.addEventListener('dragover', (event) => event.preventDefault());
        card.addEventListener('drop', (event) => {
          event.preventDefault();
          const from = this.dragIndex;
          const to = Number.parseInt(card.dataset.index ?? '-1', 10);
          if (Number.isInteger(from) && Number.isInteger(to) && from !== to) {
            const refs = [...this.state.refs];
            const [moved] = refs.splice(from, 1);
            refs.splice(to, 0, moved);
            this.state.refs = refs.slice(0, 2);
            this.renderReferences();
          }
          this.dragIndex = null;
        });
        card
          .querySelector('[data-action="remove"]')
          .addEventListener('click', () => {
            this.state.refs.splice(slot, 1);
            this.renderReferences();
          });
        this.referencesEl.appendChild(card);
      } else {
        const uploader = document.createElement('label');
        uploader.className =
          'flex flex-col gap-2 rounded-xl2 border border-dashed border-peach/60 bg-plum-surface p-4 text-sm text-plum-muted text-center';
        uploader.innerHTML = `
          <span>Upload reference ${slot + 1}</span>
          <input type="file" accept="image/jpeg,image/png" class="hidden" />
        `;
        const input = uploader.querySelector('input');
        input.addEventListener('change', (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          this.importReference(slot, file).catch((error) =>
            this.reportError(error)
          );
        });
        this.referencesEl.appendChild(uploader);
      }
    });
  }

  async importReference(slot, file) {
    const normalized = await normalizeImageFile(file, {
      maxSide: 2048,
      thumbSide: 512,
      quality: 0.9,
    });
    const base64 = await blobToBase64(normalized.original);
    const dataUrl = await blobToDataUrl(normalized.original);
    const ref = {
      base64,
      mime: file.type || 'image/jpeg',
      url: dataUrl,
      width: normalized.width,
      height: normalized.height,
    };
    const refs = [...this.state.refs];
    refs[slot] = ref;
    this.state.refs = refs.slice(0, 2).filter(Boolean);
    this.renderReferences();
  }

  hasRoomBrief() {
    return this.state.roomBrief.status === 'ready';
  }

  async startFirstRound() {
    if (!this.state.main) {
      alert('Please upload the main room photo first.');
      return;
    }
    this.startButton.disabled = true;
    try {
      await this.generateRoomBrief();
      await this.generateIteration();
      this.startButton.textContent = 'Restart project';
      this.startHint.textContent =
        'You can restart at any time without re-uploading your photo.';
    } finally {
      this.startButton.disabled = false;
    }
  }

  async generateNextIteration() {
    if (this.state.isGenerating) return;
    if (this.state.selectedCount <= 0) return;
    await this.generateIteration();
  }

  async generateRoomBrief() {
    if (!this.state.main) return;
    this.state.roomBrief = {
      status: 'loading',
      paragraph: '',
      bullets: [],
      raw: '',
      error: null,
    };
    this.renderRoomBrief();
    try {
      const promptText = buildRoomBriefPrompt({
        purpose: this.state.purpose,
        notes: this.state.firstNotes,
      });
      const result = await generateRoomBrief({
        apiKey: this.state.apiKey,
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        sampling: this.state.sampling,
      });
      this.state.roomBrief = {
        status: 'ready',
        paragraph: result.paragraph,
        bullets: result.bullets,
        raw: result.raw,
        error: null,
      };
    } catch (error) {
      this.state.roomBrief = {
        status: 'error',
        paragraph: '',
        bullets: [],
        raw: '',
        error: error.message || String(error),
      };
      throw error;
    } finally {
      this.renderRoomBrief();
    }
  }

  renderRoomBrief() {
    if (!this.roomBriefEl) return;
    const brief = this.state.roomBrief;
    if (!this.state.main) {
      this.roomBriefEl.classList.add('hidden');
      this.roomBriefEl.innerHTML = '';
      return;
    }
    this.roomBriefEl.classList.remove('hidden');
    if (brief.status === 'loading') {
      this.roomBriefEl.innerHTML = `
        <h2 class="text-lg font-semibold">Room brief</h2>
        <p class="text-sm text-plum-muted">Generating concise guidance…</p>
      `;
      return;
    }
    if (brief.status === 'error') {
      this.roomBriefEl.innerHTML = `
        <h2 class="text-lg font-semibold">Room brief</h2>
        <p class="text-sm text-raspberry">Failed to generate room brief: ${brief.error}</p>
      `;
      return;
    }
    const bulletList = brief.bullets
      .map((bullet) => `<li>• ${bullet}</li>`)
      .join('');
    this.roomBriefEl.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <h2 class="text-lg font-semibold">Room brief</h2>
        <button id="regenBrief" class="text-xs text-peach underline">Regenerate</button>
      </div>
      <p class="text-sm text-plum-text whitespace-pre-wrap">${brief.paragraph}</p>
      <ul class="text-sm text-plum-muted space-y-1">${bulletList}</ul>
    `;
    this.roomBriefEl
      .querySelector('#regenBrief')
      .addEventListener('click', () => {
        this.generateRoomBrief().catch((error) => this.reportError(error));
      });
  }

  async generateIteration() {
    if (!this.state.main) return;
    this.state.isGenerating = true;
    this.generateNextButton.disabled = true;
    this.restartButton.disabled = true;
    const roundIndex = this.state.rounds.length + 1;
    const round = {
      index: roundIndex,
      tiles: Array.from({ length: 12 }, () => ({ ok: false, loading: true })),
      open: true,
    };
    this.state.rounds.push(round);
    const favoritesTextBlock = buildFavoritesTextBlock(this.state.rounds);
    this.clearAllFavorites();
    this.renderRounds();
    try {
      await runIterationBatch({
        apiKey: this.state.apiKey,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: this.state.refs,
        roomBrief: this.formatRoomBriefForPrompt(),
        purpose: this.state.purpose,
        roundGuidance: this.state.roundGuidance,
        favoritesTextBlock,
        sampling: this.state.sampling,
        onProgress: ({ index, ok, result, error }) => {
          const tile = round.tiles[index];
          if (!tile) return;
          if (ok) {
            Object.assign(tile, {
              ok: true,
              loading: false,
              imageUrl: result.imageUrl,
              text: result.text,
              warnings: result.warnings ?? [],
              fav: false,
              note: '',
              base64: result.base64,
              mime: result.mimeType,
            });
          } else {
            Object.assign(tile, {
              ok: false,
              loading: false,
              error: error?.message || String(error),
            });
          }
          this.renderRounds();
        },
      });
    } finally {
      this.state.isGenerating = false;
      this.state.roundGuidance = '';
      this.roundGuidanceInput.value = '';
      this.generateNextButton.disabled = false;
      this.restartButton.disabled = false;
      this.updateSelectedCount();
    }
  }

  formatRoomBriefForPrompt() {
    if (!this.hasRoomBrief()) return '';
    const lines = [
      this.state.roomBrief.paragraph,
      ...this.state.roomBrief.bullets,
    ];
    return lines.filter(Boolean).join('\n');
  }

  renderRounds() {
    if (!this.roundsContainer) return;
    this.roundsContainer.innerHTML = '';
    if (this.state.rounds.length === 0) {
      return;
    }
    this.state.rounds.forEach((round, idx) => {
      round.open = idx >= this.state.rounds.length - 2 ? round.open : false;
      const section = document.createElement('section');
      section.className =
        'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-4 flex flex-col gap-3';
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between';
      header.innerHTML = `
        <div class="font-semibold">Iteration #${round.index} <span class="text-sm text-plum-muted">(12 variants)</span></div>
        <button class="text-sm text-peach underline">${round.open ? 'Collapse' : 'Expand'}</button>
      `;
      header.querySelector('button').addEventListener('click', () => {
        round.open = !round.open;
        this.renderRounds();
      });
      section.appendChild(header);
      const grid = document.createElement('div');
      grid.className = round.open
        ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'
        : 'hidden';
      round.tiles.forEach((tile, index) => {
        const card = document.createElement('div');
        card.className =
          'rounded-xl2 border border-plum-border/30 bg-plum-surface p-3 flex flex-col gap-2';
        if (tile.loading) {
          card.innerHTML =
            '<div class="h-36 rounded-xl2 bg-plum-surface-2 animate-pulse"></div>';
        } else if (!tile.ok) {
          card.innerHTML = `
            <p class="text-sm text-raspberry">Generation failed: ${tile.error ?? 'Unknown error'}</p>
            <button class="rounded-full border border-plum-border/60 px-3 py-1 text-sm">Retry</button>
          `;
          card
            .querySelector('button')
            .addEventListener('click', () => this.retryTile(round, index));
        } else {
          const img = document.createElement('img');
          img.src = tile.imageUrl;
          img.alt = `Iteration ${round.index} variant ${index + 1}`;
          img.className = 'w-full rounded-xl2 object-cover cursor-pointer';
          img.addEventListener('click', () => {
            window.open(tile.imageUrl, '_blank');
          });
          const actions = document.createElement('div');
          actions.className = 'flex items-center justify-between gap-2 text-sm';
          const favBtn = document.createElement('button');
          favBtn.className =
            'rounded-full border border-plum-border/60 px-3 py-1';
          favBtn.textContent = tile.fav ? '★ Favorited' : '☆ Favorite';
          favBtn.addEventListener('click', () => {
            tile.fav = !tile.fav;
            if (!tile.fav) {
              tile.note = '';
            }
            this.renderRounds();
            this.updateSelectedCount();
          });
          const finalizeBtn = document.createElement('button');
          finalizeBtn.className =
            'rounded-full border border-peach/60 px-3 py-1 text-peach';
          finalizeBtn.textContent = 'Use as final';
          finalizeBtn.addEventListener('click', () => {
            this.startFinalComparison(tile).catch((error) =>
              this.reportError(error)
            );
          });
          actions.append(favBtn, finalizeBtn);
          const details = document.createElement('details');
          details.className = 'text-sm';
          const summary = document.createElement('summary');
          summary.textContent = 'Details anzeigen';
          const paragraph = document.createElement('p');
          paragraph.className =
            'mt-2 text-sm text-plum-muted whitespace-pre-wrap';
          paragraph.textContent = tile.text || '(no descriptor)';
          details.append(summary, paragraph);
          const note = document.createElement('textarea');
          note.rows = 2;
          note.placeholder = 'Optional note for next round';
          note.className = `rounded-xl2 border border-plum-border/40 bg-plum-surface px-2 py-1 text-sm ${
            tile.fav ? '' : 'hidden'
          }`;
          note.value = tile.note || '';
          note.addEventListener('input', () => {
            tile.note = note.value;
          });
          card.append(img, actions, details, note);
        }
        grid.appendChild(card);
      });
      section.appendChild(grid);
      this.roundsContainer.appendChild(section);
    });
    this.updateSelectedCount();
  }

  clearAllFavorites() {
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        tile.fav = false;
        tile.note = '';
      });
    });
    this.updateSelectedCount();
  }

  updateSelectedCount() {
    const count = this.state.rounds.reduce(
      (total, round) => total + round.tiles.filter((tile) => tile.fav).length,
      0
    );
    this.state.selectedCount = count;
    if (this.selectedCountEl) {
      this.selectedCountEl.textContent = `${count} selected`;
    }
    if (this.generateBar) {
      this.generateBar.classList.toggle('hidden', count === 0);
    }
    if (this.generateNextButton) {
      this.generateNextButton.disabled = count === 0 || this.state.isGenerating;
    }
  }

  renderGenerateBar() {
    if (!this.generateBar) return;
    this.generateBar.classList.toggle('hidden', this.state.selectedCount === 0);
    this.generateNextButton.disabled =
      this.state.selectedCount === 0 || this.state.isGenerating;
    this.restartButton.disabled = this.state.isGenerating;
  }

  async retryTile(round, index) {
    const tile = round.tiles[index];
    if (!tile) return;
    tile.loading = true;
    tile.ok = false;
    tile.error = null;
    this.renderRounds();
    try {
      const deck = diversityDeck();
      const diversityHint = deck[index % deck.length];
      const favoritesTextBlock = buildFavoritesTextBlock(this.state.rounds);
      const promptText = buildIterationPrompt({
        roomBrief: this.formatRoomBriefForPrompt(),
        purpose: this.state.purpose,
        roundGuidance: this.state.roundGuidance,
        favoritesTextBlock,
        diversityHint,
      });
      const result = await generateVariant({
        apiKey: this.state.apiKey,
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: this.state.refs,
        sampling: this.state.sampling,
      });
      Object.assign(tile, {
        ok: true,
        loading: false,
        imageUrl: result.imageUrl,
        text: result.text,
        warnings: result.warnings ?? [],
        fav: false,
        note: '',
        base64: result.base64,
        mime: result.mimeType,
      });
    } catch (error) {
      tile.loading = false;
      tile.ok = false;
      tile.error = error?.message || String(error);
    }
    this.renderRounds();
  }

  async startFinalComparison(tile) {
    if (!this.state.main) return;
    try {
      let base64Child = tile.base64;
      if (!base64Child) {
        const response = await fetch(tile.imageUrl);
        const blob = await response.blob();
        base64Child = await blobToBase64(blob);
      }
      const result = await finalizeHiRes({
        apiKey: this.state.apiKey,
        promptText: buildFinalizationPrompt(),
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        base64Child,
        mimeChild: tile.mime ?? 'image/jpeg',
        references: this.state.refs,
        sampling: this.state.sampling,
      });
      this.state.candidate = {
        imageUrl: result.imageUrl,
        notes: result.text,
        base64: result.base64,
        mime: result.mimeType,
      };
      this.openFinalModal(tile.imageUrl);
    } catch (error) {
      alert(`Finalization failed: ${error.message || error}`);
    }
  }

  openFinalModal(currentChildUrl) {
    if (this.finalBackdrop && this.finalModal) {
      this.finalBackdrop.classList.remove('hidden');
      this.finalModal.classList.remove('hidden');
    }
    if (this.finalCurrent) {
      this.finalCurrent.src = this.state.final.imageUrl || currentChildUrl;
    }
    if (this.finalCandidate) {
      this.finalCandidate.src = this.state.candidate.imageUrl;
    }
    this.finalCurrentNotes.textContent =
      this.state.final.notes || '(no build notes yet)';
    this.finalCandidateNotes.textContent = this.state.candidate.notes || '';
  }

  closeFinalModal() {
    if (this.finalBackdrop && this.finalModal) {
      this.finalBackdrop.classList.add('hidden');
      this.finalModal.classList.add('hidden');
    }
  }

  openSettings() {
    this.settingsKeyInput.value = this.state.apiKey;
    this.settingsBackdrop.classList.remove('hidden');
    this.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.settingsBackdrop.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
  }

  renderSamplingInputs() {
    if (!this.temperatureInput) return;
    this.temperatureInput.value = String(this.state.sampling.temperature);
    this.toppInput.value = String(this.state.sampling.topP);
    this.topkInput.value = String(this.state.sampling.topK);
    this.tempValue.textContent = this.state.sampling.temperature.toFixed(2);
    this.toppValue.textContent = this.state.sampling.topP.toFixed(2);
    this.topkValue.textContent = String(this.state.sampling.topK);
  }

  resetSampling() {
    this.state.sampling = { ...DEFAULT_SAMPLING };
    saveSampling(this.state.sampling);
    this.renderSamplingInputs();
  }

  confirmRestart() {
    if (
      !confirm(
        'Clear all generated images and selections? The base photo, purpose, references, room brief and settings will stay.'
      )
    ) {
      return;
    }
    this.resetGeneratedContent();
    this.render();
    this.startButton.textContent = 'Start generating first suggestions';
  }

  resetGeneratedContent() {
    this.state.rounds = [];
    this.state.selectedCount = 0;
    this.state.roundGuidance = '';
    this.state.roomBrief = emptyRoomBrief();
    this.state.final = { imageUrl: '', notes: '', base64: '', mime: '' };
    this.state.candidate = { imageUrl: '', notes: '' };
    this.roundGuidanceInput.value = '';
    this.renderGenerateBar();
    this.renderRoomBrief();
  }

  reportError(error) {
    console.error(error);
    alert(error.message || String(error));
  }
}
