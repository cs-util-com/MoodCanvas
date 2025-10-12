/* istanbul ignore file */
import {
  readGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  onKeyChange,
} from '../utils/key-store.js';
import { GeminiClient } from '../utils/gemini-client.js';
import {
  normalizeImageFile,
  blobToBase64,
  blobToDataUrl,
  base64ToBlob,
} from '../utils/image.js';
import { IterationApi, DEFAULT_SAMPLING } from '../utils/iteration-api.js';
import {
  runIterationBatch,
  buildFinalizationPrompt,
  diversityDeck,
  buildIterationPrompt,
} from '../utils/iteration-prompts.js';
import { ensureProject, getProject } from '../utils/project-store.js';

const STORAGE_PROJECT_KEY = 'moodcanvas.currentProjectId';
const MAX_REFERENCES = 2;

function randomId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.client = new GeminiClient();
    this.iterationApi = new IterationApi({ client: this.client });
    this.state = {
      apiKey: '',
      project: null,
      main: null,
      references: [],
      purpose: '',
      roomBrief: null,
      roomBriefPurpose: '',
      generatingRoomBrief: false,
      rounds: [],
      selectedForNext: new Set(),
      roundGuidance: '',
      sampling: { ...DEFAULT_SAMPLING },
      generatingRound: false,
      generatingFinal: false,
      final: { imageUrl: '', notes: '' },
      candidate: null,
      error: null,
    };
    this.unsubscribeKey = null;
    this.draggedReferenceIndex = null;
    this.isFinalKeyListenerAttached = false;
    this.handleEscapeKeydown = (event) => {
      if (event.key === 'Escape') {
        this.closeFinalModal();
      }
    };
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
    if (this.isFinalKeyListenerAttached) {
      document.removeEventListener('keydown', this.handleEscapeKeydown);
      this.isFinalKeyListenerAttached = false;
    }
    if (this.finalBackdrop) {
      this.finalBackdrop.remove();
      this.finalBackdrop = null;
    }
    if (this.finalModal) {
      this.finalModal.remove();
      this.finalModal = null;
    }
    this.finalClose = null;
    this.finalCurrent = null;
    this.finalCandidate = null;
    this.finalCurrentNotes = null;
    this.finalCandidateNotes = null;
    this.finalKeep = null;
    this.finalReplace = null;
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col">
        <header class="border-b border-plum-border/40 bg-plum-surface">
          <div class="mx-auto w-full max-w-5xl px-6 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.3em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-2xl md:text-3xl font-semibold">Iterative Interior Canvas</h1>
              <p class="text-sm text-plum-muted max-w-xl">
                Upload one empty-room photo, explore iterative style variants, and finalize a polished build — all in-browser with your Gemini key.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span id="keyStatus" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs uppercase tracking-widest text-plum-muted"></span>
              <button id="settingsBtn" class="rounded-full bg-raspberry/90 hover:bg-raspberry text-white px-4 py-2 text-sm font-medium transition">
                Settings
              </button>
            </div>
          </div>
        </header>
        <main class="flex-1">
          <div class="w-full px-6 py-10 flex flex-col gap-6" id="timeline"></div>
        </main>
      </div>
      <div id="generateBar" class="fixed inset-x-0 bottom-0 z-40 hidden border-t border-plum-border/50 bg-plum-surface/95 backdrop-blur">
        <div class="mx-auto w-full max-w-3xl px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex-1 flex flex-col gap-2">
            <label class="text-xs uppercase tracking-wide text-plum-muted" for="roundGuidanceInput">Guidance for the next iteration</label>
            <input id="roundGuidanceInput" type="text" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="e.g. lean warmer, soften textiles" />
          </div>
          <div class="flex flex-col sm:items-end gap-2">
            <span id="selectedCounter" class="text-xs text-plum-muted"></span>
            <button id="generateNextBtn" class="rounded-full bg-peach/90 px-5 py-2 text-sm font-medium text-plum hover:bg-peach disabled:opacity-60 disabled:cursor-not-allowed">Generate next iteration</button>
          </div>
        </div>
      </div>
      <dialog id="settingsModal" class="backdrop:bg-black/70 rounded-xl2 bg-plum-surface-2 text-plum-text shadow-dialog p-0">
        <form method="dialog" class="flex flex-col gap-6 p-8 min-w-[320px]">
          <header>
            <h2 class="text-xl font-semibold">Settings</h2>
            <p class="text-sm text-plum-muted">Manage your Google Gemini API key for on-device usage.</p>
          </header>
          <label class="flex flex-col gap-2 text-sm">
            <span>Gemini API key</span>
            <input id="keyInput" name="geminiKey" type="password" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="AIza..." />
          </label>
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
    `;

    this.timelineEl = this.root.querySelector('#timeline');
    this.keyStatusEl = this.root.querySelector('#keyStatus');
    this.settingsBtn = this.root.querySelector('#settingsBtn');
    this.settingsModal = this.root.querySelector('#settingsModal');
    this.keyInput = this.root.querySelector('#keyInput');
    this.clearKeyBtn = this.root.querySelector('#clearKeyBtn');
    this.generateBar = this.root.querySelector('#generateBar');
    this.guidanceInput = this.root.querySelector('#roundGuidanceInput');
    this.generateBtn = this.root.querySelector('#generateNextBtn');
    this.selectedCounter = this.root.querySelector('#selectedCounter');

    this.settingsBtn.addEventListener('click', () => {
      if (this.settingsModal.open) return;
      this.keyInput.value = this.state.apiKey;
      this.settingsModal.showModal();
    });

    this.settingsModal.addEventListener('close', () => {
      this.keyInput.value = this.state.apiKey;
    });

    this.settingsModal
      .querySelector('form')
      .addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const key = formData.get('geminiKey');
        saveGeminiKey(key ?? '');
        this.settingsModal.close();
      });

    this.clearKeyBtn.addEventListener('click', () => {
      clearGeminiKey();
      this.keyInput.value = '';
    });

    this.generateBtn.addEventListener('click', () => {
      if (this.state.generatingRound) return;
      this.handleGenerateNext().catch((error) => this.reportError(error));
    });

    this.guidanceInput.addEventListener('input', (event) => {
      this.state.roundGuidance = event.target.value;
    });
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
    this.client.setApiKey(key);
    this.unsubscribeKey = onKeyChange(() => {
      const next = readGeminiKey();
      this.state.apiKey = next;
      this.client.setApiKey(next);
      this.renderKeyStatus();
    });
  }

  render() {
    this.renderKeyStatus();
    this.renderTimeline();
    this.renderGenerateBar();
    this.renderFinalModal();
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

  renderTimeline() {
    this.timelineEl.innerHTML = '';
    this.timelineEl.appendChild(this.renderUploadCard());
    if (this.state.generatingRoomBrief || this.state.roomBrief) {
      this.timelineEl.appendChild(this.renderRoomBriefCard());
    }
    this.timelineEl.appendChild(this.renderStartSection());
    this.state.rounds.forEach((round) => {
      this.timelineEl.appendChild(this.renderRound(round));
    });
    if (this.state.final.imageUrl) {
      this.timelineEl.appendChild(this.renderFinalCard());
    }
  }

  renderUploadCard() {
    const { main, references, purpose } = this.state;
    const card = document.createElement('section');
    card.className =
      'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-5';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">1. Upload your base room & references</h2>
          <p class="text-sm text-plum-muted">Use a single JPG/PNG captured from your device. Long edge ≤ 2048px, metadata preserved. Optional: up to two style reference images (drag to reorder).</p>
        </div>
      </div>
      <div class="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface p-4 flex flex-col gap-3">
          <label class="flex flex-col gap-2 text-sm">
            <span>Main room photo</span>
            <input type="file" accept="image/jpeg,image/png" capture="environment" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm" />
          </label>
          <div class="min-h-[160px] rounded-xl2 border border-dashed border-plum-border/40 bg-plum-surface-2 flex items-center justify-center overflow-hidden">
            ${main ? `<img src="${main.displayUrl}" alt="Uploaded room" class="h-full w-full object-cover" />` : '<span class="text-xs text-plum-muted">No photo yet</span>'}
          </div>
        </section>
        <section class="rounded-xl2 border border-plum-border/40 bg-plum-surface p-4 flex flex-col gap-4">
          <div class="flex items-center justify-between text-sm">
            <span>Reference images (optional, max 2)</span>
            <span class="text-xs text-plum-muted">drag to reorder</span>
          </div>
          <label class="flex flex-col gap-2 text-sm">
            <span>Add reference</span>
            <input type="file" accept="image/jpeg,image/png" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm" />
          </label>
          <div id="referenceList" class="grid gap-3">
            ${references
              .map(
                (ref, index) => `
                <article class="group relative flex items-center gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-2" draggable="true" data-index="${index}">
                  <img src="${ref.displayUrl}" alt="Reference ${index + 1}" class="h-16 w-16 rounded-xl2 object-cover" />
                  <div class="flex-1 text-xs text-plum-muted">
                    <p class="text-sm text-plum-text">Reference ${index + 1}</p>
                    <p>${ref.width}×${ref.height}</p>
                  </div>
                  <button data-remove="${index}" class="hidden group-hover:block text-xs text-peach underline">Remove</button>
                </article>
              `
              )
              .join('')}
            ${references.length === 0 ? '<p class="text-xs text-plum-muted">No references selected.</p>' : ''}
          </div>
        </section>
      </div>
  <div class="grid gap-4">
        <label class="flex flex-col gap-2 text-sm">
          <span>Intended use / purpose</span>
          <input type="text" value="${purpose.replace(/"/g, '&quot;')}" placeholder="e.g. Calm bedroom retreat" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-peach/70" id="purposeInput" />
        </label>
      </div>
    `;

    const mainInput = card.querySelector('input[type="file"]');
    mainInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importMainPhoto(file).catch((error) => this.reportError(error));
      }
    });

    const refInput = card.querySelectorAll('input[type="file"]')[1];
    refInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importReference(file).catch((error) => this.reportError(error));
      }
      event.target.value = '';
    });

    const referenceList = card.querySelector('#referenceList');
    referenceList.addEventListener('dragstart', (event) => {
      const target = event.target.closest('[draggable="true"]');
      if (!target) return;
      this.draggedReferenceIndex = Number.parseInt(target.dataset.index, 10);
      event.dataTransfer.effectAllowed = 'move';
    });
    referenceList.addEventListener('dragover', (event) => {
      const target = event.target.closest('[draggable="true"]');
      if (!target) return;
      event.preventDefault();
      target.classList.add('border-peach');
    });
    referenceList.addEventListener('dragleave', (event) => {
      const target = event.target.closest('[draggable="true"]');
      if (target) target.classList.remove('border-peach');
    });
    referenceList.addEventListener('drop', (event) => {
      const target = event.target.closest('[draggable="true"]');
      if (!target) return;
      event.preventDefault();
      target.classList.remove('border-peach');
      const toIndex = Number.parseInt(target.dataset.index, 10);
      if (Number.isInteger(this.draggedReferenceIndex)) {
        this.reorderReferences(this.draggedReferenceIndex, toIndex);
      }
      this.draggedReferenceIndex = null;
    });
    referenceList.addEventListener('dragend', () => {
      this.draggedReferenceIndex = null;
    });
    referenceList.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-remove]');
      if (!target) return;
      const index = Number.parseInt(target.dataset.remove, 10);
      this.removeReference(index);
    });

    const purposeInput = card.querySelector('#purposeInput');
    purposeInput.addEventListener('input', (event) => {
      this.state.purpose = event.target.value;
    });
    purposeInput.addEventListener('change', () => {
      if (this.state.main) {
        this.generateRoomBrief(true).catch((error) => this.reportError(error));
      }
    });

    return card;
  }

  renderRoomBriefCard() {
    const card = document.createElement('section');
    card.className =
      'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    const loading = this.state.generatingRoomBrief;
    const brief = this.state.roomBrief;

    const heading = document.createElement('h2');
    heading.className = 'text-lg font-semibold';
    heading.textContent = '2. Silent room brief';
    card.appendChild(heading);

    const description = document.createElement('p');
    description.className = 'text-sm text-plum-muted';
    description.textContent =
      'One-time guidance distilled into a paragraph with 3–5 constraints. Automatically regenerates when purpose changes.';
    card.appendChild(description);

    if (loading) {
      const loadingLabel = document.createElement('div');
      loadingLabel.className = 'animate-pulse text-sm text-plum-muted';
      loadingLabel.textContent = 'Generating room brief…';
      card.appendChild(loadingLabel);
    }

    if (brief) {
      const editor = document.createElement('div');
      editor.className = 'flex flex-col gap-4';

      const paragraphField = document.createElement('label');
      paragraphField.className = 'flex flex-col gap-2 text-sm';
      paragraphField.setAttribute('for', 'roomBriefParagraph');
      paragraphField.innerHTML = '<span>Summary paragraph</span>';

      const paragraphInput = document.createElement('textarea');
      paragraphInput.id = 'roomBriefParagraph';
      paragraphInput.rows = 4;
      paragraphInput.value = brief.paragraph || '';
      paragraphInput.disabled = loading;
      paragraphInput.className =
        'rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm text-plum-text focus:outline-none focus:ring-2 focus:ring-peach/70';
      paragraphInput.addEventListener('input', (event) => {
        if (!this.state.roomBrief) return;
        this.state.roomBrief.paragraph = event.target.value;
      });
      paragraphField.appendChild(paragraphInput);
      editor.appendChild(paragraphField);

      const bulletWrapper = document.createElement('div');
      bulletWrapper.className = 'flex flex-col gap-2';

      const bulletLabel = document.createElement('span');
      bulletLabel.className = 'text-sm';
      bulletLabel.textContent = 'Constraints (edit or clear as needed)';
      bulletWrapper.appendChild(bulletLabel);

      const bullets = Array.isArray(brief.bullets) ? brief.bullets : [];
      bullets.forEach((item, index) => {
        const bulletRow = document.createElement('div');
        bulletRow.className = 'flex items-start gap-2';

        const bulletInput = document.createElement('input');
        bulletInput.type = 'text';
        bulletInput.value = item || '';
        bulletInput.disabled = loading;
        bulletInput.dataset.testid = 'room-brief-constraint';
        bulletInput.className =
          'flex-1 rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm text-plum-text focus:outline-none focus:ring-2 focus:ring-peach/70';
        bulletInput.addEventListener('input', (event) => {
          if (!this.state.roomBrief?.bullets) return;
          this.state.roomBrief.bullets[index] = event.target.value;
        });
        bulletRow.appendChild(bulletInput);

        if (bullets.length > 1) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className =
            'rounded-full border border-plum-border/40 px-3 py-1 text-xs text-plum-muted hover:border-peach hover:text-peach';
          removeBtn.textContent = 'Remove';
          removeBtn.disabled = loading;
          removeBtn.addEventListener('click', () => {
            if (!this.state.roomBrief?.bullets) return;
            this.state.roomBrief.bullets = this.state.roomBrief.bullets.filter(
              (_, bulletIdx) => bulletIdx !== index
            );
            this.renderTimeline();
          });
          bulletRow.appendChild(removeBtn);
        }

        bulletWrapper.appendChild(bulletRow);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className =
        'self-start text-xs font-medium text-peach hover:text-peach/70';
      addBtn.textContent = 'Add constraint';
      addBtn.disabled = loading || bullets.length >= 5;
      addBtn.addEventListener('click', () => {
        if (!this.state.roomBrief) return;
        if (!Array.isArray(this.state.roomBrief.bullets)) {
          this.state.roomBrief.bullets = [];
        }
        if (this.state.roomBrief.bullets.length >= 5) return;
        this.state.roomBrief.bullets = [...this.state.roomBrief.bullets, ''];
        this.renderTimeline();
      });
      bulletWrapper.appendChild(addBtn);

      editor.appendChild(bulletWrapper);
      card.appendChild(editor);
    }
    return card;
  }

  renderStartSection() {
    const section = document.createElement('section');
    section.className =
      'rounded-xl2 border border-dashed border-plum-border/40 bg-plum-surface p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between';
    const isRestart = this.state.rounds.length > 0;
    const startLabel = isRestart
      ? 'Restart (clear generated images)'
      : 'Start generating first suggestions';
    const disabled = !this.state.main || this.state.generatingRound;
    const descriptor = isRestart
      ? 'Clear previous iterations and begin again with the current brief.'
      : 'Kick off the first gallery once the silent brief looks right.';

    section.innerHTML = `
      <div class="flex-1 text-sm text-plum-muted">
        <h2 class="text-base font-semibold text-plum-text">${
          isRestart ? 'Ready to restart?' : 'Ready to begin?'
        }</h2>
        <p>${descriptor}</p>
      </div>
      <div class="flex justify-end">
        <button id="startRoundBtn" class="rounded-full bg-peach/90 px-5 py-2 text-sm font-medium text-plum hover:bg-peach disabled:opacity-60 disabled:cursor-not-allowed" ${
          disabled ? 'disabled' : ''
        }>
          ${startLabel}
        </button>
      </div>
    `;

    const startBtn = section.querySelector('#startRoundBtn');
    startBtn.addEventListener('click', () => {
      if (this.state.rounds.length > 0) {
        this.handleRestart();
        return;
      }
      if (!this.state.apiKey) {
        this.settingsModal.showModal();
        return;
      }
      if (!this.state.main) {
        alert('Please upload a main room photo first.');
        return;
      }
      this.startFirstIteration().catch((error) => this.reportError(error));
    });

    return section;
  }

  renderRound(round) {
    const card = document.createElement('section');
    card.className =
      'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-5';
    const title =
      round.index === 0
        ? 'First iteration — 12 style variants'
        : `Iteration ${round.index + 1}`;
    card.innerHTML = `
      <header class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">${title}</h2>
          ${round.completed ? '' : '<span class="text-xs text-plum-muted">Running (pool=6)…</span>'}
        </div>
        <p class="text-sm text-plum-muted">Tiles appear as they finish. Select favorites to unlock the next round.</p>
      </header>
  <div class="grid grid-cols-1 gap-4" id="tileGrid-${round.id}">
        ${round.tiles.map((tile) => this.renderTileMarkup(round, tile)).join('')}
      </div>
    `;

    card.querySelectorAll('[data-tile-id]').forEach((element) => {
      const tileId = element.getAttribute('data-tile-id');
      element
        .querySelector('[data-action="toggle"]')
        ?.addEventListener('click', () => {
          this.toggleFavorite(round.id, tileId);
        });
      const descriptionNode = element.querySelector('[data-action="details"]');
      const detailsNode = element.querySelector('[data-role="details"]');
      if (descriptionNode && detailsNode) {
        const tile = this.findTile(tileId);
        const { full, short } = this.prepareTileDescription(tile?.text);
        descriptionNode.dataset.full = full;
        descriptionNode.dataset.short = short;
        descriptionNode.dataset.expanded = 'false';
        descriptionNode.textContent = short;
        descriptionNode.title = 'Click to toggle details';
        descriptionNode.addEventListener('click', () => {
          const expanded = descriptionNode.dataset.expanded === 'true';
          if (expanded) {
            descriptionNode.dataset.expanded = 'false';
            descriptionNode.textContent = descriptionNode.dataset.short;
            detailsNode.classList.add('hidden');
          } else {
            descriptionNode.dataset.expanded = 'true';
            descriptionNode.textContent = descriptionNode.dataset.full;
            detailsNode.classList.remove('hidden');
          }
        });
      }
      element
        .querySelector('[data-action="open"]')
        ?.addEventListener('click', () => {
          const tile = this.findTile(tileId);
          if (tile?.imageUrl) {
            window.open(tile.imageUrl, '_blank', 'noopener');
          }
        });
      element
        .querySelector('[data-action="retry"]')
        ?.addEventListener('click', () => {
          this.retryTile(round.id, tileId).catch((error) =>
            this.reportError(error)
          );
        });
      element
        .querySelector('[data-action="finalize"]')
        ?.addEventListener('click', () => {
          this.handleFinalize(tileId).catch((error) => this.reportError(error));
        });
      const noteArea = element.querySelector('textarea[data-note]');
      if (noteArea) {
        noteArea.addEventListener('input', (event) => {
          this.updateTileNote(tileId, event.target.value);
        });
      }
    });

    return card;
  }
  renderTileMarkup(round, tile) {
    const baseClasses = [
      'rounded-xl2',
      'border',
      'border-plum-border/40',
      'bg-plum-surface',
      'p-4',
      'flex',
      'flex-col',
      'gap-3',
      'text-sm',
    ];
    if (tile.fav) {
      baseClasses.push('border-peach', 'shadow-lg', 'shadow-peach/10');
    }
    if (tile.status === 'error') {
      baseClasses.push('border-raspberry/50');
    }
    const { short: shortDescription } = this.prepareTileDescription(tile.text);
    const warnings = tile.warnings?.length
      ? `<div class="text-xs text-peach">${tile.warnings.join('; ')}</div>`
      : '';
    let body = '';
    if (tile.status === 'pending') {
      body =
        '<div class="flex flex-1 items-center justify-center rounded-xl2 border border-dashed border-plum-border/30 bg-plum-surface-2 text-xs text-plum-muted h-48">Awaiting generation…</div>';
    } else if (tile.status === 'error') {
      body = `
        <div class="flex flex-col gap-2">
          <p class="text-xs text-raspberry">${tile.error || 'Generation failed.'}</p>
          <button data-action="retry" class="self-start rounded-full border border-raspberry/60 px-3 py-1 text-xs text-raspberry hover:bg-raspberry/10">Retry</button>
        </div>`;
    } else {
      body = `
        <div class="relative w-full overflow-hidden rounded-xl2 border border-plum-border/40 aspect-[3/2]">
          <img src="${tile.imageUrl}" alt="Iteration render" class="h-full w-full object-cover" loading="lazy" />
          <button data-action="open" class="absolute right-2 top-2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">Open</button>
        </div>
        ${warnings}
        <p data-action="details" class="text-sm text-plum-text cursor-pointer" title="Click to toggle details">${shortDescription}</p>
        <div data-role="details" class="hidden text-xs text-plum-muted space-y-2">
          <label class="flex flex-col gap-1">
            <span>User note to send forward (optional)</span>
            <textarea data-note="${tile.id}" class="rounded-xl2 border border-plum-border/40 bg-plum-surface-2 px-2 py-1 text-xs" rows="2" placeholder="e.g. Keep the curved sofa, soften the rug">${tile.note || ''}</textarea>
          </label>
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <button data-action="toggle" class="rounded-full ${tile.fav ? 'bg-peach text-plum' : 'border border-peach text-peach'} px-3 py-1">${tile.fav ? 'Favorited' : 'Favorite + queue'}</button>
          <button data-action="finalize" class="rounded-full border border-plum-border/60 px-3 py-1 text-plum-muted hover:bg-plum-surface-2">Use as final</button>
        </div>`;
    }

    return `
      <article class="${baseClasses.join(' ')}" data-tile-id="${tile.id}">
        <header class="flex items-center justify-between text-xs text-plum-muted">
          <span>Tile ${tile.index + 1}</span>
          <span>${tile.hint}</span>
        </header>
        ${body}
      </article>
    `;
  }

  renderFinalCard() {
    const card = document.createElement('section');
    card.className =
      'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    card.innerHTML = `
      <h2 class="text-lg font-semibold">Final selection</h2>
      <p class="text-sm text-plum-muted">Latest hi-res render with build notes.</p>
      <div class="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <img src="${this.state.final.imageUrl}" alt="Final render" class="w-full rounded-xl2 border border-plum-border/40 object-cover" />
        <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface p-4 text-sm text-plum-muted whitespace-pre-line">${this.state.final.notes || '(No build notes yet)'}</div>
      </div>
    `;
    return card;
  }

  renderGenerateBar() {
    if (!this.generateBar) return;
    const hasSelection = this.state.selectedForNext.size > 0;
    const hasRounds = this.state.rounds.length > 0;
    const allowBar = hasSelection && hasRounds;
    if (allowBar) {
      this.generateBar.classList.remove('hidden');
      this.generateBar.removeAttribute('hidden');
    } else {
      this.generateBar.classList.add('hidden');
      this.generateBar.setAttribute('hidden', '');
    }
    if (this.guidanceInput) {
      this.guidanceInput.value = this.state.roundGuidance;
      this.guidanceInput.disabled = !hasRounds || this.state.generatingRound;
    }
    if (this.generateBtn) {
      this.generateBtn.disabled = !allowBar || this.state.generatingRound;
    }
    if (this.selectedCounter) {
      this.selectedCounter.textContent = `${this.state.selectedForNext.size} favorite${
        this.state.selectedForNext.size === 1 ? '' : 's'
      } selected`;
    }
  }

  renderFinalModal() {
    if (!this.finalModal) return;
    if (this.state.candidate) {
      this.finalCandidate.src = this.state.candidate.imageUrl;
      this.finalCandidateNotes.textContent =
        this.state.candidate.notes || '(No build notes)';
    }
    if (this.state.final.imageUrl) {
      this.finalCurrent.src = this.state.final.imageUrl;
      this.finalCurrentNotes.textContent =
        this.state.final.notes || '(No build notes yet)';
    }
  }

  prepareTileDescription(text) {
    const fallback = '(Descriptor pending)';
    if (!text || !text.trim()) {
      return { full: fallback, short: fallback };
    }
    const normalized = text.trim().replace(/\s+/g, ' ');
    const words = normalized.split(' ');
    if (words.length <= 12) {
      return { full: normalized, short: normalized };
    }
    return {
      full: normalized,
      short: `${words.slice(0, 12).join(' ')}…`,
    };
  }

  async importMainPhoto(file) {
    const normalized = await normalizeImageFile(file);
    const base64 = await blobToBase64(normalized.resized);
    const displayUrl = await blobToDataUrl(normalized.display);
    this.state.main = {
      id: randomId('main'),
      original: normalized.original,
      resized: normalized.resized,
      display: normalized.display,
      displayUrl,
      base64,
      mime: file.type || 'image/jpeg',
      width: normalized.width,
      height: normalized.height,
    };
    this.state.roomBrief = null;
    this.state.roomBriefPurpose = '';
    this.render();
  }

  async importReference(file) {
    if (this.state.references.length >= MAX_REFERENCES) {
      alert(
        'Only two reference images are supported. Remove one before adding another.'
      );
      return;
    }
    const normalized = await normalizeImageFile(file);
    const base64 = await blobToBase64(normalized.resized);
    const displayUrl = await blobToDataUrl(normalized.display);
    this.state.references = [
      ...this.state.references,
      {
        id: randomId('ref'),
        base64,
        mime: file.type || 'image/jpeg',
        displayUrl,
        width: normalized.width,
        height: normalized.height,
      },
    ];
    this.render();
  }

  reorderReferences(from, to) {
    if (from === to) return;
    const next = [...this.state.references];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    this.state.references = next;
    this.render();
  }

  removeReference(index) {
    this.state.references = this.state.references.filter(
      (_, idx) => idx !== index
    );
    this.render();
  }

  async startFirstIteration() {
    await this.generateRoomBrief(false);
    await this.runIteration([]);
  }

  async generateRoomBrief(force) {
    if (!this.state.main) return;
    if (
      !force &&
      this.state.roomBrief &&
      this.state.roomBriefPurpose === this.state.purpose
    ) {
      return;
    }
    this.state.generatingRoomBrief = true;
    this.render();
    try {
      const promptText = this.buildRoomBriefPrompt();
      const result = await this.iterationApi.generateRoomBrief({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
      });
      this.state.roomBrief = result;
      this.state.roomBriefPurpose = this.state.purpose;
    } finally {
      this.state.generatingRoomBrief = false;
      this.render();
    }
  }

  buildRoomBriefPrompt() {
    const purpose = this.state.purpose || 'None';
    const notes = this.state.roundGuidance?.trim()
      ? this.state.roundGuidance.trim()
      : 'None';
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
    ].join('\n');
  }
  toggleFavorite(roundId, tileId) {
    const tile = this.findTile(tileId);
    if (!tile || tile.status !== 'ok') return;
    tile.fav = !tile.fav;
    if (tile.fav) {
      this.state.selectedForNext.add(tile.id);
    } else {
      this.state.selectedForNext.delete(tile.id);
    }
    this.renderGenerateBar();
    this.renderTimeline();
  }

  updateTileNote(tileId, value) {
    const tile = this.findTile(tileId);
    if (!tile) return;
    tile.note = value;
  }

  async handleGenerateNext() {
    if (this.state.selectedForNext.size === 0) return;
    const favorites = [...this.state.selectedForNext]
      .map((id) => this.findTile(id))
      .filter(Boolean);
    await this.runIteration(favorites);
  }

  buildFavoritesTextBlock(favorites) {
    if (!favorites.length) return '';
    return favorites
      .map((tile) => {
        const lines = [tile.text || ''];
        if (tile.note?.trim()) {
          lines.push(`User note: ${tile.note.trim()}`);
        }
        return lines.filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join('\n');
  }

  gatherReferencesForApi() {
    return this.state.references.map((ref) => ({
      mime: ref.mime,
      base64: ref.base64,
    }));
  }

  async runIteration(favorites) {
    if (!this.state.main) return;
    this.state.generatingRound = true;
    this.state.selectedForNext.clear();
    this.state.rounds.forEach((existingRound) => {
      existingRound.tiles.forEach((tile) => {
        tile.fav = false;
      });
    });
    this.renderGenerateBar();
    this.renderTimeline();
    const roundIndex = this.state.rounds.length;
    const hints = diversityDeck();
    const round = {
      id: randomId('round'),
      index: roundIndex,
      hints,
      tiles: hints.map((hint, idx) => ({
        id: randomId(`tile-${roundIndex}-${idx}`),
        index: idx,
        status: 'pending',
        fav: false,
        note: '',
        hint,
        text: '',
        warnings: [],
      })),
      completed: false,
      context: {
        roomBrief: this.state.roomBrief,
        purpose: this.state.purpose,
        favoritesTextBlock: this.buildFavoritesTextBlock(favorites),
        roundGuidance: this.state.roundGuidance,
      },
    };
    this.state.rounds = [...this.state.rounds, round];
    this.renderTimeline();
    try {
      await runIterationBatch({
        api: this.iterationApi,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: this.gatherReferencesForApi(),
        roomBrief:
          (this.state.roomBrief?.paragraph || '') +
          (this.state.roomBrief?.bullets?.length
            ? '\n' +
              this.state.roomBrief.bullets.map((item) => `• ${item}`).join('\n')
            : ''),
        purpose: this.state.purpose,
        roundGuidance: this.state.roundGuidance,
        favoritesTextBlock: this.buildFavoritesTextBlock(favorites),
        sampling: this.state.sampling,
        onProgress: ({ index, ok, result, error }) => {
          const target = round.tiles[index];
          if (!target) return;
          if (ok) {
            target.status = 'ok';
            target.imageUrl = result.imageUrl;
            target.text = result.text;
            target.warnings = result.warnings || [];
            target.error = '';
          } else {
            target.status = 'error';
            target.error = error?.message || String(error);
          }
          this.renderTimeline();
        },
      });
      round.completed = true;
    } finally {
      this.state.generatingRound = false;
      this.state.selectedForNext.clear();
      this.state.roundGuidance = '';
      if (this.guidanceInput) {
        this.guidanceInput.value = '';
      }
      this.render();
    }
  }

  async retryTile(roundId, tileId) {
    const round = this.state.rounds.find((r) => r.id === roundId);
    if (!round) return;
    const tileIndex = round.tiles.findIndex((tile) => tile.id === tileId);
    if (tileIndex === -1) return;
    const tile = round.tiles[tileIndex];
    tile.status = 'pending';
    tile.error = '';
    this.renderTimeline();
    const promptText = buildIterationPrompt({
      roomBrief:
        (round.context.roomBrief?.paragraph || '') +
        (round.context.roomBrief?.bullets?.length
          ? '\n' +
            round.context.roomBrief.bullets
              .map((item) => `• ${item}`)
              .join('\n')
          : ''),
      purpose: round.context.purpose,
      roundGuidance: round.context.roundGuidance,
      favoritesTextBlock: round.context.favoritesTextBlock,
      diversityHint: tile.hint,
    });
    try {
      const result = await this.iterationApi.generateVariant({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        references: this.gatherReferencesForApi(),
        sampling: this.state.sampling,
      });
      tile.status = 'ok';
      tile.imageUrl = result.imageUrl;
      tile.text = result.text;
      tile.warnings = result.warnings || [];
    } catch (error) {
      tile.status = 'error';
      tile.error = error?.message || String(error);
    }
    this.renderTimeline();
  }

  findTile(tileId) {
    for (const round of this.state.rounds) {
      const match = round.tiles.find((tile) => tile.id === tileId);
      if (match) return match;
    }
    return null;
  }

  async handleFinalize(tileId) {
    if (this.state.generatingFinal) return;
    const tile = this.findTile(tileId);
    if (!tile || tile.status !== 'ok') return;
    if (!this.state.main) return;
    this.state.generatingFinal = true;
    this.renderGenerateBar();
    try {
      const base64Child = await this.fetchBase64FromUrl(tile.imageUrl);
      const childBlob = base64ToBlob(base64Child, 'image/jpeg');
      const promptText = buildFinalizationPrompt();
      const response = await this.iterationApi.finalizeHiRes({
        promptText,
        base64Main: this.state.main.base64,
        mimeMain: this.state.main.mime,
        base64Child,
        mimeChild: childBlob.type || 'image/jpeg',
        references: this.gatherReferencesForApi(),
        sampling: this.state.sampling,
      });
      this.state.candidate = {
        imageUrl: response.imageUrl,
        notes: response.text || '',
      };
      this.showFinalModal();
    } catch (error) {
      alert(`Finalization failed: ${error?.message || error}`);
    } finally {
      this.state.generatingFinal = false;
      this.renderGenerateBar();
    }
  }

  async fetchBase64FromUrl(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return blobToBase64(blob);
  }

  ensureFinalModal() {
    if (this.finalModal && this.finalBackdrop) {
      return;
    }

    this.finalBackdrop = document.createElement('div');
    this.finalBackdrop.id = 'final-backdrop';
    this.finalBackdrop.className = 'fixed inset-0 hidden z-50 bg-black/70';
    document.body.appendChild(this.finalBackdrop);

    this.finalModal = document.createElement('section');
    this.finalModal.id = 'final-modal';
    this.finalModal.className =
      'fixed inset-x-4 top-1/2 hidden z-50 -translate-y-1/2 rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 shadow-xl';
    this.finalModal.innerHTML = `
      <header class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">Compare final render</h2>
          <p class="text-sm text-plum-muted">Review the hi-res candidate against the current final build notes.</p>
        </div>
        <button id="final-close" class="text-sm text-plum-muted hover:text-peach">Close</button>
      </header>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <h3 class="text-xs uppercase tracking-wide text-plum-muted">Current final</h3>
          <img id="final-current" class="w-full rounded-xl2 border border-plum-border/40 object-cover" alt="Current final" />
          <p id="final-current-notes" class="text-xs text-plum-muted whitespace-pre-line"></p>
        </div>
        <div class="flex flex-col gap-2">
          <h3 class="text-xs uppercase tracking-wide text-plum-muted">Candidate</h3>
          <img id="final-candidate" class="w-full rounded-xl2 border border-plum-border/40 object-cover" alt="Candidate final" />
          <p id="final-candidate-notes" class="text-xs text-plum-muted whitespace-pre-line"></p>
        </div>
      </div>
      <footer class="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button id="final-keep" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm text-plum-muted hover:bg-plum-surface">Keep current</button>
        <button id="final-replace" class="rounded-full bg-raspberry px-4 py-2 text-sm font-medium text-white hover:bg-raspberry/90">Replace with candidate</button>
      </footer>
    `;
    document.body.appendChild(this.finalModal);

    this.finalClose = this.finalModal.querySelector('#final-close');
    this.finalCurrent = this.finalModal.querySelector('#final-current');
    this.finalCandidate = this.finalModal.querySelector('#final-candidate');
    this.finalCurrentNotes = this.finalModal.querySelector(
      '#final-current-notes'
    );
    this.finalCandidateNotes = this.finalModal.querySelector(
      '#final-candidate-notes'
    );
    this.finalKeep = this.finalModal.querySelector('#final-keep');
    this.finalReplace = this.finalModal.querySelector('#final-replace');

    this.finalClose.addEventListener('click', () => this.closeFinalModal());
    this.finalBackdrop.addEventListener('click', () => this.closeFinalModal());
    this.finalKeep.addEventListener('click', () => this.closeFinalModal());
    this.finalReplace.addEventListener('click', () => {
      if (this.state.candidate) {
        this.state.final = {
          imageUrl: this.state.candidate.imageUrl,
          notes: this.state.candidate.notes,
        };
        this.state.candidate = null;
        this.closeFinalModal();
        this.render();
      }
    });
  }

  showFinalModal() {
    this.ensureFinalModal();
    this.finalBackdrop.classList.remove('hidden');
    this.finalModal.classList.remove('hidden');
    if (!this.isFinalKeyListenerAttached) {
      document.addEventListener('keydown', this.handleEscapeKeydown);
      this.isFinalKeyListenerAttached = true;
    }
    this.renderFinalModal();
  }

  closeFinalModal() {
    if (this.finalBackdrop) {
      this.finalBackdrop.classList.add('hidden');
    }
    if (this.finalModal) {
      this.finalModal.classList.add('hidden');
    }
    if (this.isFinalKeyListenerAttached) {
      document.removeEventListener('keydown', this.handleEscapeKeydown);
      this.isFinalKeyListenerAttached = false;
    }
  }

  handleRestart() {
    if (
      !confirm(
        'Clear all generated images and selections. Keep base photo, purpose, references, room brief and settings?'
      )
    ) {
      return;
    }
    this.state.rounds = [];
    this.state.selectedForNext.clear();
    this.state.roundGuidance = '';
    this.state.final = { imageUrl: '', notes: '' };
    this.state.candidate = null;
    this.render();
  }

  reportError(error) {
    console.error(error);
    alert(error?.message || String(error));
  }
}
