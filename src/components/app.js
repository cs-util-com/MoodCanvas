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
} from '../utils/image.js';
import {
  DEFAULT_SAMPLING,
  setGeminiApiKey,
  generateRoomBrief,
  finalizeHiRes,
  blobUrlToBase64,
  generateVariant,
} from '../utils/iec-api.js';
import {
  buildIterationPrompt,
  buildRoomBriefPrompt,
  buildFinalizationPrompt,
  favoritesToBlock,
  refsToArray,
  runIterationBatch,
} from '../utils/iteration.js';
import { ensureProject, getProject } from '../utils/project-store.js';

const STORAGE_PROJECT_KEY = 'moodcanvas.currentProjectId';

function formatRoomBrief(roomBrief) {
  if (!roomBrief) return '';
  const bullets = roomBrief.bullets?.length ? ` • ${roomBrief.bullets.join(' • ')}` : '';
  return `${roomBrief.paragraph || ''}${bullets}`.trim();
}

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.unsubscribeKey = null;
    this.state = {
      apiKey: '',
      projectId: null,
      sampling: { ...DEFAULT_SAMPLING },
      main: null,
      refs: [],
      purpose: '',
      firstNotes: '',
      roomBrief: null,
      roomBriefStatus: 'idle',
      roomBriefError: '',
      rounds: [],
      final: { imageUrl: '', notes: '' },
      candidate: null,
    };
    this.roundGuidanceValue = '';
    this.roomBriefAbort = null;
  }

  async init() {
    this.renderShell();
    await this.bootstrapProject();
    this.bootstrapKey();
    this.render();
  }

  destroy() {
    if (this.unsubscribeKey) this.unsubscribeKey();
  }

  async bootstrapProject() {
    const existingId = localStorage.getItem(STORAGE_PROJECT_KEY);
    let project = await getProject(existingId);
    if (!project) {
      project = await ensureProject({ name: 'Room Session' });
      localStorage.setItem(STORAGE_PROJECT_KEY, project.id);
    }
    this.state.projectId = project.id;
  }

  bootstrapKey() {
    const key = readGeminiKey();
    this.state.apiKey = key;
    setGeminiApiKey(key);
    this.unsubscribeKey = onKeyChange(() => {
      const next = readGeminiKey();
      this.state.apiKey = next;
      setGeminiApiKey(next);
      this.updateKeyBanner();
      this.updateKeyStatus();
    });
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col bg-plum text-plum-text">
        <header class="sticky top-0 z-30 backdrop-blur bg-plum/90 border-b border-plum-border/40">
          <div class="mx-auto w-full max-w-6xl px-4 py-4 flex items-center gap-3">
            <div class="flex flex-col">
              <span class="text-xs uppercase tracking-[0.3em] text-peach">MoodCanvas</span>
              <h1 class="text-lg font-semibold">Iterative Interior Explorer</h1>
            </div>
            <div class="ml-auto flex items-center gap-2">
              <button id="btnRestart" class="rounded-full bg-plum-surface px-3 py-1 text-sm border border-plum-border/50 hover:bg-plum-surface-2">Restart</button>
              <button id="btnSettings" class="rounded-full bg-raspberry px-3 py-1 text-sm font-medium hover:bg-raspberry/90">Settings</button>
            </div>
          </div>
        </header>

        <main class="flex-1">
          <section id="keyBanner" class="hidden mx-auto mt-4 w-full max-w-6xl px-4">
            <div class="rounded-xl2 border border-raspberry/50 bg-raspberry/15 p-4 text-sm text-raspberry">
              <p class="mb-2">Bring your own Google Gemini API key. The key is stored only in this browser.</p>
              <div class="flex flex-col gap-2 sm:flex-row">
                <input id="keyInput" type="password" class="flex-1 rounded-xl2 border border-raspberry/40 bg-white/5 px-3 py-2 text-raspberry" placeholder="Paste your Gemini API key" />
                <button id="keySave" class="rounded-full bg-raspberry text-white px-4 py-2 text-sm font-medium">Save key</button>
              </div>
            </div>
          </section>

          <section class="mx-auto mt-6 w-full max-w-6xl px-4 space-y-6">
            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 space-y-4" id="setupCard">
              <div class="flex flex-col gap-2">
                <h2 class="text-lg font-semibold">1) Main target photo</h2>
                <p class="text-sm text-plum-muted">Upload a JPG or PNG. Metadata stays intact; the long edge is resized to ≤2048px.</p>
              </div>
              <input id="mainFile" type="file" accept="image/jpeg,image/png" capture="environment" class="block w-full text-sm" />
              <div id="mainPreview" class="rounded-xl2 border border-plum-border/40 bg-plum-surface min-h-[6rem] flex items-center justify-center text-sm text-plum-muted"></div>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-sm">
                  <span>Intended use (optional)</span>
                  <input id="purposeInput" class="rounded-xl2 border border-plum-border/50 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="e.g., Living Room" />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                  <span>Notes for first round (optional)</span>
                  <input id="firstNotes" class="rounded-xl2 border border-plum-border/50 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="warm woods, soft textiles" />
                </label>
              </div>
              <div class="space-y-2">
                <h3 class="text-md font-semibold">2) Reference images (optional, up to 2)</h3>
                <div class="grid gap-3 md:grid-cols-2">
                  <label class="flex flex-col gap-2 rounded-xl2 border border-plum-border/40 bg-plum-surface p-3 text-sm">
                    <span>Reference #1 (primary style)</span>
                    <input id="refInput1" type="file" accept="image/jpeg,image/png" class="text-sm" />
                    <div id="refPreview1" class="min-h-[4rem] rounded-xl2 border border-dashed border-plum-border/50 flex items-center justify-center text-xs text-plum-muted"></div>
                  </label>
                  <label class="flex flex-col gap-2 rounded-xl2 border border-plum-border/40 bg-plum-surface p-3 text-sm">
                    <span>Reference #2 (accent)</span>
                    <input id="refInput2" type="file" accept="image/jpeg,image/png" class="text-sm" />
                    <div id="refPreview2" class="min-h-[4rem] rounded-xl2 border border-dashed border-plum-border/50 flex items-center justify-center text-xs text-plum-muted"></div>
                  </label>
                </div>
                <div id="refsBoard" class="flex gap-3 flex-wrap"></div>
              </div>
              <button id="btnFirst" class="rounded-full bg-peach text-plum px-4 py-2 text-sm font-medium hover:bg-peach/90">Start generating first suggestions</button>
            </section>

            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6" id="roomBriefCard">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold">Room brief</h2>
                  <p class="text-sm text-plum-muted">Silent analysis used in every prompt.</p>
                </div>
                <span id="roomBriefStatus" class="text-xs text-plum-muted"></span>
              </div>
              <div id="roomBriefBody" class="mt-4 text-sm text-plum-muted space-y-3"></div>
            </section>

            <section id="finalCard" class="hidden rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 space-y-4"></section>

            <section id="iterations" class="space-y-4"></section>
          </section>
        </main>

        <footer id="generateBar" class="hidden sticky bottom-0 z-20 border-t border-plum-border/40 bg-plum-surface/95 backdrop-blur">
          <div class="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
            <input id="roundGuidance" class="flex-1 rounded-xl2 border border-plum-border/50 bg-plum-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="Guidance for the next iteration" />
            <div class="flex items-center gap-3">
              <span id="selectedCount" class="text-xs text-plum-muted">0 selected</span>
              <button id="btnGenerate" class="rounded-full bg-raspberry px-4 py-2 text-sm font-medium text-white hover:bg-raspberry/90">Generate next iteration</button>
            </div>
          </div>
        </footer>
      </div>

      <div id="settingsBackdrop" class="hidden fixed inset-0 z-40 bg-black/60"></div>
      <div id="settingsModal" class="hidden fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <div class="w-full max-w-md rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 shadow-lg space-y-5">
          <header class="space-y-1">
            <h2 class="text-lg font-semibold">Settings</h2>
            <p class="text-sm text-plum-muted">Manage your API key and global sampling defaults.</p>
          </header>
          <section class="space-y-3">
            <div class="flex flex-col gap-2 text-sm">
              <span class="text-plum-muted">API key status</span>
              <span id="keyStatus" class="text-peach/80 text-xs"></span>
              <button id="btnRemoveKey" class="self-start rounded-full border border-raspberry/60 px-3 py-1 text-xs text-raspberry hover:bg-raspberry/10">Remove key from this device</button>
            </div>
            <div class="space-y-2 text-sm">
              <div class="flex items-center justify-between text-xs text-plum-muted">
                <span>temperature <span id="tempVal">0.7</span></span>
                <span>topP <span id="topPVal">0.9</span></span>
                <span>topK <span id="topKVal">32</span></span>
              </div>
              <div class="grid gap-2">
                <label class="flex items-center gap-3 text-xs">
                  <span class="w-24">temperature</span>
                  <input id="inputTemp" type="range" min="0" max="1" step="0.05" class="flex-1" value="0.7" />
                </label>
                <label class="flex items-center gap-3 text-xs">
                  <span class="w-24">topP</span>
                  <input id="inputTopP" type="range" min="0" max="1" step="0.05" class="flex-1" value="0.9" />
                </label>
                <label class="flex items-center gap-3 text-xs">
                  <span class="w-24">topK</span>
                  <input id="inputTopK" type="number" min="1" max="128" step="1" class="flex-1 rounded-xl2 border border-plum-border/50 bg-plum-surface px-2 py-1" value="32" />
                </label>
              </div>
              <button id="btnResetSampling" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs">Reset defaults</button>
            </div>
          </section>
          <footer class="flex justify-end gap-3">
            <button id="btnCloseSettings" class="rounded-full border border-plum-border/40 px-3 py-1 text-sm">Close</button>
          </footer>
        </div>
      </div>

      <div id="finalBackdrop" class="hidden fixed inset-0 z-40 bg-black/60"></div>
      <div id="finalModal" class="hidden fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
        <div class="w-full max-w-5xl rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 shadow-xl space-y-4">
          <header class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">Compare & Decide</h2>
            <button id="finalClose" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs">Close</button>
          </header>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-3">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Current final</h3>
              <img id="finalCurrent" class="w-full rounded-xl2 border border-plum-border/40 bg-plum-surface object-cover" alt="Current final" />
              <p id="finalCurrentNotes" class="text-sm text-plum-muted whitespace-pre-wrap"></p>
            </div>
            <div class="space-y-3">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Candidate</h3>
              <img id="finalCandidate" class="w-full rounded-xl2 border border-plum-border/40 bg-plum-surface object-cover" alt="Candidate" />
              <p id="finalCandidateNotes" class="text-sm text-plum-muted whitespace-pre-wrap"></p>
            </div>
          </div>
          <footer class="flex justify-end gap-3">
            <button id="finalKeep" class="rounded-full border border-plum-border/40 px-4 py-2 text-sm">Keep current</button>
            <button id="finalReplace" class="rounded-full bg-raspberry px-4 py-2 text-sm font-medium text-white hover:bg-raspberry/90">Replace with candidate</button>
          </footer>
        </div>
      </div>
    `;

    this.cacheElements();
    this.bindStaticHandlers();
  }

  cacheElements() {
    this.keyBanner = this.root.querySelector('#keyBanner');
    this.keyInput = this.root.querySelector('#keyInput');
    this.keySave = this.root.querySelector('#keySave');
    this.mainFileInput = this.root.querySelector('#mainFile');
    this.mainPreview = this.root.querySelector('#mainPreview');
    this.purposeInput = this.root.querySelector('#purposeInput');
    this.firstNotesInput = this.root.querySelector('#firstNotes');
    this.refInput1 = this.root.querySelector('#refInput1');
    this.refInput2 = this.root.querySelector('#refInput2');
    this.refPreview1 = this.root.querySelector('#refPreview1');
    this.refPreview2 = this.root.querySelector('#refPreview2');
    this.refsBoard = this.root.querySelector('#refsBoard');
    this.btnFirst = this.root.querySelector('#btnFirst');
    this.roomBriefCard = this.root.querySelector('#roomBriefCard');
    this.roomBriefStatus = this.root.querySelector('#roomBriefStatus');
    this.roomBriefBody = this.root.querySelector('#roomBriefBody');
    this.iterationsEl = this.root.querySelector('#iterations');
    this.generateBar = this.root.querySelector('#generateBar');
    this.roundGuidanceInput = this.root.querySelector('#roundGuidance');
    this.selectedCountEl = this.root.querySelector('#selectedCount');
    this.btnGenerate = this.root.querySelector('#btnGenerate');
    this.btnSettings = this.root.querySelector('#btnSettings');
    this.btnRestart = this.root.querySelector('#btnRestart');
    this.finalCard = this.root.querySelector('#finalCard');

    this.settingsBackdrop = this.root.querySelector('#settingsBackdrop');
    this.settingsModal = this.root.querySelector('#settingsModal');
    this.keyStatus = this.root.querySelector('#keyStatus');
    this.btnRemoveKey = this.root.querySelector('#btnRemoveKey');
    this.btnCloseSettings = this.root.querySelector('#btnCloseSettings');
    this.inputTemp = this.root.querySelector('#inputTemp');
    this.inputTopP = this.root.querySelector('#inputTopP');
    this.inputTopK = this.root.querySelector('#inputTopK');
    this.tempVal = this.root.querySelector('#tempVal');
    this.topPVal = this.root.querySelector('#topPVal');
    this.topKVal = this.root.querySelector('#topKVal');
    this.btnResetSampling = this.root.querySelector('#btnResetSampling');

    this.finalBackdrop = this.root.querySelector('#finalBackdrop');
    this.finalModal = this.root.querySelector('#finalModal');
    this.finalClose = this.root.querySelector('#finalClose');
    this.finalCurrent = this.root.querySelector('#finalCurrent');
    this.finalCandidate = this.root.querySelector('#finalCandidate');
    this.finalCurrentNotes = this.root.querySelector('#finalCurrentNotes');
    this.finalCandidateNotes = this.root.querySelector('#finalCandidateNotes');
    this.finalKeep = this.root.querySelector('#finalKeep');
    this.finalReplace = this.root.querySelector('#finalReplace');
  }

  bindStaticHandlers() {
    this.keySave.addEventListener('click', () => {
      saveGeminiKey(this.keyInput.value || '');
      if (this.keyInput.value) this.keyInput.value = '';
      this.updateKeyBanner();
      this.updateKeyStatus();
    });

    this.mainFileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) this.importMainPhoto(file).catch((error) => this.reportError(error));
    });

    this.purposeInput.addEventListener('change', () => {
      this.state.purpose = this.purposeInput.value.trim();
      if (this.state.main) {
        this.generateRoomBrief(true).catch((error) => this.reportError(error));
      }
    });

    this.firstNotesInput.addEventListener('input', () => {
      this.state.firstNotes = this.firstNotesInput.value;
    });

    this.refInput1.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importReference(file, 0).catch((error) => this.reportError(error));
      } else {
        this.removeReference(0);
      }
    });

    this.refInput2.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importReference(file, 1).catch((error) => this.reportError(error));
      } else {
        this.removeReference(1);
      }
    });

    this.btnFirst.addEventListener('click', () => {
      this.startFirstIteration().catch((error) => this.reportError(error));
    });

    this.btnGenerate.addEventListener('click', () => {
      if (!this.canGenerateNext()) return;
      this.runNextIteration().catch((error) => this.reportError(error));
    });

    this.roundGuidanceInput.addEventListener('input', () => {
      this.roundGuidanceValue = this.roundGuidanceInput.value;
    });

    this.btnSettings.addEventListener('click', () => this.openSettings());
    this.btnCloseSettings.addEventListener('click', () => this.closeSettings());
    this.settingsBackdrop.addEventListener('click', () => this.closeSettings());

    this.btnRemoveKey.addEventListener('click', () => {
      clearGeminiKey();
      this.updateKeyBanner();
      this.updateKeyStatus();
    });

    this.btnResetSampling.addEventListener('click', () => {
      this.state.sampling = { ...DEFAULT_SAMPLING };
      this.syncSamplingControls();
    });

    const samplingHandler = () => {
      this.state.sampling = {
        temperature: Number.parseFloat(this.inputTemp.value) || DEFAULT_SAMPLING.temperature,
        topP: Number.parseFloat(this.inputTopP.value) || DEFAULT_SAMPLING.topP,
        topK: Number.parseInt(this.inputTopK.value, 10) || DEFAULT_SAMPLING.topK,
      };
      this.syncSamplingLabels();
    };

    this.inputTemp.addEventListener('input', samplingHandler);
    this.inputTopP.addEventListener('input', samplingHandler);
    this.inputTopK.addEventListener('input', samplingHandler);

    this.btnRestart.addEventListener('click', () => {
      if (!confirm('Restart will clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?')) return;
      this.state.rounds = [];
      this.state.final = { imageUrl: '', notes: '' };
      this.roundGuidanceValue = '';
      this.roundGuidanceInput.value = '';
      this.renderRounds();
      this.updateGenerateBar();
      this.renderFinalCard();
    });

    this.finalClose.addEventListener('click', () => this.closeFinalModal());
    this.finalBackdrop.addEventListener('click', () => this.closeFinalModal());
    this.finalKeep.addEventListener('click', () => this.closeFinalModal());
    this.finalReplace.addEventListener('click', () => {
      if (this.state.candidate) {
        this.state.final = { ...this.state.candidate };
        this.renderFinalCard();
      }
      this.closeFinalModal();
    });
  }

  render() {
    this.updateKeyBanner();
    this.updateKeyStatus();
    this.syncSamplingControls();
    this.renderMainPreview();
    this.renderRefs();
    this.renderRoomBrief();
    this.renderRounds();
    this.updateGenerateBar();
    this.renderFinalCard();
  }

  updateKeyBanner() {
    if (!this.keyBanner) return;
    const hasKey = Boolean(this.state.apiKey);
    this.keyBanner.classList.toggle('hidden', hasKey);
  }

  updateKeyStatus() {
    if (!this.keyStatus) return;
    this.keyStatus.textContent = this.state.apiKey ? 'API key stored locally' : 'No API key configured';
  }

  syncSamplingControls() {
    this.inputTemp.value = String(this.state.sampling.temperature);
    this.inputTopP.value = String(this.state.sampling.topP);
    this.inputTopK.value = String(this.state.sampling.topK);
    this.syncSamplingLabels();
  }

  syncSamplingLabels() {
    this.tempVal.textContent = this.state.sampling.temperature.toFixed(2);
    this.topPVal.textContent = this.state.sampling.topP.toFixed(2);
    this.topKVal.textContent = String(this.state.sampling.topK);
  }

  renderMainPreview() {
    if (!this.mainPreview) return;
    if (!this.state.main) {
      this.mainPreview.textContent = 'No photo uploaded yet.';
      return;
    }
    this.mainPreview.innerHTML = `<img src="${this.state.main.url}" alt="Main room" class="max-h-48 rounded-xl2 object-contain mx-auto" />`;
  }

  renderRefs() {
    if (!this.refPreview1 || !this.refPreview2) return;
    const [first, second] = this.state.refs;
    this.refPreview1.innerHTML = first ? `<img src="${first.url}" alt="Reference 1" class="max-h-32 rounded-xl2 object-contain mx-auto" />` : 'No image';
    this.refPreview2.innerHTML = second ? `<img src="${second.url}" alt="Reference 2" class="max-h-32 rounded-xl2 object-contain mx-auto" />` : 'No image';

    this.refsBoard.innerHTML = '';
    this.state.refs.forEach((ref, index) => {
      const card = document.createElement('div');
      card.className = 'relative rounded-xl2 border border-plum-border/40 bg-plum-surface p-2 flex flex-col gap-2';
      card.draggable = true;
      card.dataset.index = String(index);
      card.innerHTML = `
        <span class="text-xs text-plum-muted">#${index + 1}</span>
        <img src="${ref.url}" alt="Reference ${index + 1}" class="rounded-xl2 object-cover max-h-32" />
        <button class="rounded-full border border-plum-border/40 px-2 py-1 text-xs">Remove</button>
      `;
      card.querySelector('button').addEventListener('click', () => this.removeReference(index));
      card.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', String(index));
      });
      card.addEventListener('dragover', (event) => event.preventDefault());
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = Number.parseInt(event.dataTransfer?.getData('text/plain') ?? '-1', 10);
        if (!Number.isInteger(from) || from < 0) return;
        this.reorderReferences(from, index);
      });
      this.refsBoard.append(card);
    });
  }

  renderRoomBrief() {
    if (!this.roomBriefStatus || !this.roomBriefBody) return;
    if (!this.state.main) {
      this.roomBriefStatus.textContent = 'Upload a photo to generate a brief.';
      this.roomBriefBody.innerHTML = '';
      return;
    }
    if (this.state.roomBriefStatus === 'loading') {
      this.roomBriefStatus.textContent = 'Generating…';
      this.roomBriefBody.innerHTML = '<p class="text-sm text-plum-muted">Calling Gemini…</p>';
      return;
    }
    if (this.state.roomBriefStatus === 'error') {
      this.roomBriefStatus.textContent = 'Failed to generate';
      this.roomBriefBody.innerHTML = `<p class="text-sm text-raspberry">${this.state.roomBriefError}</p>`;
      return;
    }
    if (this.state.roomBrief) {
      this.roomBriefStatus.textContent = 'Ready';
      const bullets = this.state.roomBrief.bullets?.map((item) => `<li>${item}</li>`).join('') ?? '';
      this.roomBriefBody.innerHTML = `
        <p class="text-sm">${this.state.roomBrief.paragraph}</p>
        <ul class="list-disc list-inside text-sm text-plum-muted space-y-1">${bullets}</ul>
      `;
    } else {
      this.roomBriefStatus.textContent = 'Not generated yet';
      this.roomBriefBody.innerHTML = '<p class="text-sm text-plum-muted">Start the first iteration to create a room brief.</p>';
    }
  }

  renderRounds() {
    if (!this.iterationsEl) return;
    const keepOpenFrom = Math.max(0, this.state.rounds.length - 2);
    this.state.rounds.forEach((round, idx) => {
      if (typeof round.open !== 'boolean') {
        round.open = true;
      }
      round.open = idx >= keepOpenFrom;
    });
    this.iterationsEl.innerHTML = '';
    this.state.rounds.forEach((round, roundIdx) => {
      const section = document.createElement('section');
      section.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-4 space-y-3';
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between gap-3';
      header.innerHTML = `
        <div>
          <h3 class="text-md font-semibold">Iteration #${round.index}</h3>
          <p class="text-xs text-plum-muted">Guidance: ${round.roundGuidance || '—'}</p>
        </div>
        <span class="text-[10px] uppercase tracking-wide text-plum-muted">${round.open ? 'Open' : 'Collapsed'}</span>
      `;

      const grid = document.createElement('div');
      grid.className = round.open ? 'grid gap-3 md:grid-cols-3' : 'hidden';

      round.tiles.forEach((tile, tileIdx) => {
        const card = document.createElement('div');
        card.className = 'rounded-xl2 border border-plum-border/30 bg-plum-surface p-3 flex flex-col gap-3';
        if (tile.ok) {
          const img = document.createElement('img');
          img.src = tile.imageUrl;
          img.alt = `Iteration ${round.index} variant ${tileIdx + 1}`;
          img.className = 'w-full rounded-xl2 object-cover cursor-pointer';
          img.addEventListener('click', () => window.open(tile.imageUrl, '_blank'));

          const buttons = document.createElement('div');
          buttons.className = 'flex items-center justify-between gap-2';
          const favButton = document.createElement('button');
          favButton.className = `rounded-full px-3 py-1 text-xs border ${tile.fav ? 'border-peach text-peach' : 'border-plum-border/40 text-plum-muted'}`;
          favButton.textContent = tile.fav ? '★ Favorited' : '☆ Favorite';
          favButton.addEventListener('click', () => {
            tile.fav = !tile.fav;
            this.updateSelectedCount();
            this.renderRounds();
          });

          const finalButton = document.createElement('button');
          finalButton.className = 'rounded-full border border-plum-border/40 px-3 py-1 text-xs';
          finalButton.textContent = 'Finalize';
          finalButton.addEventListener('click', () => {
            this.openFinalization(tile).catch((error) => this.reportError(error));
          });

          buttons.append(favButton, finalButton);

          const details = document.createElement('details');
          details.className = 'text-sm text-plum-muted';
          const summary = document.createElement('summary');
          summary.textContent = 'Show details';
          const paragraph = document.createElement('p');
          paragraph.className = 'mt-2 whitespace-pre-wrap';
          paragraph.textContent = tile.text || '(no descriptor)';
          details.append(summary, paragraph);

          const note = document.createElement('textarea');
          note.className = `rounded-xl2 border border-plum-border/40 bg-plum-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-peach/70 ${tile.fav ? '' : 'hidden'}`;
          note.placeholder = 'Optional note for next round';
          note.value = tile.note || '';
          note.addEventListener('input', () => {
            tile.note = note.value;
          });

          card.append(img, buttons, details, note);
        } else if (tile.error) {
          const errorText = document.createElement('p');
          errorText.className = 'text-sm text-raspberry';
          errorText.textContent = `Generation failed: ${tile.error}`;
          const retry = document.createElement('button');
          retry.className = 'rounded-full border border-plum-border/40 px-3 py-1 text-xs';
          retry.textContent = 'Retry';
          retry.addEventListener('click', () => {
            this.retryTile(roundIdx, tileIdx).catch((error) => this.reportError(error));
          });
          card.append(errorText, retry);
        } else {
          card.innerHTML = '<div class="h-32 w-full animate-pulse rounded-xl2 bg-plum-surface-2"></div>';
        }
        grid.append(card);
      });

      section.append(header, grid);
      this.iterationsEl.append(section);
    });

    if (this.state.rounds.length > 2) {
      this.state.rounds.forEach((round, idx) => {
        round.open = idx >= this.state.rounds.length - 2;
      });
    }
  }

  updateSelectedCount() {
    const latestRound = this.state.rounds[this.state.rounds.length - 1];
    const count = latestRound ? latestRound.tiles.filter((tile) => tile.ok && tile.fav).length : 0;
    this.selectedCountEl.textContent = `${count} selected`;
    return count;
  }

  updateGenerateBar() {
    const latestRound = this.state.rounds[this.state.rounds.length - 1];
    const shouldShow = Boolean(latestRound && this.updateSelectedCount() > 0);
    this.generateBar.classList.toggle('hidden', !shouldShow);
  }

  renderFinalCard() {
    if (!this.finalCard) return;
    if (!this.state.final.imageUrl) {
      this.finalCard.classList.add('hidden');
      this.finalCard.innerHTML = '';
      return;
    }
    this.finalCard.classList.remove('hidden');
    this.finalCard.innerHTML = `
      <header class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">Current final</h2>
          <p class="text-xs text-plum-muted">High-res regeneration with build notes.</p>
        </div>
      </header>
      <img src="${this.state.final.imageUrl}" alt="Final render" class="w-full rounded-xl2 border border-plum-border/40" />
      <p class="text-sm text-plum-muted whitespace-pre-wrap">${this.state.final.notes || '(no notes)'}</p>
    `;
  }

  async importMainPhoto(file) {
    const normalized = await normalizeImageFile(file, { maxLongEdge: 2048, thumbLongEdge: 512, quality: 0.9 });
    const base64 = await blobToBase64(normalized.original);
    const url = URL.createObjectURL(normalized.original);
    this.state.main = {
      name: file.name,
      mime: normalized.original.type || file.type || 'image/jpeg',
      base64,
      url,
      width: normalized.width,
      height: normalized.height,
    };
    this.renderMainPreview();
    this.generateRoomBrief(true).catch((error) => this.reportError(error));
  }

  async importReference(file, index) {
    const normalized = await normalizeImageFile(file, { maxLongEdge: 2048, thumbLongEdge: 512, quality: 0.9 });
    const base64 = await blobToBase64(normalized.original);
    const url = URL.createObjectURL(normalized.original);
    const entry = {
      name: file.name,
      mime: normalized.original.type || file.type || 'image/jpeg',
      base64,
      url,
    };
    this.state.refs[index] = entry;
    this.state.refs = this.state.refs.filter(Boolean).slice(0, 2);
    this.renderRefs();
  }

  removeReference(index) {
    this.state.refs.splice(index, 1);
    this.renderRefs();
  }

  reorderReferences(from, to) {
    if (from === to) return;
    const next = this.state.refs.slice();
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    this.state.refs = next;
    this.renderRefs();
  }

  async generateRoomBrief(force = false) {
    if (!this.state.main) return;
    if (!force && this.state.roomBrief) return;
    if (this.roomBriefAbort) this.roomBriefAbort.abort();
    this.state.roomBriefStatus = 'loading';
    this.renderRoomBrief();

    const promptText = buildRoomBriefPrompt({ purpose: this.state.purpose, notes: this.state.firstNotes });
    const controller = new AbortController();
    this.roomBriefAbort = controller;
    try {
      const brief = await generateRoomBrief({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        sampling: this.state.sampling,
        signal: controller.signal,
      });
      this.state.roomBrief = brief;
      this.state.roomBriefStatus = 'ready';
      this.state.roomBriefError = '';
    } catch (error) {
      if (error.name === 'AbortError') return;
      this.state.roomBriefStatus = 'error';
      this.state.roomBriefError = error.message || 'Room brief failed';
      throw error;
    } finally {
      if (this.roomBriefAbort === controller) this.roomBriefAbort = null;
      this.renderRoomBrief();
    }
  }

  async startFirstIteration() {
    if (!this.state.main) {
      alert('Please upload the main photo first.');
      return;
    }
    await this.generateRoomBrief(true);
    this.state.rounds = [];
    this.roundGuidanceValue = this.state.firstNotes || '';
    await this.runNextIteration({ useInitialNotes: true });
  }

  canGenerateNext() {
    const latestRound = this.state.rounds[this.state.rounds.length - 1];
    if (!latestRound) return false;
    const count = latestRound.tiles.filter((tile) => tile.ok && tile.fav).length;
    return count > 0;
  }

  async runNextIteration({ useInitialNotes = false } = {}) {
    const favoritesBlock = this.collectFavoritesForPrompt();
    const roundGuidance = useInitialNotes ? (this.state.firstNotes || '') : (this.roundGuidanceValue || '');
    const roundIndex = this.state.rounds.length + 1;
    const round = {
      index: roundIndex,
      roundGuidance,
      favoritesBlock,
      tiles: Array.from({ length: 12 }, () => ({ ok: false })),
      open: true,
    };
    this.state.rounds.push(round);
    this.renderRounds();

    const references = refsToArray(this.state.refs);
    const roomBriefText = formatRoomBrief(this.state.roomBrief);

    await runIterationBatch({
      base64Main: this.state.main.base64,
      mimeMain: this.state.main.mime,
      references,
      roomBrief: roomBriefText,
      purpose: this.state.purpose,
      roundGuidance,
      favoritesTextBlock: favoritesBlock,
      sampling: this.state.sampling,
      onProgress: ({ index, ok, result, error, hint }) => {
        if (ok) {
          round.tiles[index] = {
            ok: true,
            imageUrl: result.imageUrl,
            text: result.text,
            warnings: result.warnings ?? [],
            hint,
            fav: false,
            note: '',
          };
        } else {
          round.tiles[index] = {
            ok: false,
            error: error?.message || 'Generation failed',
            hint,
          };
        }
        this.renderRounds();
        this.updateGenerateBar();
      },
    });

    this.clearFavorites();
    this.roundGuidanceValue = '';
    this.roundGuidanceInput.value = '';
    this.updateGenerateBar();
  }

  collectFavoritesForPrompt() {
    const latestRound = this.state.rounds[this.state.rounds.length - 1];
    if (!latestRound) return '';
    const favorites = latestRound.tiles
      .filter((tile) => tile.ok && tile.fav)
      .map((tile) => ({ descriptorText: tile.text, userNote: tile.note }));
    return favoritesToBlock(favorites);
  }

  clearFavorites() {
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        tile.fav = false;
        tile.note = '';
      });
    });
  }

  async retryTile(roundIndex, tileIndex) {
    const round = this.state.rounds[roundIndex];
    if (!round) return;
    const hint = round.tiles[tileIndex]?.hint;
    round.tiles[tileIndex] = { ok: false };
    this.renderRounds();

    const promptText = buildIterationPrompt({
      roomBrief: formatRoomBrief(this.state.roomBrief),
      purpose: this.state.purpose,
      roundGuidance: round.roundGuidance,
      favoritesTextBlock: round.favoritesBlock,
      diversityHint: hint,
    });

    try {
      const result = await generateVariant({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: refsToArray(this.state.refs),
        sampling: this.state.sampling,
      });
      round.tiles[tileIndex] = {
        ok: true,
        imageUrl: result.imageUrl,
        text: result.text,
        warnings: result.warnings ?? [],
        hint,
        fav: false,
        note: '',
      };
    } catch (error) {
      round.tiles[tileIndex] = {
        ok: false,
        error: error.message || 'Generation failed',
        hint,
      };
      throw error;
    } finally {
      this.renderRounds();
      this.updateGenerateBar();
    }
  }

  async openFinalization(tile) {
    if (!this.state.main) return;
    const promptText = buildFinalizationPrompt();
    const base64Child = await blobUrlToBase64(tile.imageUrl);
    const references = refsToArray(this.state.refs);

    const result = await finalizeHiRes({
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
      notes: result.text,
    };

    this.finalCandidate.src = result.imageUrl;
    this.finalCandidateNotes.textContent = result.text || '';
    if (this.state.final.imageUrl) {
      this.finalCurrent.src = this.state.final.imageUrl;
      this.finalCurrentNotes.textContent = this.state.final.notes || '';
    } else {
      this.finalCurrent.src = tile.imageUrl;
      this.finalCurrentNotes.textContent = '(no final selected yet)';
    }
    this.openFinalModal();
  }

  openSettings() {
    this.settingsBackdrop.classList.remove('hidden');
    this.settingsModal.classList.remove('hidden');
  }

  closeSettings() {
    this.settingsBackdrop.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
  }

  openFinalModal() {
    this.finalBackdrop.classList.remove('hidden');
    this.finalModal.classList.remove('hidden');
  }

  closeFinalModal() {
    this.finalBackdrop.classList.add('hidden');
    this.finalModal.classList.add('hidden');
  }

  reportError(error) {
    console.error(error);
    alert(error.message || String(error));
  }
}
