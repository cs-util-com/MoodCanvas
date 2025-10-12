/* istanbul ignore file */
import {
  readGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  onKeyChange,
} from '../utils/key-store.js';
import {
  GeminiClient,
  DEFAULT_SAMPLING,
} from '../utils/gemini-client.js';
import { normalizeImageFile, blobToBase64, blobToDataUrl } from '../utils/image.js';
import { diversityDeck } from '../utils/diversity.js';
import {
  buildRoomBriefPrompt,
  buildIterationPrompt,
  buildFinalizationPrompt,
  stringifyFavorites,
} from '../utils/prompts.js';
import { runIterationBatch } from '../utils/iteration-runner.js';

const STORAGE_SAMPLING_KEY = 'moodcanvas.sampling.v2';

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.client = new GeminiClient();
    this.state = {
      apiKey: '',
      sampling: loadSampling(),
      main: null,
      references: [],
      purpose: '',
      firstNotes: '',
      roomBrief: null,
      roomBriefDirty: false,
      roomBriefLoading: false,
      rounds: [],
      selectedCount: 0,
      roundGuidance: '',
      isGenerating: false,
      final: { imageUrl: '', notes: '' },
      candidate: null,
    };
    this.unsubscribeKey = null;
    this.dragIndex = null;
    this.roomBriefRegenTimer = null;
  }

  async init() {
    this.renderShell();
    this.bootstrapKey();
    this.render();
  }

  destroy() {
    if (this.unsubscribeKey) {
      this.unsubscribeKey();
      this.unsubscribeKey = null;
    }
    if (this.roomBriefRegenTimer) {
      clearTimeout(this.roomBriefRegenTimer);
      this.roomBriefRegenTimer = null;
    }
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col">
        <header class="border-b border-plum-border/40 bg-plum-surface">
          <div class="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.3em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-2xl md:text-3xl font-semibold">Iterative Interior Canvas</h1>
              <p class="text-sm text-plum-muted max-w-xl">
                Upload your base room, explore twelve variants per round, and polish a hi-res final without leaving the browser.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span id="keyStatus" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs uppercase tracking-widest text-plum-muted"></span>
              <button id="settingsBtn" class="rounded-full bg-raspberry/90 hover:bg-raspberry px-4 py-2 text-sm font-medium text-white transition">Settings</button>
            </div>
          </div>
        </header>
        <main class="flex-1">
          <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-6" id="ingestCard">
              <div class="flex flex-col gap-2">
                <h2 class="text-lg font-semibold">1. Prepare your session</h2>
                <p class="text-sm text-plum-muted">Upload the base room photo, optional references, and intended use. Restart keeps the base assets but clears generated rounds.</p>
              </div>
              <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div class="flex flex-col gap-4">
                  <label class="relative flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-peach/60 bg-plum-surface text-center text-plum-muted transition hover:border-peach hover:text-peach">
                    <input type="file" accept="image/jpeg,image/png" capture="environment" class="absolute inset-0 opacity-0" id="mainFile" />
                    <span class="text-sm">Upload main room photo</span>
                    <span class="text-xs">Long edge ≤ 2048px • Metadata preserved</span>
                  </label>
                  <div id="mainPreview" class="rounded-xl2 border border-plum-border/40 bg-plum-surface flex items-center justify-center text-xs text-plum-muted min-h-[6rem]"></div>
                </div>
                <div class="flex flex-col gap-4">
                  <label class="flex flex-col gap-1 text-sm">
                    <span>Intended use</span>
                    <input type="text" id="purposeInput" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="e.g., Living room sanctuary" />
                  </label>
                  <label class="flex flex-col gap-1 text-sm">
                    <span>First round notes (optional)</span>
                    <textarea id="firstNotes" rows="3" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="Constraints, goals, pain points"></textarea>
                  </label>
                  <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between text-sm">
                      <span>Reference images (0–2)</span>
                      <button type="button" id="addReference" class="text-xs text-peach underline">Add reference</button>
                    </div>
                    <div id="referenceList" class="flex flex-col gap-3"></div>
                    <input type="file" accept="image/jpeg,image/png" class="hidden" id="referencePicker" />
                  </div>
                  <div class="flex flex-wrap gap-3 pt-2">
                    <button type="button" id="btnFirst" class="rounded-full bg-peach/90 px-5 py-2 text-sm font-medium text-plum hover:bg-peach" disabled>Start generating first suggestions</button>
                    <button type="button" id="btnRestart" class="rounded-full border border-plum-border/50 px-5 py-2 text-sm text-plum-muted hover:border-peach/60">Restart</button>
                  </div>
                </div>
              </div>
              <div id="keyBanner" class="hidden rounded-xl2 border border-raspberry/50 bg-raspberry/15 p-4 text-sm text-raspberry">
                <div class="font-medium mb-1">Bring your own Google Gemini key</div>
                <p class="text-raspberry/90">Get a free API key from <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" class="underline">Google AI Studio</a>. The key is stored only in your browser.</p>
                <button class="mt-3 rounded-full border border-raspberry/60 px-3 py-1 text-xs" id="openSettings">Open settings</button>
              </div>
            </section>
            <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4 hidden" id="roomBriefCard">
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="text-lg font-semibold">2. Room brief</h2>
                  <p class="text-sm text-plum-muted">Silent context attached to every prompt.</p>
                </div>
                <span id="roomBriefStatus" class="text-xs text-plum-muted"></span>
              </div>
              <div id="roomBriefContent" class="space-y-3 text-sm text-plum-muted"></div>
            </section>
            <section class="flex flex-col gap-4" id="iterations"></section>
          </div>
        </main>
        <div id="generateBar" class="hidden border-t border-plum-border/40 bg-plum-surface px-6 py-4">
          <div class="mx-auto flex w-full max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label class="flex w-full flex-col gap-1 text-sm md:max-w-xl">
              <span>Guidance for next round</span>
              <input type="text" id="roundGuidance" class="rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="One line to steer the next 12 variants" />
            </label>
            <div class="flex items-center gap-3">
              <span id="selectedCount" class="text-xs text-plum-muted">0 selected</span>
              <button type="button" id="btnGenerate" class="rounded-full bg-coral/90 px-5 py-2 text-sm font-medium text-plum hover:bg-coral disabled:opacity-50 disabled:cursor-not-allowed">Generate next iteration</button>
            </div>
          </div>
        </div>
      </div>
      <dialog id="settingsModal" class="backdrop:bg-black/70 rounded-xl2 bg-plum-surface-2 text-plum-text shadow-dialog p-0">
        <form method="dialog" class="flex flex-col gap-6 p-8 min-w-[320px]">
          <header class="flex flex-col gap-1">
            <h2 class="text-xl font-semibold">Settings</h2>
            <p class="text-sm text-plum-muted">Manage your Gemini key and sampling controls.</p>
          </header>
          <label class="flex flex-col gap-2 text-sm">
            <span>Gemini API key</span>
            <input id="keyInput" name="geminiKey" type="password" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="AIza..." />
          </label>
          <fieldset class="grid gap-3 text-sm">
            <legend class="text-xs uppercase tracking-wide text-plum-muted">Sampling</legend>
            <label class="flex flex-col gap-1">
              <span>Temperature</span>
              <input type="number" step="0.05" min="0" max="1" id="tempInput" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" />
            </label>
            <label class="flex flex-col gap-1">
              <span>topP</span>
              <input type="number" step="0.05" min="0" max="1" id="topPInput" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" />
            </label>
            <label class="flex flex-col gap-1">
              <span>topK</span>
              <input type="number" min="1" id="topKInput" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" />
            </label>
            <button type="button" id="resetSampling" class="self-start rounded-full border border-plum-border/60 px-3 py-1 text-xs text-plum-muted hover:border-peach/60">Reset to defaults</button>
          </fieldset>
          <div class="flex flex-col gap-3 text-xs text-plum-muted">
            <p>Bring your own key from <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" class="text-peach underline">Google AI Studio</a>. Keys are stored only in this browser.</p>
            <button type="button" id="clearKeyBtn" class="self-start rounded-full border border-raspberry/50 px-3 py-1 text-raspberry hover:bg-raspberry/10">Remove key from this device</button>
          </div>
          <div class="flex justify-end gap-3">
            <button value="cancel" class="rounded-full px-4 py-2 text-sm bg-plum-surface hover:bg-plum-surface-2 border border-plum-border/60">Cancel</button>
            <button type="submit" class="rounded-full px-4 py-2 text-sm bg-raspberry text-white hover:bg-raspberry/90">Save</button>
          </div>
        </form>
      </dialog>
      <div id="finalBackdrop" class="fixed inset-0 hidden items-center justify-center bg-black/70 px-4">
        <div id="finalModal" class="w-full max-w-4xl rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 shadow-dialog">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">Compare & decide</h3>
            <button type="button" id="finalClose" class="text-sm text-plum-muted hover:text-plum-text">Close</button>
          </div>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <span class="text-xs uppercase tracking-wide text-plum-muted">Current final</span>
              <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface flex items-center justify-center overflow-hidden aspect-[3/2]">
                <img id="finalCurrent" alt="Current final" class="h-full w-full object-cover" />
              </div>
              <p id="finalCurrentNotes" class="text-sm text-plum-muted whitespace-pre-wrap"></p>
            </div>
            <div class="flex flex-col gap-2">
              <span class="text-xs uppercase tracking-wide text-plum-muted">Candidate</span>
              <div class="rounded-xl2 border border-peach/40 bg-plum-surface flex items-center justify-center overflow-hidden aspect-[3/2]">
                <img id="finalCandidate" alt="Candidate render" class="h-full w-full object-cover" />
              </div>
              <p id="finalCandidateNotes" class="text-sm text-plum-muted whitespace-pre-wrap"></p>
            </div>
          </div>
          <div class="mt-4 flex justify-end gap-3">
            <button type="button" id="finalKeep" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm text-plum-muted hover:border-peach/60">Keep current</button>
            <button type="button" id="finalReplace" class="rounded-full bg-peach/90 px-4 py-2 text-sm font-medium text-plum hover:bg-peach">Replace with candidate</button>
          </div>
        </div>
      </div>
    `;

    this.timelineEl = this.root.querySelector('#iterations');
    this.mainInput = this.root.querySelector('#mainFile');
    this.mainPreview = this.root.querySelector('#mainPreview');
    this.purposeInput = this.root.querySelector('#purposeInput');
    this.firstNotesInput = this.root.querySelector('#firstNotes');
    this.referenceList = this.root.querySelector('#referenceList');
    this.referencePicker = this.root.querySelector('#referencePicker');
    this.addReferenceBtn = this.root.querySelector('#addReference');
    this.btnFirst = this.root.querySelector('#btnFirst');
    this.btnRestart = this.root.querySelector('#btnRestart');
    this.keyBanner = this.root.querySelector('#keyBanner');
    this.openSettingsBtn = this.root.querySelector('#openSettings');
    this.roomBriefCard = this.root.querySelector('#roomBriefCard');
    this.roomBriefContent = this.root.querySelector('#roomBriefContent');
    this.roomBriefStatus = this.root.querySelector('#roomBriefStatus');
    this.keyStatusEl = this.root.querySelector('#keyStatus');
    this.settingsBtn = this.root.querySelector('#settingsBtn');
    this.settingsModal = this.root.querySelector('#settingsModal');
    this.keyInput = this.root.querySelector('#keyInput');
    this.clearKeyBtn = this.root.querySelector('#clearKeyBtn');
    this.tempInput = this.root.querySelector('#tempInput');
    this.topPInput = this.root.querySelector('#topPInput');
    this.topKInput = this.root.querySelector('#topKInput');
    this.resetSamplingBtn = this.root.querySelector('#resetSampling');
    this.generateBar = this.root.querySelector('#generateBar');
    this.roundGuidanceInput = this.root.querySelector('#roundGuidance');
    this.selectedCountEl = this.root.querySelector('#selectedCount');
    this.btnGenerate = this.root.querySelector('#btnGenerate');
    this.finalBackdrop = this.root.querySelector('#finalBackdrop');
    this.finalModal = this.root.querySelector('#finalModal');
    this.finalClose = this.root.querySelector('#finalClose');
    this.finalCurrent = this.root.querySelector('#finalCurrent');
    this.finalCurrentNotes = this.root.querySelector('#finalCurrentNotes');
    this.finalCandidate = this.root.querySelector('#finalCandidate');
    this.finalCandidateNotes = this.root.querySelector('#finalCandidateNotes');
    this.finalKeep = this.root.querySelector('#finalKeep');
    this.finalReplace = this.root.querySelector('#finalReplace');

    this.mainInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      this.importMainPhoto(file).catch((error) => this.reportError(error));
    });

    this.addReferenceBtn.addEventListener('click', () => {
      this.referencePicker.value = '';
      this.referencePicker.click();
    });

    this.referencePicker.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      this.addReference(file).catch((error) => this.reportError(error));
    });

    this.referenceList.addEventListener('dragstart', (event) => {
      const target = event.target.closest('[data-index]');
      if (!target) return;
      this.dragIndex = Number.parseInt(target.dataset.index, 10);
      event.dataTransfer.effectAllowed = 'move';
    });

    this.referenceList.addEventListener('dragover', (event) => {
      if (this.dragIndex == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });

    this.referenceList.addEventListener('drop', (event) => {
      if (this.dragIndex == null) return;
      event.preventDefault();
      const target = event.target.closest('[data-index]');
      if (!target) return;
      const dropIndex = Number.parseInt(target.dataset.index, 10);
      this.reorderReferences(this.dragIndex, dropIndex);
      this.dragIndex = null;
    });

    this.referenceList.addEventListener('dragend', () => {
      this.dragIndex = null;
    });

    this.referenceList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-remove]');
      if (!button) return;
      const index = Number.parseInt(button.dataset.remove, 10);
      this.removeReference(index);
    });

    this.purposeInput.addEventListener('input', () => {
      this.state.purpose = this.purposeInput.value;
      this.markRoomBriefDirty();
    });

    this.firstNotesInput.addEventListener('input', () => {
      this.state.firstNotes = this.firstNotesInput.value;
      this.markRoomBriefDirty();
    });

    this.btnFirst.addEventListener('click', () => {
      this.startInitialRound().catch((error) => this.reportError(error));
    });

    this.btnRestart.addEventListener('click', () => {
      this.handleRestart();
    });

    this.settingsBtn.addEventListener('click', () => {
      if (this.settingsModal.open) return;
      this.populateSettingsForm();
      this.settingsModal.showModal();
    });

    this.openSettingsBtn.addEventListener('click', () => {
      if (this.settingsModal.open) return;
      this.populateSettingsForm();
      this.settingsModal.showModal();
    });

    this.settingsModal.addEventListener('close', () => {
      this.populateSettingsForm();
    });

    this.settingsModal.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const key = formData.get('geminiKey');
      saveGeminiKey(key ?? '');
      this.saveSampling({
        temperature: Number.parseFloat(this.tempInput.value),
        topP: Number.parseFloat(this.topPInput.value),
        topK: Number.parseInt(this.topKInput.value, 10),
      });
      this.settingsModal.close();
    });

    this.clearKeyBtn.addEventListener('click', () => {
      clearGeminiKey();
      this.keyInput.value = '';
    });

    this.resetSamplingBtn.addEventListener('click', () => {
      this.saveSampling({ ...DEFAULT_SAMPLING });
      this.populateSettingsForm();
    });

    this.roundGuidanceInput.addEventListener('input', () => {
      this.state.roundGuidance = this.roundGuidanceInput.value;
    });

    this.btnGenerate.addEventListener('click', () => {
      if (this.state.selectedCount <= 0) return;
      this.startNextRound().catch((error) => this.reportError(error));
    });

    this.finalClose.addEventListener('click', () => this.closeFinalModal());
    this.finalBackdrop.addEventListener('click', (event) => {
      if (event.target === this.finalBackdrop) {
        this.closeFinalModal();
      }
    });
    this.finalKeep.addEventListener('click', () => this.closeFinalModal());
    this.finalReplace.addEventListener('click', () => {
      if (this.state.candidate) {
        this.state.final = { ...this.state.candidate };
      }
      this.closeFinalModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.closeFinalModal();
      }
    });
  }

  bootstrapKey() {
    const key = readGeminiKey();
    this.state.apiKey = key;
    this.client.setApiKey(key);
    this.renderKeyStatus();
    this.unsubscribeKey = onKeyChange(() => {
      const next = readGeminiKey();
      this.state.apiKey = next;
      this.client.setApiKey(next);
      this.renderKeyStatus();
      this.render();
    });
  }

  render() {
    this.renderMainPreview();
    this.renderReferences();
    this.renderRoomBrief();
    this.renderRounds();
    this.updateSelectedCount();
    this.updateGenerateBarState();
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
    if (this.keyBanner) {
      this.keyBanner.classList.toggle('hidden', Boolean(this.state.apiKey));
    }
  }

  renderMainPreview() {
    if (!this.mainPreview) return;
    if (!this.state.main) {
      this.mainPreview.innerHTML = '<p>No photo uploaded yet.</p>';
      this.btnFirst.disabled = true;
      return;
    }
    this.mainPreview.innerHTML = `<img src="${this.state.main.url}" alt="Main room" class="max-h-48 rounded-xl2 object-contain" />`;
    this.btnFirst.disabled = false;
  }

  renderReferences() {
    if (!this.referenceList) return;
    this.referenceList.innerHTML = '';
    this.state.references.forEach((ref, index) => {
      const item = document.createElement('div');
      item.className = 'flex items-center gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface p-3';
      item.dataset.index = String(index);
      item.draggable = true;
      item.innerHTML = `
        <img src="${ref.url}" alt="Reference ${index + 1}" class="h-16 w-16 rounded-xl2 object-cover" />
        <div class="flex flex-1 flex-col gap-1 text-xs text-plum-muted">
          <span>Reference ${index + 1}</span>
          <span>${ref.mime}</span>
        </div>
        <button type="button" class="text-xs text-peach underline" data-remove="${index}">Remove</button>
      `;
      this.referenceList.appendChild(item);
    });
    this.addReferenceBtn.disabled = this.state.references.length >= 2;
  }

  renderRoomBrief() {
    if (!this.roomBriefCard) return;
    if (!this.state.roomBrief && !this.state.roomBriefLoading) {
      this.roomBriefCard.classList.add('hidden');
      return;
    }
    this.roomBriefCard.classList.remove('hidden');
    if (this.state.roomBriefLoading) {
      this.roomBriefStatus.textContent = 'Generating…';
      this.roomBriefContent.innerHTML = '<p class="text-sm text-plum-muted">Calling Gemini to build the brief.</p>';
      return;
    }
    this.roomBriefStatus.textContent = this.state.roomBriefDirty ? 'Needs refresh' : 'Ready';
    const { paragraph, bullets } = this.state.roomBrief;
    const list = Array.isArray(bullets) ? bullets : [];
    const bulletList = list.length
      ? `<ul class="list-disc space-y-2 pl-5">${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '<p class="text-sm text-plum-muted">No constraints provided.</p>';
    this.roomBriefContent.innerHTML = `
      <p class="text-sm text-plum-text whitespace-pre-wrap">${escapeHtml(paragraph)}</p>
      ${bulletList}
    `;
  }

  renderRounds() {
    if (!this.timelineEl) return;
    this.timelineEl.innerHTML = '';
    if (this.state.rounds.length === 0) {
      return;
    }
    const openRounds = this.state.rounds
      .map((round, index) => ({ round, index }))
      .filter((entry) => entry.round.open);
    if (openRounds.length > 2) {
      openRounds
        .sort((a, b) => a.index - b.index)
        .slice(0, openRounds.length - 2)
        .forEach((entry) => {
          entry.round.open = false;
        });
    }
    this.state.rounds.forEach((round, index) => {
      if (typeof round.open !== 'boolean') {
        round.open = index >= this.state.rounds.length - 2;
      }
    });
    this.state.rounds.forEach((round, roundIndex) => {
      const section = document.createElement('section');
      section.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-4 flex flex-col gap-4';
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between';
      header.innerHTML = `
        <div class="font-semibold">Iteration #${round.index} <span class="text-xs text-plum-muted">(${round.tiles.length} images)</span></div>
        <button type="button" class="text-xs text-peach underline">${round.open ? 'Collapse' : 'Expand'}</button>
      `;
      header.querySelector('button').addEventListener('click', () => {
        round.open = !round.open;
        this.renderRounds();
      });
      section.appendChild(header);

      const grid = document.createElement('div');
      grid.className = round.open ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'hidden';
      round.tiles.forEach((tile, tileIndex) => {
        const card = document.createElement('div');
        card.className = 'rounded-xl2 border border-plum-border/30 bg-plum-surface p-3 flex flex-col gap-3';
        if (tile.status === 'ok') {
          card.innerHTML = `
            <div class="relative aspect-[3/2] w-full overflow-hidden rounded-xl2 border border-plum-border/40 bg-plum-surface-2">
              <img src="${tile.imageUrl}" alt="Iteration render" class="h-full w-full object-cover cursor-pointer" />
              ${tile.warnings.length ? `<span class="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-peach">${tile.warnings.length} warning</span>` : ''}
            </div>
            <div class="flex items-center justify-between text-xs">
              <button type="button" class="rounded-full border border-plum-border/50 px-3 py-1 ${tile.fav ? 'bg-peach/20 text-peach' : 'text-plum-text'}" data-fav="${roundIndex}:${tileIndex}">${tile.fav ? '★ Favorited' : '☆ Favorite'}</button>
              <button type="button" class="rounded-full border border-plum-border/50 px-3 py-1 text-plum-text" data-final="${roundIndex}:${tileIndex}">Use as final</button>
            </div>
            <details class="text-sm text-plum-muted">
              <summary class="cursor-pointer text-xs uppercase tracking-wide text-plum-muted">Details anzeigen</summary>
              <p class="mt-2 whitespace-pre-wrap">${escapeHtml(tile.text || '(no descriptor)')}</p>
            </details>
            <input type="text" class="${tile.fav ? '' : 'hidden '}rounded-xl2 border border-plum-border/40 bg-plum-surface px-2 py-1 text-sm" placeholder="Optional note for next round" value="${tile.note || ''}" data-note="${roundIndex}:${tileIndex}" />
          `;
          const img = card.querySelector('img');
          img.addEventListener('click', () => window.open(tile.imageUrl, '_blank'));
        } else if (tile.status === 'error') {
          card.innerHTML = `
            <p class="text-sm text-raspberry">Generation failed: ${escapeHtml(tile.error || 'Unknown error')}</p>
            <button type="button" class="rounded-full border border-plum-border/50 px-3 py-1 text-sm text-plum-text" data-retry="${roundIndex}:${tileIndex}">Retry</button>
          `;
        } else {
          card.innerHTML = '<div class="h-32 animate-pulse rounded-xl2 bg-plum-surface"></div>';
        }
        grid.appendChild(card);
      });
      section.appendChild(grid);
      this.timelineEl.appendChild(section);
    });

    this.timelineEl.querySelectorAll('button[data-fav]').forEach((button) => {
      button.addEventListener('click', () => {
        const [roundIndex, tileIndex] = button.dataset.fav.split(':').map((value) => Number.parseInt(value, 10));
        this.toggleFavorite(roundIndex, tileIndex);
      });
    });

    this.timelineEl.querySelectorAll('button[data-final]').forEach((button) => {
      button.addEventListener('click', () => {
        const [roundIndex, tileIndex] = button.dataset.final.split(':').map((value) => Number.parseInt(value, 10));
        this.startFinalCompare(roundIndex, tileIndex).catch((error) => this.reportError(error));
      });
    });

    this.timelineEl.querySelectorAll('button[data-retry]').forEach((button) => {
      button.addEventListener('click', () => {
        const [roundIndex, tileIndex] = button.dataset.retry.split(':').map((value) => Number.parseInt(value, 10));
        this.retryTile(roundIndex, tileIndex).catch((error) => this.reportError(error));
      });
    });

    this.timelineEl.querySelectorAll('input[data-note]').forEach((input) => {
      input.addEventListener('input', () => {
        const [roundIndex, tileIndex] = input.dataset.note.split(':').map((value) => Number.parseInt(value, 10));
        const round = this.state.rounds[roundIndex];
        const tile = round?.tiles?.[tileIndex];
        if (!tile) return;
        tile.note = input.value;
      });
    });
  }

  updateSelectedCount() {
    const count = this.state.rounds.reduce((acc, round) => acc + round.tiles.filter((tile) => tile.fav).length, 0);
    this.state.selectedCount = count;
    if (this.selectedCountEl) {
      this.selectedCountEl.textContent = `${count} selected`;
    }
  }

  updateGenerateBarState() {
    if (!this.generateBar || !this.btnGenerate) return;
    const shouldShow = this.state.selectedCount > 0;
    this.generateBar.classList.toggle('hidden', !shouldShow);
    this.btnGenerate.disabled = this.state.isGenerating;
  }

  async importMainPhoto(file) {
    const normalized = await normalizeImageFile(file, { maxSide: 2048, quality: 0.9 });
    const base64 = await blobToBase64(normalized.original);
    const url = await blobToDataUrl(normalized.original);
    this.state.main = {
      base64,
      mime: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
      url,
      width: normalized.width,
      height: normalized.height,
    };
    this.state.roomBrief = null;
    this.state.roomBriefDirty = true;
    this.state.rounds = [];
    this.state.final = { imageUrl: '', notes: '' };
    this.render();
  }

  async addReference(file) {
    if (this.state.references.length >= 2) return;
    const normalized = await normalizeImageFile(file, { maxSide: 2048, quality: 0.9 });
    const base64 = await blobToBase64(normalized.original);
    const url = await blobToDataUrl(normalized.original);
    const reference = {
      id: createId(),
      base64,
      mime: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
      url,
    };
    this.state.references = [...this.state.references, reference].slice(0, 2);
    this.renderReferences();
  }

  reorderReferences(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const refs = [...this.state.references];
    const [moved] = refs.splice(fromIndex, 1);
    refs.splice(toIndex, 0, moved);
    this.state.references = refs;
    this.renderReferences();
  }

  removeReference(index) {
    this.state.references = this.state.references.filter((_, idx) => idx !== index);
    this.renderReferences();
  }

  async ensureRoomBrief() {
    if (!this.state.main) {
      throw new Error('Main photo required');
    }
    if (this.state.roomBrief && !this.state.roomBriefDirty) {
      return;
    }
    this.state.roomBriefLoading = true;
    this.renderRoomBrief();
    try {
      const promptText = buildRoomBriefPrompt({ purpose: this.state.purpose, notes: this.state.firstNotes });
      const result = await this.client.generateRoomBrief({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        sampling: this.state.sampling,
      });
      this.state.roomBrief = result;
      this.state.roomBriefDirty = false;
    } finally {
      this.state.roomBriefLoading = false;
      this.renderRoomBrief();
    }
  }

  markRoomBriefDirty() {
    this.state.roomBriefDirty = true;
    this.renderRoomBrief();
    this.scheduleRoomBriefRegeneration();
  }

  scheduleRoomBriefRegeneration() {
    if (!this.state.main || !this.state.roomBrief || !this.state.apiKey) {
      return;
    }
    if (this.state.roomBriefLoading) {
      return;
    }
    if (this.roomBriefRegenTimer) {
      clearTimeout(this.roomBriefRegenTimer);
    }
    this.roomBriefRegenTimer = setTimeout(() => {
      this.roomBriefRegenTimer = null;
      this.regenerateRoomBrief();
    }, 800);
  }

  async regenerateRoomBrief() {
    try {
      await this.ensureRoomBrief();
    } catch (error) {
      console.error(error);
      if (this.roomBriefStatus) {
        this.roomBriefStatus.textContent = 'Refresh failed';
      }
    }
  }

  async startInitialRound() {
    if (!this.state.main) {
      alert('Please upload the main photo first.');
      return;
    }
    if (!this.state.apiKey) {
      this.populateSettingsForm();
      this.settingsModal.showModal();
      return;
    }
    await this.ensureRoomBrief();
    await this.runRound();
    this.roundGuidanceInput.value = '';
    this.state.roundGuidance = '';
  }

  async startNextRound() {
    if (!this.state.apiKey) {
      this.populateSettingsForm();
      this.settingsModal.showModal();
      return;
    }
    await this.runRound();
    this.roundGuidanceInput.value = '';
    this.state.roundGuidance = '';
  }

  async runRound() {
    if (!this.state.main) {
      throw new Error('Main photo required');
    }
    this.state.isGenerating = true;
    this.updateGenerateBarState();
    const roundIndex = this.state.rounds.length + 1;
    const round = {
      index: roundIndex,
      tiles: Array.from({ length: diversityDeck().length }, () => ({ status: 'pending' })),
      open: true,
      favoritesBlock: stringifyFavorites(this.collectFavorites()),
    };
    const favoritesBlock = round.favoritesBlock;
    this.clearFavorites();
    this.state.rounds.push(round);
    this.renderRounds();

    const hints = diversityDeck();
    const references = this.state.references.map((ref) => ({ base64: ref.base64, mimeType: ref.mime }));
    await runIterationBatch({
      hints,
      poolSize: 6,
      taskFactory: async (index, hint) => {
        const promptText = buildIterationPrompt({
          roomBrief: this.state.roomBrief?.raw ?? this.state.roomBrief?.paragraph ?? '',
          purpose: this.state.purpose,
          roundGuidance: this.state.roundGuidance,
          favoritesTextBlock: favoritesBlock,
          diversityHint: hint,
        });
        const result = await this.client.generateVariant({
          promptText,
          base64Main: this.state.main.base64,
          mimeMain: this.state.main.mime,
          references,
          sampling: this.state.sampling,
        });
        round.tiles[index] = {
          status: 'ok',
          ...result,
          fav: false,
          note: '',
        };
        this.renderRounds();
      },
      onProgress: ({ index, ok, error }) => {
        if (!ok && error) {
          round.tiles[index] = { status: 'error', error: error.message || String(error) };
          this.renderRounds();
        }
      },
    });

    this.state.isGenerating = false;
    this.updateSelectedCount();
    this.updateGenerateBarState();
  }

  collectFavorites() {
    const favorites = [];
    this.state.rounds.forEach((round) => {
      round.tiles.forEach((tile) => {
        if (tile.fav && tile.status === 'ok') {
          favorites.push({ text: tile.text, note: tile.note });
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
    this.updateSelectedCount();
  }

  toggleFavorite(roundIndex, tileIndex) {
    const round = this.state.rounds[roundIndex];
    const tile = round?.tiles?.[tileIndex];
    if (!tile || tile.status !== 'ok') return;
    tile.fav = !tile.fav;
    const input = this.timelineEl.querySelector(`input[data-note="${roundIndex}:${tileIndex}"]`);
    if (input) {
      input.classList.toggle('hidden', !tile.fav);
      if (!tile.fav) input.value = tile.note || '';
    }
    this.updateSelectedCount();
    this.updateGenerateBarState();
    this.renderRounds();
  }

  async retryTile(roundIndex, tileIndex) {
    const round = this.state.rounds[roundIndex];
    if (!round) return;
    round.tiles[tileIndex] = { status: 'pending' };
    this.renderRounds();
    const hints = diversityDeck();
    const hint = hints[tileIndex];
    try {
      const promptText = buildIterationPrompt({
        roomBrief: this.state.roomBrief?.raw ?? this.state.roomBrief?.paragraph ?? '',
        purpose: this.state.purpose,
        roundGuidance: this.state.roundGuidance,
        favoritesTextBlock: round.favoritesBlock,
        diversityHint: hint,
      });
      const references = this.state.references.map((ref) => ({ base64: ref.base64, mimeType: ref.mime }));
      const result = await this.client.generateVariant({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references,
        sampling: this.state.sampling,
      });
      round.tiles[tileIndex] = { status: 'ok', ...result, fav: false, note: '' };
    } catch (error) {
      round.tiles[tileIndex] = { status: 'error', error: error.message || String(error) };
    }
    this.renderRounds();
    this.updateSelectedCount();
  }

  async startFinalCompare(roundIndex, tileIndex) {
    const round = this.state.rounds[roundIndex];
    const tile = round?.tiles?.[tileIndex];
    if (!tile || tile.status !== 'ok') return;
    const promptText = buildFinalizationPrompt();
    const references = this.state.references.map((ref) => ({ base64: ref.base64, mimeType: ref.mime }));
    const result = await this.client.finalizeHiRes({
      promptText,
      base64Main: this.state.main.base64,
      mimeMain: this.state.main.mime,
      base64Child: tile.imageBase64,
      mimeChild: tile.imageMimeType,
      references,
      sampling: this.state.sampling,
    });
    this.state.candidate = { imageUrl: result.imageUrl, notes: result.text };
    this.finalCandidate.src = result.imageUrl;
    this.finalCandidateNotes.textContent = result.text;
    if (this.state.final.imageUrl) {
      this.finalCurrent.src = this.state.final.imageUrl;
      this.finalCurrentNotes.textContent = this.state.final.notes || '';
    } else {
      this.finalCurrent.src = tile.imageUrl;
      this.finalCurrentNotes.textContent = tile.text || '';
    }
    this.openFinalModal();
  }

  openFinalModal() {
    this.finalBackdrop.classList.remove('hidden');
    this.finalBackdrop.classList.add('flex');
  }

  closeFinalModal() {
    this.finalBackdrop.classList.add('hidden');
    this.finalBackdrop.classList.remove('flex');
  }

  handleRestart() {
    if (this.state.rounds.length === 0) return;
    const confirmReset = window.confirm('Restart will clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?');
    if (!confirmReset) return;
    this.state.rounds = [];
    this.state.final = { imageUrl: '', notes: '' };
    this.state.selectedCount = 0;
    this.render();
  }

  populateSettingsForm() {
    this.keyInput.value = this.state.apiKey;
    this.tempInput.value = this.state.sampling.temperature.toFixed(2);
    this.topPInput.value = this.state.sampling.topP.toFixed(2);
    this.topKInput.value = String(this.state.sampling.topK);
  }

  saveSampling({ temperature, topP, topK }) {
    const sampling = {
      temperature: Number.isFinite(temperature) ? clamp(temperature, 0, 1) : DEFAULT_SAMPLING.temperature,
      topP: Number.isFinite(topP) ? clamp(topP, 0, 1) : DEFAULT_SAMPLING.topP,
      topK: Number.isFinite(topK) && topK > 0 ? Math.round(topK) : DEFAULT_SAMPLING.topK,
    };
    this.state.sampling = sampling;
    localStorage.setItem(STORAGE_SAMPLING_KEY, JSON.stringify(sampling));
  }

  reportError(error) {
    console.error(error);
    alert(error.message || String(error));
    this.state.isGenerating = false;
    this.updateGenerateBarState();
  }
}

function loadSampling() {
  try {
    const stored = localStorage.getItem(STORAGE_SAMPLING_KEY);
    if (!stored) return { ...DEFAULT_SAMPLING };
    const parsed = JSON.parse(stored);
    const temperature = Number.isFinite(parsed.temperature) ? parsed.temperature : DEFAULT_SAMPLING.temperature;
    const topP = Number.isFinite(parsed.topP) ? parsed.topP : DEFAULT_SAMPLING.topP;
    const topK = Number.isFinite(parsed.topK) && parsed.topK > 0 ? parsed.topK : DEFAULT_SAMPLING.topK;
    return { temperature, topP, topK };
  } catch {
    return { ...DEFAULT_SAMPLING };
  }
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
