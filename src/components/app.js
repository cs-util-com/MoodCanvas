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
import {
  ensureProject,
  getProject,
  saveMedia,
  saveArtifact,
  appendEvent,
} from '../utils/project-store.js';
import {
  buildRoomBriefPrompt,
  buildIterationPrompt,
  buildDescriptorRepairPrompt,
  buildFinalizationPrompt,
  buildFinalizationRepairPrompt,
} from '../utils/prompt-builder.js';
import { parseRoomBrief } from '../utils/room-brief-parser.js';
import { parseFlashImageResponse } from '../utils/flash-image-parser.js';
import { buildDiversityDeck } from '../utils/diversity-deck.js';
import { runLimitedPool } from '../utils/pool.js';

const STORAGE_PROJECT_KEY = 'moodcanvas.currentProjectId';
const ITERATION_TILE_COUNT = 12;
const ITERATION_POOL_SIZE = 6;
const MAX_REFERENCES = 2;

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.client = new GeminiClient();
    this.unsubscribeKey = null;
    this.state = {
      apiKey: '',
      project: null,
      basePhoto: null,
      references: [],
      purpose: '',
      globalGuidance: '',
      roomBrief: null,
      roomBriefLoading: false,
      roomBriefError: null,
      iterations: [],
      finalRender: null,
      finalCandidate: null,
      generatingIteration: false,
      finalizing: false,
      bannerError: null,
    };
  }

  async init() {
    this.renderShell();
    await this.bootstrapProject();
    this.bootstrapKey();
    this.render();
  }

  destroy() {
    this.unsubscribeKey?.();
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col">
        <header class="border-b border-plum-border/40 bg-plum-surface">
          <div class="mx-auto w-full max-w-5xl px-6 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.3em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-2xl md:text-3xl font-semibold">Iterative Interior Explorer</h1>
              <p class="text-sm text-plum-muted max-w-xl">
                Upload a room photo, collect references, and iterate through mood-driven variants until you lock a final design — all client-side.
              </p>
            </div>
            <div class="flex items-center gap-3">
              <span id="keyStatus" class="rounded-full border border-plum-border/40 px-3 py-1 text-xs uppercase tracking-widest text-plum-muted"></span>
              <button id="restartBtn" class="rounded-full border border-plum-border/40 px-4 py-2 text-sm text-plum-text hover:bg-plum-surface-2" type="button">Restart</button>
              <button id="settingsBtn" class="rounded-full bg-raspberry/90 hover:bg-raspberry text-white px-4 py-2 text-sm font-medium transition" type="button">Settings</button>
            </div>
          </div>
        </header>
        <main class="flex-1">
          <div class="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-6" id="stack"></div>
        </main>
        <footer class="bg-plum-surface-2 border-t border-plum-border/40">
          <div id="generateBar" class="mx-auto flex w-full max-w-5xl px-6 py-4"></div>
        </footer>
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
      <dialog id="restartModal" class="backdrop:bg-black/70 rounded-xl2 bg-plum-surface-2 text-plum-text shadow-dialog p-0">
        <form method="dialog" class="flex flex-col gap-6 p-8 min-w-[320px]">
          <header>
            <h2 class="text-xl font-semibold">Restart project</h2>
            <p class="text-sm text-plum-muted">Clear generated rounds, favorites, and the current final. Keep the base photo, purpose, references, room brief, and settings.</p>
          </header>
          <div class="flex justify-end gap-3">
            <button value="cancel" class="rounded-full px-4 py-2 text-sm bg-plum-surface hover:bg-plum-surface-2 border border-plum-border/60">Cancel</button>
            <button value="confirm" class="rounded-full px-4 py-2 text-sm bg-raspberry text-white hover:bg-raspberry/90">Restart</button>
          </div>
        </form>
      </dialog>
      <dialog id="finalCompareModal" class="backdrop:bg-black/70 rounded-xl2 bg-plum-surface-2 text-plum-text shadow-dialog p-0 max-w-4xl">
        <div class="flex flex-col gap-6 p-8" id="finalCompareContent"></div>
      </dialog>
    `;

    this.stackEl = this.root.querySelector('#stack');
    this.keyStatusEl = this.root.querySelector('#keyStatus');
    this.generateBarEl = this.root.querySelector('#generateBar');
    this.settingsModal = this.root.querySelector('#settingsModal');
    this.restartModal = this.root.querySelector('#restartModal');
    this.finalModal = this.root.querySelector('#finalCompareModal');
    this.finalModalContent = this.root.querySelector('#finalCompareContent');
    this.settingsBtn = this.root.querySelector('#settingsBtn');
    this.restartBtn = this.root.querySelector('#restartBtn');
    this.keyInput = this.root.querySelector('#keyInput');
    this.clearKeyBtn = this.root.querySelector('#clearKeyBtn');

    this.settingsBtn.addEventListener('click', () => {
      if (this.settingsModal.open) return;
      this.keyInput.value = this.state.apiKey;
      this.settingsModal.showModal();
    });

    this.restartBtn.addEventListener('click', () => {
      if (this.restartModal.open) return;
      this.restartModal.showModal();
    });

    this.settingsModal.addEventListener('close', () => {
      this.keyInput.value = this.state.apiKey;
    });

    this.settingsModal.querySelector('form').addEventListener('submit', (event) => {
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

    this.restartModal.addEventListener('close', () => {
      if (this.restartModal.returnValue === 'confirm') {
        this.performRestart();
      }
    });
  }
  async bootstrapProject() {
    const existingId = localStorage.getItem(STORAGE_PROJECT_KEY);
    let project = await getProject(existingId);
    if (!project) {
      project = await ensureProject({ name: 'Room Session' });
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
      this.renderGenerateBar();
    });
  }

  render() {
    this.renderKeyStatus();
    if (!this.stackEl) return;
    this.stackEl.innerHTML = '';

    const setupCard = this.renderSetupCard();
    this.stackEl.appendChild(setupCard);

    if (this.state.roomBrief || this.state.roomBriefLoading || this.state.roomBriefError) {
      this.stackEl.appendChild(this.renderRoomBriefCard());
    }

    const favoritesCard = this.renderFavoritesCard();
    if (favoritesCard) {
      this.stackEl.appendChild(favoritesCard);
    }

    const iterationsCard = this.renderIterationsStack();
    if (iterationsCard) {
      this.stackEl.appendChild(iterationsCard);
    }

    const finalCard = this.renderFinalCard();
    if (finalCard) {
      this.stackEl.appendChild(finalCard);
    }

    if (this.state.bannerError) {
      const banner = document.createElement('div');
      banner.className = 'rounded-xl2 border border-raspberry/50 bg-raspberry/10 px-4 py-3 text-raspberry text-sm';
      banner.textContent = this.state.bannerError;
      this.stackEl.prepend(banner);
    }

    this.renderGenerateBar();
    this.renderFinalCompareDialog();
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

  renderSetupCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-6';
    const basePreview = this.state.basePhoto
      ? `<div class="flex items-center gap-4"><img src="${this.state.basePhoto.dataUrl}" alt="Base room" class="h-24 w-36 rounded-xl2 object-cover border border-plum-border/40" /><div class="text-sm text-plum-muted">${this.state.basePhoto.fileName ?? 'Room photo'} · ${this.state.basePhoto.width}×${this.state.basePhoto.height}px</div></div>`
      : '<p class="text-sm text-plum-muted">No base photo yet.</p>';

    const referencesMarkup = this.state.references
      .map(
        (ref, index) => `
          <li class="flex items-center gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface px-3 py-2" draggable="true" data-reference-id="${ref.id}" data-index="${index}">
            <img src="${ref.dataUrl}" alt="Reference ${index + 1}" class="h-16 w-16 rounded-xl2 object-cover border border-plum-border/40" />
            <div class="flex-1">
              <p class="text-sm">Reference ${index + 1}</p>
              <p class="text-xs text-plum-muted">${ref.fileName ?? 'Image'} · ${ref.width}×${ref.height}px</p>
            </div>
            <div class="flex gap-2">
              <button type="button" data-action="reference-up" class="rounded-full border border-plum-border/40 px-2 py-1 text-xs text-plum-muted">↑</button>
              <button type="button" data-action="reference-down" class="rounded-full border border-plum-border/40 px-2 py-1 text-xs text-plum-muted">↓</button>
              <button type="button" data-action="reference-remove" class="rounded-full border border-raspberry/50 px-2 py-1 text-xs text-raspberry">Remove</button>
            </div>
          </li>
        `
      )
      .join('');

    card.innerHTML = `
      <header class="flex flex-col gap-2">
        <h2 class="text-xl font-semibold">Project setup</h2>
        <p class="text-sm text-plum-muted">Upload the base photo, optional purpose, and up to two style references. Order reflects weighting.</p>
      </header>
      <div class="flex flex-col gap-4">
        <label class="flex flex-col gap-2 text-sm">
          <span>Main target photo</span>
          <input data-role="main-photo" type="file" accept="image/jpeg,image/png" capture="environment" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm" />
        </label>
        <div class="rounded-xl2 border border-plum-border/40 bg-plum-surface px-4 py-3">
          ${basePreview}
        </div>
        <label class="flex flex-col gap-2 text-sm">
          <span>Room purpose (optional)</span>
          <input data-role="purpose" type="text" value="${escapeHtml(this.state.purpose)}" placeholder="e.g. Lounge with reading corner" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" />
        </label>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">Reference images (max ${MAX_REFERENCES})</span>
            <label class="text-xs text-peach underline cursor-pointer">
              Add reference
              <input data-role="reference-input" type="file" accept="image/jpeg,image/png" class="hidden" ${
                this.state.references.length >= MAX_REFERENCES ? 'disabled' : ''
              } />
            </label>
          </div>
          <ul class="flex flex-col gap-2" data-role="reference-list">
            ${referencesMarkup || '<li class="text-sm text-plum-muted">No references yet.</li>'}
          </ul>
        </div>
      </div>
    `;

    const photoInput = card.querySelector('[data-role="main-photo"]');
    photoInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importBasePhoto(file);
        event.target.value = '';
      }
    });

    const purposeInput = card.querySelector('[data-role="purpose"]');
    purposeInput.addEventListener('change', (event) => {
      this.state.purpose = event.target.value;
      if (this.state.basePhoto) {
        this.generateRoomBrief();
      }
    });

    const referenceInput = card.querySelector('[data-role="reference-input"]');
    referenceInput?.addEventListener('change', (event) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length) {
        this.importReferences(files.slice(0, MAX_REFERENCES - this.state.references.length));
        event.target.value = '';
      }
    });

    const list = card.querySelector('[data-role="reference-list"]');
    list.querySelectorAll('li[data-reference-id]').forEach((item) => {
      item.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', item.dataset.referenceId);
      });
      item.addEventListener('dragover', (event) => event.preventDefault());
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer.getData('text/plain');
        const targetId = item.dataset.referenceId;
        if (sourceId && targetId && sourceId !== targetId) {
          this.reorderReferences(sourceId, targetId);
        }
      });
      item.querySelectorAll('button[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          const referenceId = item.dataset.referenceId;
          if (action === 'reference-remove') {
            this.removeReference(referenceId);
          } else if (action === 'reference-up') {
            this.shiftReference(referenceId, -1);
          } else if (action === 'reference-down') {
            this.shiftReference(referenceId, 1);
          }
        });
      });
    });

    return card;
  }

  renderRoomBriefCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-3';
    card.innerHTML = `
      <header class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold">Room brief</h2>
          <p class="text-sm text-plum-muted">Silent Gemini summary that feeds each iteration prompt.</p>
        </div>
        <div class="text-xs text-plum-muted">
          ${this.state.roomBriefLoading ? '<span class="animate-pulse">Updating…</span>' : ''}
        </div>
      </header>
    `;

    if (this.state.roomBriefError) {
      const error = document.createElement('p');
      error.className = 'text-sm text-raspberry';
      error.textContent = this.state.roomBriefError;
      card.appendChild(error);
      return card;
    }

    if (!this.state.roomBrief) {
      const placeholder = document.createElement('p');
      placeholder.className = 'text-sm text-plum-muted';
      placeholder.textContent = 'Room brief will appear once the base photo is processed.';
      card.appendChild(placeholder);
      return card;
    }

    const brief = document.createElement('div');
    brief.className = 'flex flex-col gap-3';
    const paragraph = document.createElement('p');
    paragraph.className = 'text-sm leading-relaxed';
    paragraph.textContent = this.state.roomBrief.paragraph;
    brief.appendChild(paragraph);

    const list = document.createElement('ul');
    list.className = 'list-disc pl-5 text-sm text-plum-muted';
    for (const bullet of this.state.roomBrief.bullets) {
      const li = document.createElement('li');
      li.textContent = bullet;
      list.appendChild(li);
    }
    brief.appendChild(list);
    card.appendChild(brief);
    return card;
  }

  renderFavoritesCard() {
    const favorites = this.collectAllFavorites();
    if (favorites.length === 0) return null;
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    card.innerHTML = `
      <header>
        <h2 class="text-xl font-semibold">Favorites</h2>
        <p class="text-sm text-plum-muted">All favorited variants stay here for quick review.</p>
      </header>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        ${favorites
          .map(
            (entry) => `
              <article class="rounded-xl2 border border-plum-border/40 bg-plum-surface p-3 flex gap-3">
                <a href="${entry.imageUrl}" target="_blank" rel="noreferrer" class="flex-shrink-0">
                  <img src="${entry.imageUrl}" alt="Favorite preview" class="h-20 w-32 rounded-xl2 object-cover border border-plum-border/40" />
                </a>
                <div class="flex flex-col gap-1 text-sm">
                  <p class="font-medium">Iteration ${entry.round} · Tile ${entry.tileIndex + 1}</p>
                  <p class="text-plum-muted line-clamp-3">${entry.descriptor}</p>
                  ${entry.note ? `<p class="text-xs text-plum-muted">Note: ${entry.note}</p>` : ''}
                </div>
              </article>
            `
          )
          .join('')}
      </div>
    `;
    return card;
  }

  renderIterationsStack() {
    if (this.state.iterations.length === 0) return null;
    const container = document.createElement('section');
    container.className = 'flex flex-col gap-4';

    this.state.iterations.forEach((iteration, index) => {
      const details = document.createElement('details');
      details.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2';
      if (index >= this.state.iterations.length - 2) {
        details.open = true;
      }
      const summary = document.createElement('summary');
      summary.className = 'cursor-pointer select-none px-6 py-4 flex items-center justify-between gap-3';
      summary.innerHTML = `
        <div class="flex flex-col">
          <span class="text-sm uppercase tracking-[0.2em] text-plum-muted">Iteration</span>
          <span class="text-lg font-semibold">Round ${iteration.round}</span>
        </div>
        <div class="text-sm text-plum-muted">${this.countFavorites(iteration)} favorites · Diversity deck anchored on ${iteration.deck[0]?.axis.label ?? 'axis'}</div>
      `;
      details.appendChild(summary);

      const grid = document.createElement('div');
      grid.className = 'grid gap-4 px-6 pb-6 pt-2 sm:grid-cols-2 lg:grid-cols-3';
      iteration.tiles.forEach((tile) => {
        grid.appendChild(this.renderTile(iteration, tile));
      });
      details.appendChild(grid);
      container.appendChild(details);
    });

    return container;
  }
  renderTile(iteration, tile) {
    const article = document.createElement('article');
    article.className = 'flex flex-col gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface p-4';
    const image = document.createElement('a');
    image.className = 'block aspect-[3/2] overflow-hidden rounded-xl2 border border-plum-border/40 bg-plum-surface-2';
    image.href = tile.image?.url ?? '#';
    image.target = '_blank';
    image.rel = 'noreferrer';
    if (tile.image?.url) {
      const img = document.createElement('img');
      img.src = tile.image.url;
      img.alt = `Iteration ${iteration.round} variant ${tile.index + 1}`;
      img.className = 'h-full w-full object-cover';
      image.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'flex h-full w-full items-center justify-center text-sm text-plum-muted';
      placeholder.textContent = tile.status === 'running' ? 'Rendering…' : 'Pending';
      image.appendChild(placeholder);
    }
    article.appendChild(image);

    const meta = document.createElement('div');
    meta.className = 'flex flex-col gap-1 text-sm';
    meta.innerHTML = `
      <p class="font-medium">Tile ${tile.index + 1} · ${tile.axis.label}</p>
      <p class="text-xs text-plum-muted">${tile.axis.instruction}</p>
    `;
    article.appendChild(meta);

    if (tile.status === 'error') {
      const error = document.createElement('p');
      error.className = 'text-sm text-raspberry';
      error.textContent = tile.errorMessage ?? 'Generation failed.';
      article.appendChild(error);
    }

    const actions = document.createElement('div');
    actions.className = 'flex flex-wrap gap-2';

    const favoriteBtn = document.createElement('button');
    favoriteBtn.type = 'button';
    favoriteBtn.className = `rounded-full px-3 py-1 text-xs border transition ${
      tile.favorite
        ? 'bg-peach text-plum border-peach'
        : 'border-plum-border/40 text-plum-muted hover:bg-plum-surface-2'
    }`;
    favoriteBtn.textContent = tile.favorite ? 'Favorited' : 'Mark favorite';
    favoriteBtn.disabled = tile.status !== 'complete';
    favoriteBtn.addEventListener('click', () => {
      this.toggleFavorite(iteration.id, tile.id);
    });
    actions.appendChild(favoriteBtn);

    if (tile.status === 'error') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'rounded-full border border-plum-border/40 px-3 py-1 text-xs text-plum-muted hover:bg-plum-surface-2';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        this.retryTile(iteration.id, tile.id);
      });
      actions.appendChild(retryBtn);
    }

    if (tile.status === 'complete') {
      const finalizeBtn = document.createElement('button');
      finalizeBtn.type = 'button';
      finalizeBtn.className = 'rounded-full border border-plum-border/60 px-3 py-1 text-xs text-plum-muted hover:bg-plum-surface-2';
      finalizeBtn.textContent = 'Use as final';
      finalizeBtn.disabled = this.state.finalizing;
      finalizeBtn.addEventListener('click', () => {
        this.finalizeTile(iteration.id, tile.id);
      });
      actions.appendChild(finalizeBtn);
    }

    article.appendChild(actions);

    const details = document.createElement('details');
    details.className = 'rounded-xl2 border border-plum-border/30 bg-plum-surface-2 p-3 text-sm';
    const summary = document.createElement('summary');
    summary.className = 'cursor-pointer select-none text-sm font-medium';
    summary.textContent = 'Details';
    details.appendChild(summary);

    const descriptor = document.createElement('p');
    descriptor.className = 'mt-2 text-sm leading-relaxed text-plum-muted';
    descriptor.textContent = tile.descriptor || (tile.status === 'complete' ? 'Descriptor missing.' : 'Descriptor pending.');
    details.appendChild(descriptor);

    const noteWrapper = document.createElement('label');
    noteWrapper.className = 'mt-3 flex flex-col gap-2 text-xs text-plum-muted';
    noteWrapper.innerHTML = '<span>Mini note (optional, feeds next prompt)</span>';
    const textarea = document.createElement('textarea');
    textarea.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-peach/70';
    textarea.value = tile.note ?? '';
    textarea.rows = 3;
    textarea.disabled = !tile.favorite;
    textarea.addEventListener('input', (event) => {
      this.updateFavoriteNote(iteration.id, tile.id, event.target.value);
    });
    noteWrapper.appendChild(textarea);
    details.appendChild(noteWrapper);

    article.appendChild(details);
    return article;
  }

  renderFinalCard() {
    if (!this.state.finalRender) return null;
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    card.innerHTML = `
      <header>
        <h2 class="text-xl font-semibold">Current final</h2>
        <p class="text-sm text-plum-muted">High-res re-render with build notes.</p>
      </header>
      <div class="flex flex-col gap-4 md:flex-row md:gap-6">
        <a href="${this.state.finalRender.image.url}" target="_blank" rel="noreferrer" class="flex-shrink-0 md:w-1/2">
          <img src="${this.state.finalRender.image.url}" alt="Final render" class="w-full rounded-xl2 border border-plum-border/40 object-cover" />
        </a>
        <div class="flex-1 text-sm leading-relaxed">
          <h3 class="font-medium text-plum-text mb-2">Build notes</h3>
          <p class="text-plum-muted whitespace-pre-line">${this.state.finalRender.buildNotes}</p>
        </div>
      </div>
    `;
    return card;
  }

  renderGenerateBar() {
    if (!this.generateBarEl) return;
    this.generateBarEl.innerHTML = '';

    if (!this.state.basePhoto || !this.state.roomBrief || this.state.roomBriefLoading) {
      const placeholder = document.createElement('p');
      placeholder.className = 'text-sm text-plum-muted';
      placeholder.textContent = 'Upload the base photo and wait for the room brief to start iterating.';
      this.generateBarEl.appendChild(placeholder);
      return;
    }

    if (this.state.iterations.length === 0) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rounded-full bg-peach px-5 py-2 text-sm font-medium text-plum hover:bg-peach/90 disabled:opacity-60';
      button.textContent = this.state.generatingIteration ? 'Starting…' : 'Start generating first suggestions';
      button.disabled = this.state.generatingIteration;
      button.addEventListener('click', () => this.startIteration());
      this.generateBarEl.appendChild(button);
      return;
    }

    const lastIteration = this.state.iterations[this.state.iterations.length - 1];
    const favoriteCount = this.countFavorites(lastIteration);
    if (favoriteCount === 0) {
      const hint = document.createElement('p');
      hint.className = 'text-sm text-plum-muted';
      hint.textContent = 'Select at least one favorite to unlock the next iteration.';
      this.generateBarEl.appendChild(hint);
      return;
    }

    const form = document.createElement('form');
    form.className = 'flex w-full flex-col gap-3 md:flex-row md:items-center';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.startIteration();
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.value = this.state.globalGuidance;
    input.placeholder = 'Global guidance for the next iteration (optional)';
    input.className = 'flex-1 rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-peach/70';
    input.addEventListener('input', (event) => {
      this.state.globalGuidance = event.target.value;
    });

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'rounded-full bg-peach px-5 py-2 text-sm font-medium text-plum hover:bg-peach/90 disabled:opacity-60';
    submit.disabled = this.state.generatingIteration;
    submit.textContent = this.state.generatingIteration ? 'Generating…' : 'Generate next iteration';

    form.appendChild(input);
    form.appendChild(submit);
    this.generateBarEl.appendChild(form);
  }

  renderFinalCompareDialog() {
    if (!this.finalModal || !this.finalModalContent) return;
    if (!this.state.finalCandidate) {
      this.finalModalContent.innerHTML = '';
      if (this.finalModal.open) {
        this.finalModal.close();
      }
      return;
    }

    const candidate = this.state.finalCandidate;
    const currentFinal = this.state.finalRender;
    this.finalModalContent.innerHTML = `
      <header>
        <h2 class="text-xl font-semibold">Compare & decide</h2>
        <p class="text-sm text-plum-muted">Review the new hi-res candidate next to the current final.</p>
      </header>
      <div class="grid gap-4 md:grid-cols-2">
        <div class="flex flex-col gap-3">
          <h3 class="text-sm font-medium">Current final</h3>
          ${currentFinal
            ? `<img src="${currentFinal.image.url}" alt="Current final" class="w-full rounded-xl2 border border-plum-border/40" />
               <p class="text-xs text-plum-muted whitespace-pre-line">${currentFinal.buildNotes}</p>`
            : '<p class="text-sm text-plum-muted">No final selected yet.</p>'}
        </div>
        <div class="flex flex-col gap-3">
          <h3 class="text-sm font-medium">New candidate</h3>
          <img src="${candidate.image.url}" alt="Candidate" class="w-full rounded-xl2 border border-plum-border/40" />
          <p class="text-xs text-plum-muted whitespace-pre-line">${candidate.buildNotes}</p>
        </div>
      </div>
      <div class="flex justify-end gap-3">
        <button type="button" data-action="keep" class="rounded-full border border-plum-border/60 px-4 py-2 text-sm text-plum-muted hover:bg-plum-surface">Keep current</button>
        <button type="button" data-action="replace" class="rounded-full bg-peach px-4 py-2 text-sm font-medium text-plum hover:bg-peach/90">Replace with candidate</button>
      </div>
    `;

    this.finalModalContent.querySelector('[data-action="keep"]').addEventListener('click', () => {
      this.state.finalCandidate = null;
      this.renderFinalCompareDialog();
    });

    this.finalModalContent.querySelector('[data-action="replace"]').addEventListener('click', () => {
      if (this.state.finalCandidate) {
        this.state.finalRender = {
          image: this.state.finalCandidate.image,
          buildNotes: this.state.finalCandidate.buildNotes,
          source: this.state.finalCandidate.source,
        };
        this.state.finalCandidate = null;
        void this.persistFinalRender();
        this.render();
      }
    });

    if (!this.finalModal.open) {
      this.finalModal.showModal();
    }
  }
  async importBasePhoto(file) {
    try {
      const normalized = await normalizeImageFile(file);
      const base64 = await blobToBase64(normalized.original);
      const dataUrl = await blobToDataUrl(normalized.original);
      const projectId = this.state.project?.id;
      if (projectId) {
        const originalRecord = await saveMedia(projectId, {
          kind: 'input',
          blob: normalized.original,
          mime: file.type || 'image/jpeg',
          width: normalized.width,
          height: normalized.height,
          bytes: normalized.original.size,
        });
        await saveMedia(projectId, {
          kind: 'thumb',
          relatedId: originalRecord.id,
          blob: normalized.thumb,
          mime: file.type || 'image/jpeg',
          width: normalized.width,
          height: normalized.height,
          bytes: normalized.thumb.size,
        });
        await appendEvent(projectId, {
          type: 'upload_image',
          payload: { mediaId: originalRecord.id, name: file.name },
        });
      }

      this.state.basePhoto = {
        id: randomId(),
        dataUrl,
        base64,
        width: normalized.width,
        height: normalized.height,
        mime: file.type || 'image/jpeg',
        fileName: file.name,
      };
      this.resetGeneratedState();
      this.render();
      await this.generateRoomBrief();
    } catch (error) {
      this.state.bannerError = error.message ?? 'Failed to import base photo.';
      this.render();
    }
  }

  async importReferences(files) {
    for (const file of files) {
      if (this.state.references.length >= MAX_REFERENCES) break;
      try {
        const normalized = await normalizeImageFile(file);
        const base64 = await blobToBase64(normalized.original);
        const dataUrl = await blobToDataUrl(normalized.original);
        const reference = {
          id: randomId(),
          dataUrl,
          base64,
          width: normalized.width,
          height: normalized.height,
          mime: file.type || 'image/jpeg',
          fileName: file.name,
        };
        this.state.references.push(reference);

        const projectId = this.state.project?.id;
        if (projectId) {
          await saveMedia(projectId, {
            kind: 'reference',
            blob: normalized.original,
            mime: reference.mime,
            width: reference.width,
            height: reference.height,
            bytes: normalized.original.size,
          });
          await appendEvent(projectId, {
            type: 'reference_added',
            payload: { name: file.name },
          });
        }
      } catch (error) {
        this.state.bannerError = error.message ?? 'Failed to import reference.';
      }
    }
    this.render();
  }

  reorderReferences(sourceId, targetId) {
    const sourceIndex = this.state.references.findIndex((ref) => ref.id === sourceId);
    const targetIndex = this.state.references.findIndex((ref) => ref.id === targetId);
    if (sourceIndex === -1 || targetIndex === -1) return;
    const [moved] = this.state.references.splice(sourceIndex, 1);
    this.state.references.splice(targetIndex, 0, moved);
    this.render();
  }

  shiftReference(referenceId, delta) {
    const index = this.state.references.findIndex((ref) => ref.id === referenceId);
    if (index === -1) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= this.state.references.length) return;
    const [moved] = this.state.references.splice(index, 1);
    this.state.references.splice(nextIndex, 0, moved);
    this.render();
  }

  removeReference(referenceId) {
    const index = this.state.references.findIndex((ref) => ref.id === referenceId);
    if (index === -1) return;
    this.state.references.splice(index, 1);
    this.render();
  }

  async generateRoomBrief() {
    if (!this.state.basePhoto) return;
    const requestId = randomId();
    this.state.roomBriefLoading = true;
    this.state.roomBriefError = null;
    this.state.roomBriefRequestId = requestId;
    this.render();

    try {
      const prompt = buildRoomBriefPrompt({ purpose: this.state.purpose });
      const parts = [
        { text: prompt },
        {
          inlineData: {
            mimeType: this.state.basePhoto.mime,
            data: this.state.basePhoto.base64,
          },
        },
      ];
      const response = await this.client.callFlash({ parts });
      const candidate = response.candidates?.[0];
      const textPart = candidate?.content?.parts?.find((part) => typeof part.text === 'string' && part.text.trim());
      const parsed = parseRoomBrief(textPart?.text ?? '');
      if (!parsed.paragraph || parsed.bullets.length === 0) {
        throw new Error('Room brief response missing content.');
      }

      if (this.state.roomBriefRequestId === requestId) {
        this.state.roomBrief = parsed;
        this.state.roomBriefError = null;
        const projectId = this.state.project?.id;
        if (projectId) {
          await saveArtifact(projectId, {
            kind: 'roomBrief',
            json: parsed,
          });
          await appendEvent(projectId, {
            type: 'room_brief_generated',
          });
        }
      }
    } catch (error) {
      if (error.code === 'missing-key') {
        this.settingsModal?.showModal();
      }
      if (this.state.roomBriefRequestId === requestId) {
        this.state.roomBriefError = error.message ?? 'Failed to generate room brief.';
      }
    } finally {
      if (this.state.roomBriefRequestId === requestId) {
        this.state.roomBriefLoading = false;
        this.render();
      }
    }
  }

  collectAllFavorites() {
    const favorites = [];
    for (const iteration of this.state.iterations) {
      for (const tile of iteration.tiles) {
        if (tile.favorite && tile.status === 'complete' && tile.image?.url) {
          favorites.push({
            round: iteration.round,
            tileIndex: tile.index,
            descriptor: tile.descriptor,
            note: tile.note,
            imageUrl: tile.image.url,
          });
        }
      }
    }
    return favorites;
  }

  countFavorites(iteration) {
    return iteration.tiles.filter((tile) => tile.favorite).length;
  }

  getFavoritesForNextRound() {
    if (this.state.iterations.length === 0) return [];
    const lastIteration = this.state.iterations[this.state.iterations.length - 1];
    return lastIteration.tiles
      .filter((tile) => tile.favorite && tile.status === 'complete')
      .map((tile) => ({ descriptor: tile.descriptor, note: tile.note }));
  }

  resetGeneratedState() {
    this.state.iterations = [];
    this.state.finalRender = null;
    this.state.finalCandidate = null;
    this.state.bannerError = null;
  }

  async startIteration() {
    if (!this.state.basePhoto || !this.state.roomBrief || this.state.generatingIteration) {
      return;
    }

    const favorites = this.getFavoritesForNextRound();
    if (this.state.iterations.length > 0 && favorites.length === 0) {
      this.state.bannerError = 'Select at least one favorite to continue.';
      this.render();
      return;
    }

    const deck = buildDiversityDeck(ITERATION_TILE_COUNT, this.state.iterations.length * 2);
    const iteration = {
      id: randomId(),
      round: this.state.iterations.length + 1,
      deck,
      tiles: deck.map((entry, index) => ({
        id: randomId(),
        index,
        axis: entry.axis,
        status: 'pending',
        descriptor: '',
        note: '',
        favorite: false,
        image: null,
        errorMessage: null,
      })),
      guidance: this.state.globalGuidance,
      contextFavorites: favorites,
      references: this.state.references.map((ref) => ({ base64: ref.base64, mime: ref.mime })),
    };

    this.state.iterations.push(iteration);
    this.state.generatingIteration = true;
    this.render();

    try {
      await runLimitedPool({
        count: iteration.tiles.length,
        limit: ITERATION_POOL_SIZE,
        worker: (index) => this.generateTile(iteration, iteration.tiles[index]),
      });
      const projectId = this.state.project?.id;
      if (projectId) {
        const success = iteration.tiles.filter((tile) => tile.status === 'complete').length;
        const failed = iteration.tiles.filter((tile) => tile.status === 'error').length;
        await appendEvent(projectId, {
          type: 'iteration_complete',
          payload: { round: iteration.round, success, failed },
        });
      }
    } finally {
      this.state.generatingIteration = false;
      this.render();
    }
  }

  async generateTile(iteration, tile) {
    tile.status = 'running';
    tile.errorMessage = null;
    this.render();

    try {
      const prompt = buildIterationPrompt({
        roomBrief: this.state.roomBrief,
        purpose: this.state.purpose,
        globalGuidance: iteration.guidance,
        favorites: iteration.contextFavorites,
        axis: tile.axis,
      });
      const parts = [
        { text: prompt },
        {
          inlineData: {
            mimeType: this.state.basePhoto.mime,
            data: this.state.basePhoto.base64,
          },
        },
        ...iteration.references.map((ref) => ({
          inlineData: {
            mimeType: ref.mime,
            data: ref.base64,
          },
        })),
      ];
      const response = await this.client.callFlashImage({ parts });
      const parsed = parseFlashImageResponse(response);
      let descriptor = parsed.text;
      if (!descriptor) {
        const repair = await this.client.callFlash({
          parts: [
            {
              text: buildDescriptorRepairPrompt({
                roomBrief: this.state.roomBrief,
                purpose: this.state.purpose,
                favorites: iteration.contextFavorites,
                globalGuidance: iteration.guidance,
                axis: tile.axis,
              }),
            },
          ],
        });
        const repairText = repair.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
        descriptor = repairText?.trim() ?? '';
      }

      const blob = base64ToBlob(parsed.image.data, parsed.image.mimeType);
      const dataUrl = await blobToDataUrl(blob);
      tile.image = {
        base64: parsed.image.data,
        url: dataUrl,
        mime: parsed.image.mimeType,
      };
      tile.descriptor = descriptor;
      tile.status = 'complete';

      const projectId = this.state.project?.id;
      if (projectId) {
        const renderRecord = await saveMedia(projectId, {
          kind: 'render',
          blob,
          mime: parsed.image.mimeType,
          bytes: blob.size,
        });
        await saveArtifact(projectId, {
          kind: 'descriptor',
          json: {
            tileId: tile.id,
            descriptor,
          },
        });
        await appendEvent(projectId, {
          type: 'tile_generated',
          payload: { iteration: iteration.round, tile: tile.index + 1, mediaId: renderRecord.id },
        });
      }
    } catch (error) {
      tile.status = 'error';
      tile.errorMessage = error.message ?? 'Generation failed.';
    } finally {
      this.render();
    }
  }

  async retryTile(iterationId, tileId) {
    if (this.state.generatingIteration) return;
    const iteration = this.state.iterations.find((item) => item.id === iterationId);
    const tile = iteration?.tiles.find((item) => item.id === tileId);
    if (!iteration || !tile) return;

    this.state.generatingIteration = true;
    this.render();
    try {
      await this.generateTile(iteration, tile);
    } finally {
      this.state.generatingIteration = false;
      this.render();
    }
  }

  toggleFavorite(iterationId, tileId) {
    const iteration = this.state.iterations.find((item) => item.id === iterationId);
    const tile = iteration?.tiles.find((item) => item.id === tileId);
    if (!tile || tile.status !== 'complete') return;
    tile.favorite = !tile.favorite;
    if (!tile.favorite) {
      tile.note = '';
    }
    this.render();
  }

  updateFavoriteNote(iterationId, tileId, value) {
    const iteration = this.state.iterations.find((item) => item.id === iterationId);
    const tile = iteration?.tiles.find((item) => item.id === tileId);
    if (!tile) return;
    tile.note = value;
  }
  async finalizeTile(iterationId, tileId) {
    if (this.state.finalizing) return;
    const iteration = this.state.iterations.find((item) => item.id === iterationId);
    const tile = iteration?.tiles.find((item) => item.id === tileId);
    if (!iteration || !tile || tile.status !== 'complete' || !tile.image) return;

    this.state.finalizing = true;
    this.render();

    try {
      const favorites = this.collectAllFavorites().map((entry) => ({ descriptor: entry.descriptor, note: entry.note }));
      const prompt = buildFinalizationPrompt({
        roomBrief: this.state.roomBrief,
        purpose: this.state.purpose,
        favorites,
      });
      const parts = [
        { text: prompt },
        {
          inlineData: {
            mimeType: this.state.basePhoto.mime,
            data: this.state.basePhoto.base64,
          },
        },
        {
          inlineData: {
            mimeType: tile.image.mime,
            data: tile.image.base64,
          },
        },
        ...this.state.references.map((ref) => ({
          inlineData: {
            mimeType: ref.mime,
            data: ref.base64,
          },
        })),
      ];
      const response = await this.client.callFlashImage({ parts });
      const parsed = parseFlashImageResponse(response);
      let buildNotes = parsed.text;
      if (!buildNotes) {
        const repair = await this.client.callFlash({
          parts: [
            { text: buildFinalizationRepairPrompt({ roomBrief: this.state.roomBrief, purpose: this.state.purpose, favorites }) },
          ],
        });
        buildNotes = repair.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text ?? '';
      }

      const blob = base64ToBlob(parsed.image.data, parsed.image.mimeType);
      const dataUrl = await blobToDataUrl(blob);
      this.state.finalCandidate = {
        image: {
          base64: parsed.image.data,
          url: dataUrl,
          mime: parsed.image.mimeType,
          blob,
        },
        buildNotes,
        source: { iterationId, tileId },
      };
      if (this.state.project?.id) {
        await appendEvent(this.state.project.id, {
          type: 'final_candidate_ready',
          payload: { iteration: iteration.round, tile: tile.index + 1 },
        });
      }
    } catch (error) {
      this.state.bannerError = error.message ?? 'Failed to finalize the render.';
    } finally {
      this.state.finalizing = false;
      this.renderFinalCompareDialog();
      this.render();
    }
  }

  async persistFinalRender() {
    if (!this.state.finalRender || !this.state.project?.id) return;
    const { image, buildNotes } = this.state.finalRender;
    await saveMedia(this.state.project.id, {
      kind: 'final',
      blob: image.blob,
      mime: image.mime,
      bytes: image.blob.size,
    });
    await saveArtifact(this.state.project.id, {
      kind: 'finalNotes',
      json: { buildNotes },
    });
    await appendEvent(this.state.project.id, {
      type: 'final_selected',
    });
  }

  performRestart() {
    this.state.iterations = [];
    this.state.finalRender = null;
    this.state.finalCandidate = null;
    this.state.bannerError = null;
    this.render();
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"]+/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return match;
    }
  });
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}
