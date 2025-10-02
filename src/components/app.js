/* istanbul ignore file */
import {
  readGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  onKeyChange,
} from '../utils/key-store.js';
import { GeminiClient } from '../utils/gemini-client.js';
import { normalizeImageFile, blobToBase64, blobToDataUrl } from '../utils/image.js';
import {
  ensureProject,
  getProject,
  saveMedia,
  saveArtifact,
  appendEvent,
} from '../utils/project-store.js';
import { SUPPORTED_ROOM_FUNCTIONS } from '../constants/analysis-schema.js';
import {
  buildAnalysisPrompt,
  buildABPrompts,
  buildHeroPrompts,
  buildMiniList,
} from '../utils/prompts.js';

const STORAGE_PROJECT_KEY = 'moodcanvas.currentProjectId';
const MAX_FAVORITES = 3;

export class MoodCanvasApp {
  constructor(root) {
    this.root = root;
    this.client = new GeminiClient();
    this.state = {
      loading: false,
      apiKey: '',
      project: null,
      photo: null,
      analysis: null,
      gallery: [],
      favorites: new Set(),
      abVariants: [],
      heroRenders: [],
      quickWins: null,
      miniList: null,
      palette: null,
      warning: null,
      error: null,
    };
    this.unsubscribeKey = null;
    this.controller = null;
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

  renderShell() {
    this.root.innerHTML = `
      <div class="min-h-full flex flex-col">
        <header class="border-b border-plum-border/40 bg-plum-surface">
          <div class="mx-auto w-full max-w-5xl px-6 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-peach uppercase tracking-[0.3em] text-xs font-semibold">MoodCanvas</p>
              <h1 class="text-2xl md:text-3xl font-semibold">Interior Design Assistant</h1>
              <p class="text-sm text-plum-muted max-w-xl">
                Upload a single empty-room photo, explore tailored styles, and collect actionable next steps without leaving your browser.
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
          <div class="mx-auto w-full max-w-5xl px-6 py-10 flex flex-col gap-6" id="timeline"></div>
        </main>
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
            <p>Bring your own key from <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" class="text-peach underline">Google AI Studio</a>. Keys are stored only in this browser.</p>
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

    this.settingsBtn.addEventListener('click', () => {
      if (this.settingsModal.open) return;
      this.keyInput.value = this.state.apiKey;
      this.settingsModal.showModal();
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
      this.render();
    });
  }

  render() {
    this.renderKeyStatus();
    this.renderTimeline();
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
    if (!this.state.apiKey) {
      this.timelineEl.appendChild(this.renderKeyBanner());
    }
    if (this.state.photo) {
      this.timelineEl.appendChild(this.renderPhotoCard());
      this.timelineEl.appendChild(this.renderAnalysisCard());
    }
    if (this.state.analysis) {
      this.timelineEl.appendChild(this.renderAnalysisResults());
      this.timelineEl.appendChild(this.renderGalleryCard());
    }
    if (this.state.abVariants.length > 0) {
      this.timelineEl.appendChild(this.renderABCard());
    }
    if (this.state.heroRenders.length > 0) {
      this.timelineEl.appendChild(this.renderHeroCard());
    }
    if (this.state.quickWins) {
      this.timelineEl.appendChild(this.renderInsightsCard());
    }
  }

  renderUploadCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 shadow-inner shadow-black/10 flex flex-col gap-4';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">1. Upload your room photo</h2>
          <p class="text-sm text-plum-muted">Use a single JPG or PNG. MoodCanvas stores the image locally and resizes a private thumbnail.</p>
        </div>
        ${this.state.photo ? `<button class="text-xs text-peach underline" id="replacePhoto">Replace</button>` : ''}
      </div>
      <label class="relative flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl2 border border-dashed border-peach/60 bg-plum-surface text-center text-plum-muted transition hover:border-peach hover:text-peach">
        <input type="file" accept="image/jpeg,image/png" capture="environment" class="absolute inset-0 opacity-0" ${this.state.loading ? 'disabled' : ''} />
        <span class="text-sm">Tap to upload</span>
        <span class="text-xs">Long edge ≤ 2048px • Metadata preserved</span>
      </label>
    `;

    const input = card.querySelector('input[type="file"]');
    input.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) {
        this.importPhoto(file).catch((error) => this.reportError(error));
      }
    });

    const replaceBtn = card.querySelector('#replacePhoto');
    if (replaceBtn) {
      replaceBtn.addEventListener('click', () => {
        this.resetAfter('photo');
      });
    }

    return card;
  }

  renderKeyBanner() {
    const banner = document.createElement('section');
    banner.className = 'rounded-xl2 border border-raspberry/50 bg-raspberry/15 p-5 text-sm text-raspberry flex flex-col gap-3';
    banner.innerHTML = `
      <div class="font-medium">Bring your own Google Gemini key</div>
      <p class="text-raspberry/90">Get a free API key from <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" class="underline">Google AI Studio</a>. The key is stored only in your browser.</p>
      <button class="self-start rounded-full border border-raspberry/60 px-3 py-1 text-xs" id="openSettings">Open settings</button>
    `;
    banner.querySelector('#openSettings').addEventListener('click', () => this.settingsModal.showModal());
    return banner;
  }

  renderPhotoCard() {
    const { photo } = this.state;
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    card.innerHTML = `
      <h2 class="text-lg font-semibold">2. Confirm scope & intended function</h2>
      <div class="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div class="rounded-xl2 overflow-hidden border border-plum-border/40">
          <img src="${photo.thumbUrl}" alt="Uploaded room" class="block w-full h-full object-cover" loading="lazy" />
        </div>
        <form class="flex flex-col gap-3" id="scopeForm">
          <label class="flex flex-col gap-1 text-sm">
            <span>Intended use</span>
            <select name="function" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70">
              ${SUPPORTED_ROOM_FUNCTIONS.map((fn) => `<option value="${fn}">${fn}</option>`).join('')}
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>Intervention scope (1–4)</span>
            <input name="scope" type="number" min="1" max="4" value="2" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span>Notes for the designer</span>
            <textarea name="notes" rows="3" class="rounded-xl2 border border-plum-border/60 bg-plum-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-peach/70" placeholder="Optional context"></textarea>
          </label>
          <button class="mt-2 self-start rounded-full bg-peach/90 px-5 py-2 text-sm font-medium text-plum hover:bg-peach" type="submit" ${this.state.loading ? 'disabled' : ''}>Run analysis</button>
          ${this.state.warning ? `<p class="text-xs text-peach/80">${this.state.warning}</p>` : ''}
        </form>
      </div>
    `;

    const form = card.querySelector('#scopeForm');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!this.state.apiKey) {
        this.settingsModal.showModal();
        return;
      }
      const data = new FormData(form);
      this.runAnalysis({
        intendedUse: data.get('function'),
        scope: Number.parseInt(data.get('scope'), 10) || 1,
        notes: data.get('notes')?.toString() ?? '',
      }).catch((error) => this.reportError(error));
    });

    return card;
  }

  renderAnalysisCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-4';
    card.innerHTML = `
      <h2 class="text-lg font-semibold">3. Analysis progress</h2>
      <p class="text-sm text-plum-muted">Gemini evaluates the room envelope, palette, and style fit. Strict JSON schema keeps the response predictable.</p>
      ${this.state.loading && !this.state.analysis ? '<div class="animate-pulse text-plum-muted text-sm">Analyzing… (45s timeout)</div>' : ''}
      ${this.state.error && !this.state.analysis ? `<p class="text-sm text-raspberry">${this.state.error}</p>` : ''}
    `;
    return card;
  }

  renderAnalysisResults() {
    const { analysis } = this.state;
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-6';
    card.innerHTML = `
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-semibold">4. Room intelligence</h2>
        <p class="text-sm text-plum-muted">Highlights from the analysis including inspiration pulse, palette, and quick wins.</p>
      </div>
      <div class="grid gap-6 md:grid-cols-2">
        <section class="rounded-xl2 border border-plum-border/30 bg-plum-surface p-4 flex flex-col gap-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">Inspiration pulse</h3>
          <div class="flex flex-wrap gap-2">
            ${analysis.usage_candidates.slice(0, 3).map((item) => `<span class="rounded-full bg-plum-surface-2 px-3 py-1 text-xs">${item.function} · ${(item.confidence * 100).toFixed(0)}%</span>`).join('')}
          </div>
        </section>
        <section class="rounded-xl2 border border-plum-border/30 bg-plum-surface p-4 flex flex-col gap-3">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted">60-30-10 palette</h3>
          <div class="grid grid-cols-3 gap-3">
            ${['primary', 'secondary', 'accent'].map((key) => this.renderPaletteSwatch(key, analysis.palette_60_30_10[key])).join('')}
          </div>
        </section>
      </div>
      <section class="rounded-xl2 border border-plum-border/30 bg-plum-surface p-4">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted mb-3">Top 5 quick wins</h3>
        <ol class="space-y-3 text-sm text-plum-muted">
          ${analysis.quick_wins.map((win) => `<li><span class="text-plum-text font-medium">${win.title}</span> — ${win.description} (<span class="text-peach">Impact:</span> ${win.impact})</li>`).join('')}
        </ol>
      </section>
    `;
    return card;
  }

  renderPaletteSwatch(label, info) {
    return `
      <div class="flex flex-col gap-2 text-xs text-center">
        <div class="rounded-xl2 border border-plum-border/40 overflow-hidden">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="block w-full aspect-[4/3]" aria-hidden="true" focusable="false">
            <rect width="100" height="100" fill="${info.hex}" />
          </svg>
        </div>
        <div class="flex flex-col">
          <span class="font-semibold text-plum-text">${label.toUpperCase()}</span>
          <span>${info.name}</span>
          <span>${info.hex}</span>
        </div>
      </div>
    `;
  }

  renderGalleryCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-5';
    const gallery = this.state.gallery;
    card.innerHTML = `
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-semibold">5. 10-style gallery</h2>
        <p class="text-sm text-plum-muted">Generate renders in parallel (pool=5). Tap to mark favorites for A/B exploration.</p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" id="galleryGrid"></div>
      <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button id="generateGallery" class="rounded-full bg-peach/90 px-4 py-2 text-plum font-medium hover:bg-peach" ${this.state.loading ? 'disabled' : ''}>Generate renders</button>
        <div class="text-xs text-plum-muted">Favorites: ${this.state.favorites.size}/${MAX_FAVORITES}</div>
      </div>
    `;

    const grid = card.querySelector('#galleryGrid');
    const prompts = this.state.analysis.render_gallery;
    const combined = prompts.map((prompt) => ({ prompt, render: gallery.find((item) => item.style === prompt.style) ?? null }));
    combined
      .sort((a, b) => this.findStyleScore(b.prompt.style) - this.findStyleScore(a.prompt.style))
      .forEach(({ prompt, render }) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = `group relative flex flex-col overflow-hidden rounded-xl2 border ${this.state.favorites.has(prompt.style) ? 'border-peach/80' : 'border-plum-border/30'} bg-plum-surface text-left transition`;
        tile.dataset.style = prompt.style;
        tile.innerHTML = `
          <div class="relative aspect-[3/2] w-full overflow-hidden bg-plum-surface-2 flex items-center justify-center text-xs text-plum-muted">
            ${render ? `<img src="${render.thumbUrl}" alt="${prompt.style} render" class="h-full w-full object-cover" loading="lazy" />` : 'Pending'}
            <span class="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] uppercase tracking-wide">${prompt.style}</span>
          </div>
          <div class="flex flex-col gap-1 p-3 text-xs">
            <p class="text-plum-text font-medium">${prompt.focus}</p>
            <p class="line-clamp-3 text-plum-muted">${prompt.guidance}</p>
          </div>
        `;
        tile.addEventListener('click', () => this.toggleFavorite(prompt.style));
        grid.appendChild(tile);
      });

    card.querySelector('#generateGallery').addEventListener('click', () => {
      if (!this.state.apiKey) {
        this.settingsModal.showModal();
        return;
      }
      this.generateGalleryRenders().catch((error) => this.reportError(error));
    });

    if (this.state.favorites.size > 0) {
      const confirm = document.createElement('div');
      confirm.className = 'flex flex-wrap items-center justify-between gap-3 rounded-xl2 border border-plum-border/40 bg-plum-surface p-4 text-sm';
      confirm.innerHTML = `
        <div>Generate A/B mini-variants for ${this.state.favorites.size} favorite styles.</div>
        <button class="rounded-full bg-coral/90 px-4 py-2 text-plum font-medium hover:bg-coral" ${this.state.loading ? 'disabled' : ''}>Launch A/B (${this.state.favorites.size * 2} images)</button>
      `;
      confirm.querySelector('button').addEventListener('click', () => this.generateABVariants());
      card.appendChild(confirm);
    }

    return card;
  }

  renderABCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-5';
    card.innerHTML = `
      <div>
        <h2 class="text-lg font-semibold">6. A/B mini-variants</h2>
        <p class="text-sm text-plum-muted">Smart Mixed axes provide controlled variation for each favorite style.</p>
      </div>
      <div class="grid gap-4 md:grid-cols-3" id="abGrid"></div>
      <button class="self-end rounded-full bg-peach/90 px-4 py-2 text-plum font-medium hover:bg-peach" ${this.state.loading ? 'disabled' : ''} id="generateHeroes">Generate 3 hero renders</button>
    `;

    const grid = card.querySelector('#abGrid');
    this.state.abVariants.forEach((variant) => {
      const tile = document.createElement('article');
      tile.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface overflow-hidden flex flex-col';
      tile.innerHTML = `
        <div class="relative aspect-[3/2] bg-plum-surface-2">
          ${variant.thumbUrl ? `<img src="${variant.thumbUrl}" alt="${variant.style} variant" class="h-full w-full object-cover" loading="lazy" />` : '<div class="flex h-full items-center justify-center text-xs text-plum-muted">Pending</div>'}
        </div>
        <div class="p-4 text-xs">
          <div class="font-semibold text-plum-text">${variant.style} · ${variant.variant}</div>
          <div class="text-plum-muted">${variant.focus}</div>
        </div>
      `;
      grid.appendChild(tile);
    });

    card.querySelector('#generateHeroes').addEventListener('click', () => this.generateHeroRenders());
    return card;
  }

  renderHeroCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-5';
    card.innerHTML = `
      <div>
        <h2 class="text-lg font-semibold">7. Hero renders</h2>
        <p class="text-sm text-plum-muted">Three flagship Smart Mixed renders at 1536×1024. Tap to open full size in a new tab.</p>
      </div>
      <div class="grid gap-4 lg:grid-cols-3" id="heroGrid"></div>
    `;

    const grid = card.querySelector('#heroGrid');
    this.state.heroRenders.forEach((render) => {
      const tile = document.createElement('a');
      tile.href = render.fullUrl;
      tile.target = '_blank';
      tile.rel = 'noopener';
      tile.className = 'group relative block overflow-hidden rounded-xl2 border border-plum-border/40 bg-plum-surface';
      tile.innerHTML = `
        <img src="${render.thumbUrl}" alt="Hero render" class="h-full w-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
        <span class="absolute bottom-3 right-3 rounded-full bg-black/50 px-3 py-1 text-[10px] uppercase tracking-wide">${render.variant}</span>
      `;
      grid.appendChild(tile);
    });

    return card;
  }

  renderInsightsCard() {
    const card = document.createElement('section');
    card.className = 'rounded-xl2 border border-plum-border/40 bg-plum-surface-2 p-6 flex flex-col gap-5';
    const quickWins = this.state.quickWins;
    const list = this.state.miniList ?? [];
    card.innerHTML = `
      <div>
        <h2 class="text-lg font-semibold">8. Quick wins & mini shopping list</h2>
        <p class="text-sm text-plum-muted">Actionable instructions with neutral specifications only.</p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <section class="rounded-xl2 border border-plum-border/30 bg-plum-surface p-4">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted mb-3">Top 5 quick wins</h3>
          <ol class="space-y-3 text-sm text-plum-muted">
            ${quickWins.map((item) => `<li><span class="text-plum-text font-medium">${item.title}</span> — ${item.description}</li>`).join('')}
          </ol>
        </section>
        <section class="rounded-xl2 border border-plum-border/30 bg-plum-surface p-4">
          <h3 class="text-sm font-semibold uppercase tracking-wide text-plum-muted mb-3">Mini shopping list</h3>
          <ul class="space-y-3 text-sm text-plum-muted">
            ${list.map((item) => `<li><span class="text-plum-text font-medium">${item.name}</span> · ${item.spec}</li>`).join('')}
          </ul>
        </section>
      </div>
    `;
    return card;
  }

  async importPhoto(file) {
    this.state.loading = true;
    this.render();
    const normalized = await normalizeImageFile(file);
    const base64 = await blobToBase64(normalized.original);
    const thumbUrl = URL.createObjectURL(normalized.thumb);
    const fullUrl = URL.createObjectURL(normalized.original);
    const projectId = this.state.project.id;

    const originalRecord = await saveMedia(projectId, {
      kind: 'input',
      blob: normalized.original,
      mime: file.type,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.original.size,
    });

    await saveMedia(projectId, {
      kind: 'thumb',
      relatedId: originalRecord.id,
      blob: normalized.thumb,
      mime: file.type,
      width: normalized.width,
      height: normalized.height,
      bytes: normalized.thumb.size,
    });

    await appendEvent(projectId, {
      type: 'upload_image',
      payload: { mediaId: originalRecord.id, name: file.name },
    });

    this.state.photo = {
      base64,
      thumbUrl,
      fullUrl,
      width: normalized.width,
      height: normalized.height,
      fileName: file.name,
    };
    this.resetAfter('analysis');
    this.state.loading = false;
    this.render();
  }

  resetAfter(step) {
    if (step === 'photo') {
      this.state.photo = null;
    }
    this.state.analysis = null;
    this.state.gallery = [];
    this.state.favorites = new Set();
    this.state.abVariants = [];
    this.state.heroRenders = [];
    this.state.quickWins = null;
    this.state.miniList = null;
    this.state.palette = null;
    this.render();
  }

  async runAnalysis({ intendedUse, scope, notes }) {
    this.state.loading = true;
    this.state.error = null;
    this.render();
    try {
      const prompt = buildAnalysisPrompt({ intendedUse, scope, notes });
      const controller = new AbortController();
      this.controller = controller;
      const data = await this.client.analyzeRoom({
        imageBase64: this.state.photo.base64,
        prompt,
        signal: controller.signal,
      });
      await saveArtifact(this.state.project.id, {
        kind: 'analysis',
        json: data,
      });
      await appendEvent(this.state.project.id, {
        type: 'analysis_done',
        payload: { intendedUse, scope },
      });
      this.state.analysis = data;
      this.state.quickWins = data.quick_wins;
      this.state.palette = data.palette_60_30_10;
      this.state.warning = evaluateScaleConfidence(data.constraints?.scale_guesses);
    } catch (error) {
      if (error.code === 'missing-key') {
        this.settingsModal.showModal();
      }
      this.reportError(error);
    } finally {
      this.state.loading = false;
      this.render();
    }
  }

  async generateGalleryRenders() {
    this.state.loading = true;
    this.render();
    const analysis = this.state.analysis;
    const poolSize = 5;
    const tasks = analysis.render_gallery.map((item) => async () => {
      const assets = await this.renderAndStore({
        prompt: item.prompt,
        relatedId: item.style,
      });
      const entry = {
        style: item.style,
        prompt: item.prompt,
        focus: item.focus,
        thumbUrl: assets.thumbUrl,
        fullUrl: assets.fullUrl,
      };
      return entry;
    });

    const results = [];
    const queue = tasks.slice();
    const workers = Array.from({ length: poolSize }, async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        try {
          const result = await job();
          results.push(result);
          this.state.gallery = [...results];
          this.render();
        } catch (error) {
          console.error('Render failed', error);
        }
      }
    });

    await Promise.all(workers);
    await appendEvent(this.state.project.id, {
      type: 'gallery_generated',
      payload: { count: results.length },
    });
    this.state.loading = false;
    this.render();
  }

  async generateABVariants() {
    if (this.state.favorites.size === 0) return;
    this.state.loading = true;
    this.render();
    const variants = [];
    const axes = this.state.analysis.smart_mixed_axes;
    for (const style of this.state.favorites) {
      const basePrompt = this.state.analysis.render_gallery.find((item) => item.style === style);
      if (!basePrompt) continue;
      const prompts = buildABPrompts(basePrompt.prompt, axes);
      for (let index = 0; index < prompts.length; index += 1) {
        try {
          const assets = await this.renderAndStore({
            prompt: prompts[index],
            relatedId: `${style}-${index}`,
          });
          variants.push({
            style,
            variant: index === 0 ? axes.axisA.label : axes.axisB.label,
            focus: index === 0 ? axes.axisA.description : axes.axisB.description,
            thumbUrl: assets.thumbUrl,
            fullUrl: assets.fullUrl,
          });
        } catch (error) {
          console.error('Variant render failed', error);
        }
      }
    }
    this.state.abVariants = variants;
    await appendEvent(this.state.project.id, {
      type: 'ab_generated',
      payload: { count: variants.length },
    });
    this.state.loading = false;
    this.render();
  }

  async generateHeroRenders() {
    this.state.loading = true;
    this.render();
    const axes = this.state.analysis.smart_mixed_axes;
    const basePrompt = this.state.analysis.render_gallery[0].prompt;
    const prompts = buildHeroPrompts(basePrompt, axes);
    const results = [];
    for (let index = 0; index < prompts.length; index += 1) {
      try {
        const assets = await this.renderAndStore({
          prompt: prompts[index],
          relatedId: `hero-${index}`,
        });
        results.push({
          variant: index === 0 ? 'Axis A' : index === 1 ? 'Axis B' : 'Blend',
          thumbUrl: assets.thumbUrl,
          fullUrl: assets.fullUrl,
        });
      } catch (error) {
        console.error('Hero render failed', error);
      }
    }
    this.state.heroRenders = results;
    this.state.quickWins = this.state.analysis.quick_wins;
    this.state.miniList = buildMiniList(this.state.analysis);
    await appendEvent(this.state.project.id, {
      type: 'hero_generated',
      payload: { count: results.length },
    });
    this.state.loading = false;
    this.render();
  }

  toggleFavorite(style) {
    if (this.state.favorites.has(style)) {
      this.state.favorites.delete(style);
    } else {
      if (this.state.favorites.size >= MAX_FAVORITES) {
        return;
      }
      this.state.favorites.add(style);
    }
    this.render();
  }

  async persistRenderAssets({ blob, thumb, relatedId }) {
    const renderRecord = await saveMedia(this.state.project.id, {
      kind: 'render',
      relatedId,
      blob,
      mime: blob.type,
      bytes: blob.size,
    });
    await saveMedia(this.state.project.id, {
      kind: 'thumb',
      relatedId: renderRecord.id,
      blob: thumb,
      mime: 'image/jpeg',
      bytes: thumb.size,
    });
    return renderRecord;
  }

  async renderAndStore({ prompt, relatedId }) {
    const [result] = await this.client.generateRenders({
      prompt,
      imageBase64: this.state.photo.base64,
    });
    const blob = await fetch(`data:${result.mimeType};base64,${result.data}`).then((res) => res.blob());
    const thumb = await createThumb(blob);
    await this.persistRenderAssets({ blob, thumb, relatedId });
    return {
      fullUrl: URL.createObjectURL(blob),
      thumbUrl: URL.createObjectURL(thumb),
    };
  }

  findStyleScore(style) {
    return (
      this.state.analysis?.styles_top10.find((item) => item.style === style)?.score ?? 0
    );
  }

  reportError(error) {
    console.error(error);
    this.state.error = error.message ?? 'Unexpected error';
    this.state.loading = false;
    this.render();
  }
}

async function createThumb(blob) {
  const canvas = document.createElement('canvas');
  const img = document.createElement('img');
  img.src = await blobToDataUrl(blob);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  const scale = Math.min(384 / img.naturalWidth, 384 / img.naturalHeight, 1);
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Unable to create thumbnail'));
      }
    }, 'image/jpeg', 0.85);
  });
}

function evaluateScaleConfidence(guesses) {
  if (!guesses) return null;
  const confidences = [guesses.width_m, guesses.depth_m, guesses.height_m]
    .map((item) => item?.confidence)
    .filter((value) => typeof value === 'number');
  if (confidences.length === 0) return null;
  const min = Math.min(...confidences);
  if (Number.isFinite(min) && min < 0.4) {
    return 'Scale confidence is low; measurements may need manual verification.';
  }
  return null;
}

