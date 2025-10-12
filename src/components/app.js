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
  createThumbnailFromBlob,
} from '../utils/image.js';
import {
  ensureProject,
  getProject,
  saveMedia,
  appendEvent,
  saveArtifact,
} from '../utils/project-store.js';
import {
  setIterationApiKey,
  setDefaultSampling,
  getDefaultSampling,
  generateRoomBrief,
  generateVariant,
  finalizeHiRes,
} from '../utils/iteration-client.js';
import {
  buildRoomBriefPrompt,
  buildIterationPromptBase,
  buildIterationPrompt,
  buildFinalizationPrompt,
  createDiversityDeck,
} from '../utils/iteration-prompts.js';

const STORAGE_PROJECT_KEY = 'moodcanvas.currentProjectId';
const STORAGE_SAMPLING_KEY = 'moodcanvas.sampling';
const MAX_ROUND_TILES = 12;
const GENERATION_CONCURRENCY = 6;

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.unsubscribeKey = null;
    this.roomBriefController = null;
    this.roundController = null;
    this.finalizeController = null;
    this.diversityQueue = [];

    this.state = {
      apiKey: '',
      project: null,
      main: null,
      references: [],
      purpose: '',
      guidance: '',
      roomBrief: null,
      roomBriefLoading: false,
      roomBriefError: null,
      rounds: [],
      selectedCount: 0,
      generatingRound: false,
      finalizing: false,
      final: null,
      candidate: null,
      sampling: getDefaultSampling(),
    };
  }

  async init() {
    this.renderShell();
    await this.bootstrapProject();
    this.bootstrapSampling();
    this.bootstrapKey();
    this.render();
  }

  destroy() {
    this.unsubscribeKey?.();
    this.unsubscribeKey = null;
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

  bootstrapSampling() {
    try {
      const stored = localStorage.getItem(STORAGE_SAMPLING_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.state.sampling = {
          temperature: parsed.temperature ?? 0.7,
          topP: parsed.topP ?? 0.9,
          topK: parsed.topK ?? 32,
        };
        setDefaultSampling(this.state.sampling);
      }
    } catch (error) {
      console.warn('Failed to parse sampling config', error);
    }
  }

  bootstrapKey() {
    const key = readGeminiKey();
    this.state.apiKey = key;
    setIterationApiKey(key);
    this.unsubscribeKey = onKeyChange(() => {
      const next = readGeminiKey();
      this.state.apiKey = next;
      setIterationApiKey(next);
      this.renderKeyStatus();
      this.renderGenerateControls();
    });
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col">
        <header class="border-b border-plum-border/40 bg-plum-surface">
          <div class="mx-auto w-full max-w-5xl px-6 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.3em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-2xl md:text-3xl font-semibold">Iterative Interior Canvas</h1>
              <p class="text-sm text-plum-muted max-w-xl">Upload a target room, iterate through guided rounds, and capture build-ready notes without leaving your browser.</p>
            </div>
            <div class="flex items-center gap-3">
              <span id="keyStatus" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs uppercase tracking-widest text-plum-muted"></span>
              <button id="restartBtn" class="rounded-full border border-plum-border/60 px-4 py-2 text-xs font-medium text-plum-muted hover:border-peach/70 hover:text-peach/90 transition disabled:opacity-50">Restart</button>
              <button id="settingsBtn" class="rounded-full bg-raspberry/90 hover:bg-raspberry text-white px-4 py-2 text-sm font-medium transition">Settings</button>
            </div>
          </div>
        </header>
        <main class="flex-1">
          <div id="keyBanner" class="hidden bg-raspberry/10 border-b border-raspberry/40">
            <div class="mx-auto w-full max-w-5xl px-6 py-3 text-xs text-raspberry flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p class="font-medium uppercase tracking-[0.2em]">Bring your own Gemini key</p>
              <p class="md:text-right">
                Store your key locally to call Gemini directly from this browser. Grab one at
                <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" class="underline">
                  Google AI Studio
                </a>.
              </p>
            </div>
          </div>
          <div class="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-6" id="workspace">
            <section id="ingestCard"></section>
            <section id="roomBriefCard" class="hidden"></section>
            <section id="roundsStack" class="flex flex-col gap-6"></section>
            <section id="finalCard" class="hidden"></section>
          </div>
        </main>
        <footer id="generateBar" class="sticky bottom-0 w-full border-t border-plum-border/40 bg-plum-surface/95 backdrop-blur-lg hidden">
          <div class="mx-auto w-full max-w-5xl px-6 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <label class="flex-1 w-full text-sm text-plum-muted">
              <span class="sr-only">Global guidance for next iteration</span>
              <input id="guidanceInput" type="text" placeholder="Global guidance for the next iteration" class="w-full rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm text-plum-text focus:outline-none focus:ring-2 focus:ring-peach/70" />
            </label>
            <div class="flex items-center gap-3">
              <span id="selectedCount" class="text-xs text-plum-muted"></span>
              <button id="generateNext" class="rounded-full bg-peach/90 px-4 py-2 text-sm font-medium text-plum transition hover:bg-peach disabled:cursor-not-allowed disabled:opacity-60">Generate next iteration</button>
            </div>
          </div>
        </footer>
      </div>
      <dialog id="settingsModal" class="backdrop:bg-black/70 rounded-xl2 bg-plum-surface-2 text-plum-text shadow-dialog p-0">
        <form method="dialog" class="flex flex-col gap-6 p-8 min-w-[320px]" id="settingsForm">
          <header class="flex flex-col gap-1">
            <h2 class="text-xl font-semibold">Session settings</h2>
            <p class="text-sm text-plum-muted">Bring your own Gemini key and tweak sampling defaults.</p>
          </header>
          <label class="flex flex-col gap-2 text-sm">
            <span>Gemini API key</span>
            <input id="keyInput" name="geminiKey" type="password" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="AIza..." />
          </label>
          <div class="flex flex-col gap-3 text-xs text-plum-muted">
            <p>Keys are stored only in this browser. Retrieve yours from <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer" class="text-peach underline">Google AI Studio</a>.</p>
            <button type="button" id="clearKeyBtn" class="self-start rounded-full border border-raspberry/50 px-3 py-1 text-raspberry hover:bg-raspberry/10">Remove key from this device</button>
          </div>
          <fieldset class="flex flex-col gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface px-4 py-4">
            <legend class="px-2 text-xs uppercase tracking-wide text-plum-muted">Sampling defaults</legend>
            <label class="flex items-center justify-between gap-3 text-sm">
              <span>Temperature</span>
              <input type="number" step="0.05" min="0" max="1" id="temperatureInput" class="w-24 rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-2 py-1" />
            </label>
            <label class="flex items-center justify-between gap-3 text-sm">
              <span>topP</span>
              <input type="number" step="0.05" min="0" max="1" id="topPInput" class="w-24 rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-2 py-1" />
            </label>
            <label class="flex items-center justify-between gap-3 text-sm">
              <span>topK</span>
              <input type="number" step="1" min="1" max="64" id="topKInput" class="w-24 rounded-xl2 border border-plum-border/60 bg-plum-surface-2 px-2 py-1" />
            </label>
            <button type="button" id="resetSampling" class="self-start rounded-full border border-plum-border/50 px-3 py-1 text-xs text-plum-muted hover:border-peach/60 hover:text-peach">Reset to defaults</button>
          </fieldset>
          <div class="flex justify-end gap-3">
            <button value="cancel" class="rounded-full px-4 py-2 text-sm bg-plum-surface hover:bg-plum-surface-2 border border-plum-border/60">Cancel</button>
            <button type="submit" class="rounded-full px-4 py-2 text-sm bg-raspberry text-white hover:bg-raspberry/90">Save</button>
          </div>
        </form>
      </dialog>
      <div id="finalOverlay" class="fixed inset-0 z-40 hidden items-center justify-center bg-black/70 px-4">
        <div class="w-full max-w-4xl rounded-xl2 border border-plum-border/60 bg-plum-surface-2 p-6 shadow-lg shadow-black/40 flex flex-col gap-4">
          <header class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">Compare & Decide</h2>
            <button id="finalClose" class="rounded-full border border-plum-border/50 px-3 py-1 text-xs text-plum-muted hover:text-peach">Close</button>
          </header>
          <div class="grid gap-4 md:grid-cols-2">
            <section class="flex flex-col gap-3">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Current final</h3>
              <div class="overflow-hidden rounded-xl2 border border-plum-border/40 bg-plum-surface">
                <img id="finalCurrentImage" alt="Current final" class="w-full object-cover" />
              </div>
              <p id="finalCurrentNotes" class="text-sm text-plum-muted whitespace-pre-wrap"></p>
            </section>
            <section class="flex flex-col gap-3">
              <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Candidate</h3>
              <div class="overflow-hidden rounded-xl2 border border-plum-border/40 bg-plum-surface">
                <img id="finalCandidateImage" alt="Candidate" class="w-full object-cover" />
              </div>
              <p id="finalCandidateNotes" class="text-sm text-plum-muted whitespace-pre-wrap"></p>
            </section>
          </div>
          <div class="flex justify-end gap-3">
            <button id="finalKeep" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm text-plum-muted hover:border-peach/60 hover:text-peach">Keep current</button>
            <button id="finalReplace" class="rounded-full bg-peach/90 px-4 py-2 text-sm font-medium text-plum hover:bg-peach">Replace with candidate</button>
          </div>
        </div>
      </div>
    `;

    this.workspace = this.root.querySelector('#workspace');
    this.keyBanner = this.root.querySelector('#keyBanner');
    this.ingestCard = this.root.querySelector('#ingestCard');
    this.roomBriefCard = this.root.querySelector('#roomBriefCard');
    this.roundsStack = this.root.querySelector('#roundsStack');
    this.finalCard = this.root.querySelector('#finalCard');
    this.generateBar = this.root.querySelector('#generateBar');
    this.guidanceInput = this.root.querySelector('#guidanceInput');
    this.generateNextBtn = this.root.querySelector('#generateNext');
    this.selectedCountEl = this.root.querySelector('#selectedCount');
    this.keyStatusEl = this.root.querySelector('#keyStatus');
    this.settingsBtn = this.root.querySelector('#settingsBtn');
    this.settingsModal = this.root.querySelector('#settingsModal');
    this.settingsForm = this.root.querySelector('#settingsForm');
    this.keyInput = this.root.querySelector('#keyInput');
    this.clearKeyBtn = this.root.querySelector('#clearKeyBtn');
    this.temperatureInput = this.root.querySelector('#temperatureInput');
    this.topPInput = this.root.querySelector('#topPInput');
    this.topKInput = this.root.querySelector('#topKInput');
    this.resetSamplingBtn = this.root.querySelector('#resetSampling');
    this.restartBtn = this.root.querySelector('#restartBtn');
    this.finalOverlay = this.root.querySelector('#finalOverlay');
    this.finalCloseBtn = this.root.querySelector('#finalClose');
    this.finalKeepBtn = this.root.querySelector('#finalKeep');
    this.finalReplaceBtn = this.root.querySelector('#finalReplace');
    this.finalCurrentImage = this.root.querySelector('#finalCurrentImage');
    this.finalCandidateImage = this.root.querySelector('#finalCandidateImage');
    this.finalCurrentNotes = this.root.querySelector('#finalCurrentNotes');
    this.finalCandidateNotes = this.root.querySelector('#finalCandidateNotes');

    this.settingsBtn.addEventListener('click', () => {
      if (!this.settingsModal.open) {
        this.populateSettingsForm();
        this.settingsModal.showModal();
      }
    });

    this.settingsModal.addEventListener('close', () => {
      this.populateSettingsForm();
    });

    this.settingsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(this.settingsForm);
      const key = formData.get('geminiKey');
      saveGeminiKey(key ?? '');
      const sampling = {
        temperature: parseFloat(this.temperatureInput.value || '0.7'),
        topP: parseFloat(this.topPInput.value || '0.9'),
        topK: parseFloat(this.topKInput.value || '32'),
      };
      this.persistSampling(sampling);
      this.settingsModal.close();
    });

    this.clearKeyBtn.addEventListener('click', () => {
      clearGeminiKey();
      this.keyInput.value = '';
    });

    this.resetSamplingBtn.addEventListener('click', () => {
      this.populateSamplingInputs({ temperature: 0.7, topP: 0.9, topK: 32 });
    });

    this.generateNextBtn.addEventListener('click', () => {
      this.handleGenerateNext();
    });

    this.guidanceInput.addEventListener('input', (event) => {
      this.state.guidance = event.target.value;
    });

    this.restartBtn.addEventListener('click', () => this.handleRestart());

    this.finalCloseBtn.addEventListener('click', () =>
      this.closeFinalOverlay()
    );
    this.finalKeepBtn.addEventListener('click', () => this.closeFinalOverlay());
    this.finalReplaceBtn.addEventListener('click', () =>
      this.replaceFinalWithCandidate()
    );

    this.finalOverlay.addEventListener('click', (event) => {
      if (event.target === this.finalOverlay) {
        this.closeFinalOverlay();
      }
    });
  }

  render() {
    this.renderKeyStatus();
    this.renderIngestCard();
    this.renderRoomBrief();
    this.renderRounds();
    this.renderFinalCard();
    this.renderGenerateControls();
  }

  renderKeyStatus() {
    if (!this.keyStatusEl) return;
    if (this.state.apiKey) {
      this.keyStatusEl.textContent = 'Key stored locally';
      this.keyStatusEl.classList.remove('bg-raspberry/20', 'text-raspberry');
      this.keyBanner?.classList.add('hidden');
    } else {
      this.keyStatusEl.textContent = 'No API key';
      this.keyStatusEl.classList.add('bg-raspberry/20', 'text-raspberry');
      this.keyBanner?.classList.remove('hidden');
    }
  }

  renderIngestCard() {
    if (!this.ingestCard) return;
    const main = this.state.main;
    const references = this.state.references;
    const canStart = Boolean(main) && !this.state.generatingRound;
    const referenceSlots = [0, 1];

    this.ingestCard.innerHTML = `
      <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-6">
        <header class="flex flex-col gap-1">
          <h2 class="text-lg font-semibold">1. Load your room & references</h2>
          <p class="text-sm text-plum-muted">Main target photo (JPG/PNG, ≤2048 px) plus up to two reference images for style transfer.</p>
        </header>
        <div class="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section class="flex flex-col gap-4">
            <label class="relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-peach/60 bg-plum-surface text-center text-plum-muted transition hover:border-peach hover:text-peach">
              <input type="file" accept="image/jpeg,image/png" capture="environment" class="absolute inset-0 opacity-0" id="mainFileInput" />
              ${main ? `<img src="${main.thumbUrl}" alt="Main room" class="h-full w-full object-cover rounded-xl2" />` : '<span class="text-sm">Tap to upload main target photo</span><span class="text-xs">Metadata preserved · camera orientation respected</span>'}
            </label>
            <div class="flex flex-col gap-3 text-sm">
              <label class="flex flex-col gap-2">
                <span>Intended use</span>
                <input id="purposeInput" type="text" value="${escapeHtml(this.state.purpose)}" placeholder="e.g., Cozy living room with reading nook" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" />
              </label>
            </div>
          </section>
          <section class="flex flex-col gap-3">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Reference styles (drag to reorder)</h3>
            <ul class="flex flex-col gap-3" id="referenceList">
              ${referenceSlots
                .map((index) => {
                  const ref = references[index];
                  return `
                    <li class="group relative flex items-center gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface px-3 py-3" draggable="true" data-index="${index}">
                      <div class="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl2 border border-plum-border/30 bg-plum-surface-2">
                        ${ref ? `<img src="${ref.thumbUrl}" alt="Reference ${index + 1}" class="h-full w-full object-cover" />` : '<span class="text-xs text-plum-muted">Empty</span>'}
                      </div>
                      <div class="flex flex-col text-xs text-plum-muted flex-1">
                        <span class="font-semibold text-plum-text">${ref ? escapeHtml(ref.fileName ?? `Reference ${index + 1}`) : `Reference slot ${index + 1}`}</span>
                        <span>${ref ? `${ref.width}×${ref.height}` : 'Drop or tap to add'}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <label class="relative inline-flex cursor-pointer items-center justify-center rounded-full border border-peach/60 px-3 py-1 text-xs text-peach hover:bg-peach/10">
                          <input type="file" accept="image/jpeg,image/png" class="absolute inset-0 opacity-0" data-ref-upload="${index}" />
                          ${ref ? 'Replace' : 'Upload'}
                        </label>
                        ${ref ? `<button type="button" class="text-xs text-raspberry hover:underline" data-ref-remove="${index}">Remove</button>` : ''}
                      </div>
                    </li>
                  `;
                })
                .join('')}
            </ul>
            <p class="text-xs text-plum-muted">Order matters. First reference has stronger stylistic weight.</p>
          </section>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <button id="startIterations" class="rounded-full bg-peach/90 px-5 py-2 text-sm font-medium text-plum hover:bg-peach disabled:opacity-60 disabled:cursor-not-allowed" ${canStart ? '' : 'disabled'}>${this.state.rounds.length === 0 ? 'Start generating first suggestions' : 'Run another round'}</button>
          <p class="text-xs text-plum-muted">Restart keeps photo, purpose & references but clears generated rounds.</p>
        </div>
      </div>
    `;

    const mainInput = this.ingestCard.querySelector('#mainFileInput');
    mainInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importMainPhoto(file).catch((error) => this.reportError(error));
      }
    });

    const purposeInput = this.ingestCard.querySelector('#purposeInput');
    purposeInput.addEventListener('input', (event) => {
      this.state.purpose = event.target.value;
    });
    purposeInput.addEventListener('change', () => {
      this.scheduleRoomBriefRegeneration();
    });

    this.ingestCard.querySelectorAll('[data-ref-upload]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        const index = Number.parseInt(
          event.target.getAttribute('data-ref-upload'),
          10
        );
        if (file) {
          this.importReference(file, index).catch((error) =>
            this.reportError(error)
          );
        }
      });
    });

    this.ingestCard.querySelectorAll('[data-ref-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(
          button.getAttribute('data-ref-remove'),
          10
        );
        this.removeReference(index);
      });
    });

    const referenceList = this.ingestCard.querySelector('#referenceList');
    referenceList.addEventListener('dragstart', (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      event.dataTransfer?.setData(
        'text/plain',
        event.target.dataset.index ?? '0'
      );
    });
    referenceList.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    referenceList.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = Number.parseInt(
        event.dataTransfer?.getData('text/plain') ?? '-1',
        10
      );
      if (!(event.target instanceof HTMLElement)) return;
      const li = event.target.closest('li[data-index]');
      if (!li) return;
      const to = Number.parseInt(li.dataset.index ?? '-1', 10);
      if (Number.isInteger(from) && Number.isInteger(to) && from !== to) {
        this.reorderReference(from, to);
      }
    });

    const startBtn = this.ingestCard.querySelector('#startIterations');
    startBtn.addEventListener('click', () => {
      this.handleGenerateNext(true);
    });
  }

  renderRoomBrief() {
    if (!this.roomBriefCard) return;
    if (!this.state.main) {
      this.roomBriefCard.classList.add('hidden');
      this.roomBriefCard.innerHTML = '';
      return;
    }
    this.roomBriefCard.classList.remove('hidden');
    const status = this.state.roomBriefLoading
      ? '<p class="text-sm text-plum-muted">Generating room brief…</p>'
      : this.state.roomBrief
        ? `
            <article class="rounded-xl2 border border-plum-border/40 bg-plum-surface p-5 flex flex-col gap-3">
              <p class="text-sm text-plum-text">${escapeHtml(this.state.roomBrief.paragraph)}</p>
              <ul class="list-disc pl-5 text-sm text-plum-muted space-y-1">
                ${(this.state.roomBrief.bullets ?? [])
                  .map((bullet) => `<li>${escapeHtml(bullet)}</li>`)
                  .join('')}
              </ul>
            </article>
          `
        : '<p class="text-sm text-raspberry">Room brief unavailable. Add an API key and try again.</p>';

    this.roomBriefCard.innerHTML = `
      <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4">
        <header class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">2. Room brief</h2>
            <p class="text-sm text-plum-muted">Silent Gemini summary used as context for each iteration.</p>
          </div>
          <button id="refreshRoomBrief" class="rounded-full border border-plum-border/60 px-3 py-1 text-xs text-plum-muted hover:border-peach/60 hover:text-peach" ${this.state.roomBriefLoading ? 'disabled' : ''}>Refresh</button>
        </header>
        ${status}
      </div>
    `;

    this.roomBriefCard
      .querySelector('#refreshRoomBrief')
      .addEventListener('click', () => this.generateRoomBrief(true));
  }

  renderRounds() {
    if (!this.roundsStack) return;
    this.roundsStack.innerHTML = '';
    this.state.rounds.forEach((round) => {
      const section = this.renderRoundSection(round);
      this.roundsStack.appendChild(section);
    });
  }

  renderRoundSection(round) {
    const section = document.createElement('section');
    section.className =
      'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    const toggleText = round.open ? 'Collapse' : 'Expand';
    section.innerHTML = `
      <header class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Round ${round.index}</h2>
          <p class="text-sm text-plum-muted">${round.status === 'running' ? 'Generating 12 variants…' : 'Completed variants ready for review.'}</p>
        </div>
        <button class="rounded-full border border-plum-border/60 px-3 py-1 text-xs text-plum-muted hover:border-peach/60 hover:text-peach" data-round-toggle="${round.id}">${toggleText}</button>
      </header>
      <div class="grid gap-4 ${round.open ? 'md:grid-cols-2 xl:grid-cols-3' : 'hidden'}" data-round-body="${round.id}"></div>
    `;

    const body = section.querySelector(`[data-round-body="${round.id}"]`);
    if (round.open) {
      round.tiles.forEach((tile) => {
        body.appendChild(this.renderTile(round, tile));
      });
    }

    section
      .querySelector(`[data-round-toggle="${round.id}"]`)
      .addEventListener('click', () => {
        round.open = !round.open;
        this.renderRounds();
      });

    return section;
  }

  renderTile(round, tile) {
    const card = document.createElement('article');
    card.className = `flex flex-col gap-3 rounded-xl2 border ${tile.selected ? 'border-peach/80' : 'border-plum-border/40'} bg-plum-surface p-3 text-sm`;
    card.dataset.tileId = tile.id;

    const pieces = [renderTileImage(tile), renderTileControls(tile)];
    if (tile.descriptorOpen) {
      pieces.push(renderTileDescriptor(tile));
    }
    if (tile.selected && tile.status === 'ok') {
      pieces.push(renderTileNoteInput(tile));
    }
    if (tile.warnings?.length) {
      pieces.push(renderTileWarnings(tile.warnings));
    }
    card.innerHTML = pieces.join('');

    card
      .querySelector(`[data-tile-select="${tile.id}"]`)
      .addEventListener('click', () => {
        tile.selected = !tile.selected;
        tile.note = tile.selected ? tile.note : '';
        this.updateSelectedCount();
        this.renderRounds();
        this.renderGenerateControls();
      });

    card
      .querySelector(`[data-tile-details="${tile.id}"]`)
      .addEventListener('click', () => {
        tile.descriptorOpen = !tile.descriptorOpen;
        this.renderRounds();
      });

    card
      .querySelector(`[data-tile-retry="${tile.id}"]`)
      ?.addEventListener('click', () => this.retryTile(round, tile));

    card
      .querySelector(`[data-tile-finalize="${tile.id}"]`)
      ?.addEventListener('click', () => this.startFinalCompare(tile));

    card
      .querySelector(`[data-tile-note="${tile.id}"]`)
      ?.addEventListener('input', (event) => {
        tile.note = event.target.value;
      });

    return card;
  }

  renderFinalCard() {
    if (!this.finalCard) return;
    if (!this.state.final) {
      this.finalCard.classList.add('hidden');
      this.finalCard.innerHTML = '';
      return;
    }
    this.finalCard.classList.remove('hidden');
    this.finalCard.innerHTML = `
      <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4">
        <header class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">Final selection</h2>
            <p class="text-sm text-plum-muted">Hi-res render with build notes.</p>
          </div>
        </header>
        <div class="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div class="overflow-hidden rounded-xl2 border border-plum-border/40">
            <img src="${this.state.final.imageUrl}" alt="Final render" class="w-full object-cover" />
          </div>
          <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface p-4 text-sm text-plum-muted whitespace-pre-wrap">${escapeHtml(this.state.final.notes ?? '')}</div>
        </div>
      </div>
    `;
  }

  renderGenerateControls() {
    if (!this.generateBar) return;
    const shouldShow =
      this.state.rounds.length > 0 &&
      (this.state.selectedCount > 0 || this.state.generatingRound);

    if (!shouldShow) {
      this.generateBar.classList.add('hidden');
      return;
    }
    this.generateBar.classList.remove('hidden');
    this.guidanceInput.value = this.state.guidance ?? '';
    this.selectedCountEl.textContent = `${this.state.selectedCount} selected`;
    this.generateNextBtn.disabled =
      this.state.generatingRound ||
      this.state.selectedCount === 0 ||
      !this.state.apiKey;
  }

  populateSettingsForm() {
    this.keyInput.value = this.state.apiKey ?? '';
    this.populateSamplingInputs(this.state.sampling);
  }

  populateSamplingInputs({ temperature, topP, topK }) {
    this.temperatureInput.value = Number.isFinite(temperature)
      ? temperature
      : 0.7;
    this.topPInput.value = Number.isFinite(topP) ? topP : 0.9;
    this.topKInput.value = Number.isFinite(topK) ? topK : 32;
  }

  persistSampling(sampling) {
    this.state.sampling = {
      temperature: clampRange(sampling.temperature, 0, 1, 0.7),
      topP: clampRange(sampling.topP, 0, 1, 0.9),
      topK: clampRange(sampling.topK, 1, 64, 32),
    };
    localStorage.setItem(
      STORAGE_SAMPLING_KEY,
      JSON.stringify(this.state.sampling)
    );
    setDefaultSampling(this.state.sampling);
  }

  async handleRestart() {
    if (
      !confirm(
        'Clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?'
      )
    ) {
      return;
    }
    this.clearGeneratedState();
    this.render();
  }

  clearGeneratedState() {
    this.roundController?.abort();
    this.roundController = null;
    this.roomBriefController?.abort();
    this.roomBriefController = null;
    this.state.rounds = [];
    this.state.selectedCount = 0;
    this.state.generatingRound = false;
    this.state.final = null;
    this.state.candidate = null;
    this.diversityQueue = [];
  }

  async importMainPhoto(file) {
    this.state.generatingRound = true;
    this.renderGenerateControls();
    try {
      const normalized = await normalizeImageFile(file);
      const base64 = await blobToBase64(normalized.original);
      const thumbUrl = await blobToDataUrl(normalized.thumb);
      const fullUrl = await blobToDataUrl(normalized.original);
      const record = await saveMedia(this.state.project.id, {
        kind: 'input',
        blob: normalized.original,
        mime: normalized.original.type || file.type || 'image/jpeg',
        bytes: normalized.original.size,
      });
      await saveMedia(this.state.project.id, {
        kind: 'thumb',
        relatedId: record.id,
        blob: normalized.thumb,
        mime: 'image/jpeg',
        bytes: normalized.thumb.size,
      });
      await appendEvent(this.state.project.id, {
        type: 'upload_image',
        payload: { mediaId: record.id, name: file.name },
      });
      this.state.main = {
        id: record.id,
        fileName: file.name,
        base64,
        mime: normalized.original.type || 'image/jpeg',
        thumbUrl,
        imageUrl: fullUrl,
        width: normalized.width,
        height: normalized.height,
      };
      this.clearGeneratedState();
      this.state.roomBrief = null;
      this.render();
      await this.generateRoomBrief(true);
    } catch (error) {
      this.reportError(error);
    } finally {
      this.state.generatingRound = false;
      this.renderGenerateControls();
    }
  }

  async importReference(file, index) {
    const normalized = await normalizeImageFile(file);
    const base64 = await blobToBase64(normalized.original);
    const thumbUrl = await blobToDataUrl(normalized.thumb);
    const record = await saveMedia(this.state.project.id, {
      kind: 'reference',
      blob: normalized.original,
      mime: normalized.original.type || file.type || 'image/jpeg',
      bytes: normalized.original.size,
    });
    await saveMedia(this.state.project.id, {
      kind: 'thumb',
      relatedId: record.id,
      blob: normalized.thumb,
      mime: 'image/jpeg',
      bytes: normalized.thumb.size,
    });
    const reference = {
      id: record.id,
      fileName: file.name,
      base64,
      mime: normalized.original.type || 'image/jpeg',
      thumbUrl,
      width: normalized.width,
      height: normalized.height,
    };
    const next = [...this.state.references];
    next[index] = reference;
    this.state.references = next;
    this.render();
  }

  removeReference(index) {
    const next = [...this.state.references];
    next[index] = undefined;
    this.state.references = next;
    this.render();
  }

  reorderReference(from, to) {
    const refs = [...this.state.references];
    while (refs.length < 2) refs.push(undefined);
    if (from < 0 || to < 0 || from >= refs.length || to >= refs.length) return;
    const item = refs[from];
    refs.splice(from, 1);
    refs.splice(to, 0, item);
    this.state.references = refs.slice(0, 2);
    this.render();
  }

  scheduleRoomBriefRegeneration() {
    if (!this.state.main) return;
    this.generateRoomBrief(true);
  }

  async generateRoomBrief(force = false) {
    if (!this.state.main) return;
    if (this.state.roomBrief && !force) return;
    this.roomBriefController?.abort();
    const controller = new AbortController();
    this.roomBriefController = controller;
    this.state.roomBriefLoading = true;
    this.state.roomBriefError = null;
    this.renderRoomBrief();
    try {
      const promptText = buildRoomBriefPrompt({
        purpose: this.state.purpose,
        notes: this.state.guidance,
      });
      const result = await generateRoomBrief({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        signal: controller.signal,
      });
      this.state.roomBrief = result;
      await saveArtifact(this.state.project.id, {
        kind: 'room_brief',
        json: result,
      });
    } catch (error) {
      if (error.code === 'missing-key') {
        this.settingsModal.showModal();
      }
      this.state.roomBriefError = error;
    } finally {
      this.state.roomBriefLoading = false;
      if (this.roomBriefController === controller) {
        this.roomBriefController = null;
      }
      this.renderRoomBrief();
    }
  }

  updateSelectedCount() {
    const round = this.state.rounds[this.state.rounds.length - 1];
    if (!round) {
      this.state.selectedCount = 0;
      return;
    }
    this.state.selectedCount = round.tiles.filter(
      (tile) => tile.selected
    ).length;
  }

  async handleGenerateNext(force = false) {
    if (!this.state.main) {
      alert('Upload the main room photo first.');
      return;
    }
    if (!this.state.apiKey) {
      this.settingsModal.showModal();
      return;
    }
    if (
      this.state.rounds.length > 0 &&
      !force &&
      this.state.selectedCount === 0
    ) {
      return;
    }
    await this.generateRoomBrief();
    const favorites = this.collectFavorites();
    if (!force && this.state.rounds.length > 0 && favorites.length === 0) {
      alert('Select at least one favorite to guide the next round.');
      return;
    }
    await this.runRound(favorites);
  }

  collectFavorites() {
    const lastRound = this.state.rounds[this.state.rounds.length - 1];
    if (!lastRound) return [];
    const favorites = lastRound.tiles
      .filter((tile) => tile.selected && tile.status === 'ok')
      .map((tile) => ({ text: tile.text, note: tile.note }));
    lastRound.tiles.forEach((tile) => {
      tile.selected = false;
      tile.note = '';
    });
    this.updateSelectedCount();
    this.renderRounds();
    return favorites;
  }

  takeDiversityHints(count) {
    while (this.diversityQueue.length < count) {
      this.diversityQueue.push(...createDiversityDeck());
    }
    return this.diversityQueue.splice(0, count);
  }

  async runRound(favorites) {
    this.state.generatingRound = true;
    this.renderGenerateControls();
    const round = {
      id: makeId(),
      index: this.state.rounds.length + 1,
      status: 'running',
      tiles: [],
      open: true,
    };
    const hints = this.takeDiversityHints(MAX_ROUND_TILES);
    const basePrompt = buildIterationPromptBase({
      roomBrief: this.state.roomBrief,
      purpose: this.state.purpose,
      globalNotes: this.state.guidance,
      favorites,
    });
    round.tiles = hints.map((hint) => ({
      id: makeId(),
      hint,
      promptText: buildIterationPrompt({ basePrompt, diversityHint: hint }),
      status: 'pending',
      selected: false,
      note: '',
      warnings: [],
      roundIndex: round.index,
    }));
    this.state.rounds.push(round);
    this.state.rounds.forEach((r, index) => {
      r.open = index >= this.state.rounds.length - 2;
    });
    this.renderRounds();

    const controller = new AbortController();
    this.roundController = controller;
    const references = this.state.references
      .filter(Boolean)
      .map((ref) => ({ mime: ref.mime, base64: ref.base64 }));

    const tasks = round.tiles.map((tile) => async () => {
      await this.runTile(round, tile, references, controller.signal);
    });

    await runWithConcurrency(tasks, GENERATION_CONCURRENCY);
    round.status = 'done';
    this.state.generatingRound = false;
    this.renderRounds();
    this.renderGenerateControls();
    if (this.roundController === controller) {
      this.roundController = null;
    }
  }

  async runTile(round, tile, references, signal) {
    try {
      const result = await generateVariant({
        promptText: tile.promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references,
        signal,
      });
      const base64 = await blobToBase64(result.blob);
      const thumb = await createThumbnailFromBlob(result.blob);
      const thumbUrl = URL.createObjectURL(thumb);
      tile.status = 'ok';
      tile.text = result.text;
      tile.imageUrl = result.imageUrl;
      tile.base64 = base64;
      tile.mime = result.mime;
      tile.warnings = result.warnings ?? [];
      tile.thumbUrl = thumbUrl;
      tile.blob = result.blob;
      await this.persistVariantAsset(tile, result.blob, thumb);
    } catch (error) {
      tile.status = 'error';
      tile.error = error.reason || error.message || String(error);
    } finally {
      this.renderRounds();
    }
  }

  async retryTile(round, tile) {
    tile.status = 'pending';
    tile.error = null;
    this.renderRounds();
    const references = this.state.references
      .filter(Boolean)
      .map((ref) => ({ mime: ref.mime, base64: ref.base64 }));
    await this.runTile(round, tile, references, this.roundController?.signal);
  }

  async startFinalCompare(tile) {
    if (!this.state.main) return;
    this.state.finalizing = true;
    try {
      const promptText = buildFinalizationPrompt({
        roomBrief: this.state.roomBrief,
        purpose: this.state.purpose,
      });
      const references = this.state.references
        .filter(Boolean)
        .map((ref) => ({ mime: ref.mime, base64: ref.base64 }));
      const result = await finalizeHiRes({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        base64Child: tile.base64,
        mimeChild: tile.mime,
        references,
      });
      const base64 = await blobToBase64(result.blob);
      const thumb = await createThumbnailFromBlob(result.blob);
      await this.persistVariantAsset(
        { ...tile, id: makeId(), roundIndex: tile.roundIndex },
        result.blob,
        thumb,
        'final'
      );
      this.state.candidate = {
        imageUrl: result.imageUrl,
        notes: result.text,
        base64,
        blob: result.blob,
      };
      this.openFinalOverlay();
    } catch (error) {
      this.reportError(error);
    } finally {
      this.state.finalizing = false;
    }
  }

  openFinalOverlay() {
    if (!this.finalOverlay) return;
    const candidate = this.state.candidate ?? { imageUrl: '', notes: '' };
    const current = this.state.final;
    const currentImage = current?.imageUrl ?? candidate.imageUrl ?? '';
    const currentNotes = current?.notes ?? '(No final selected yet)';

    this.finalOverlay.classList.remove('hidden');
    this.finalCandidateImage.src = candidate.imageUrl ?? '';
    this.finalCandidateNotes.textContent = candidate.notes ?? '';
    this.finalCurrentImage.src = currentImage;
    this.finalCurrentNotes.textContent = currentNotes;
  }

  closeFinalOverlay() {
    if (!this.finalOverlay) return;
    this.finalOverlay.classList.add('hidden');
  }

  async replaceFinalWithCandidate() {
    if (!this.state.candidate) return;
    this.state.final = { ...this.state.candidate };
    await appendEvent(this.state.project.id, {
      type: 'final_selected',
      payload: { notes: this.state.final.notes },
    });
    this.renderFinalCard();
    this.closeFinalOverlay();
  }

  async persistVariantAsset(tile, blob, thumb, kind = 'render') {
    const record = await saveMedia(this.state.project.id, {
      kind,
      blob,
      mime: blob.type || 'image/jpeg',
      bytes: blob.size,
    });
    await saveMedia(this.state.project.id, {
      kind: 'thumb',
      relatedId: record.id,
      blob: thumb,
      mime: 'image/jpeg',
      bytes: thumb.size,
    });
    await appendEvent(this.state.project.id, {
      type: kind === 'final' ? 'final_render' : 'iteration_tile',
      payload: { round: tile.roundIndex ?? null },
    });
  }

  reportError(error) {
    console.error(error);
    alert(error.reason || error.message || 'Unexpected error');
  }
}

function makeId() {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

function clampRange(value, min, max, fallback) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function runWithConcurrency(tasks, limit) {
  const running = new Set();
  const results = [];
  for (const task of tasks) {
    const promise = task().finally(() => running.delete(promise));
    running.add(promise);
    if (running.size >= limit) {
      results.push(await Promise.race(running));
    }
  }
  await Promise.allSettled(running);
  return results;
}

function renderTileImage(tile) {
  let content;
  if (tile.status === 'ok') {
    const safeUrl = tile.imageUrl ?? '';
    content = `
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="block h-full w-full">
        <img src="${safeUrl}" alt="Iteration render" class="h-full w-full object-cover" />
      </a>
    `;
  } else if (tile.status === 'error') {
    content = `<span class="text-xs text-raspberry">${escapeHtml(tile.error ?? 'Failed')}</span>`;
  } else {
    content = '<span class="text-xs text-plum-muted">Pending…</span>';
  }
  return `
    <div class="relative overflow-hidden rounded-xl2 border border-plum-border/30 bg-plum-surface-2 flex items-center justify-center aspect-[3/2]">
      ${content}
    </div>
  `;
}

function renderTileControls(tile) {
  return `
    <div class="flex items-center justify-between">
      <button data-tile-select="${tile.id}" class="rounded-full border ${tile.selected ? 'border-peach bg-peach/20 text-peach' : 'border-plum-border/50 text-plum-muted'} px-3 py-1 text-xs transition hover:border-peach/70 hover:text-peach">${tile.selected ? 'Selected' : 'Select favorite'}</button>
      <div class="flex items-center gap-2">
        <button data-tile-details="${tile.id}" class="text-xs text-plum-muted hover:underline">${tile.descriptorOpen ? 'Hide details' : 'Details'}</button>
        ${tileActionMarkup(tile)}
      </div>
    </div>
  `;
}

function renderTileDescriptor(tile) {
  return `<p class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 px-3 py-2 text-xs text-plum-muted whitespace-pre-wrap">${escapeHtml(tile.text ?? '')}</p>`;
}

function renderTileNoteInput(tile) {
  return `
    <label class="flex flex-col gap-1 text-xs text-plum-muted">
      Note for next prompt
      <input type="text" data-tile-note="${tile.id}" value="${escapeHtml(tile.note ?? '')}" class="rounded-xl2 border border-plum-border/50 bg-plum-surface px-2 py-1 text-sm text-plum-text focus:outline-none focus:ring-1 focus:ring-peach/70" />
    </label>
  `;
}

function renderTileWarnings(warnings) {
  return `<p class="text-xs text-peach/80">${escapeHtml(warnings.join('; '))}</p>`;
}

function tileActionMarkup(tile) {
  if (tile.status === 'error') {
    return `<button data-tile-retry="${tile.id}" class="rounded-full border border-raspberry/60 px-3 py-1 text-xs text-raspberry hover:bg-raspberry/10">Retry</button>`;
  }
  if (tile.status === 'ok') {
    return `<button data-tile-finalize="${tile.id}" class="rounded-full bg-peach/80 px-3 py-1 text-xs font-medium text-plum hover:bg-peach">Use as final</button>`;
  }
  return '';
}
