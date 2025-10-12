import { MoodCanvasApp } from './app.js';

describe('MoodCanvasApp layout scaffolding', () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app-root"></div>';
    root = document.getElementById('app-root');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
    // Clean up any stray modal/backdrop nodes created during tests.
    document
      .querySelectorAll('#final-backdrop, #final-modal')
      .forEach((node) => node.remove());
  });

  test('start button sits after the silent room brief card', () => {
    const app = new MoodCanvasApp(root);
    app.renderShell();
    app.state.main = { id: 'main-photo' };
    app.state.roomBrief = { paragraph: 'Sample brief', bullets: ['alpha'] };
    app.renderTimeline();

    const sections = Array.from(root.querySelectorAll('#timeline > section'));
    const briefIndex = sections.findIndex((section) => {
      const heading = section.querySelector('h2');
      return heading?.textContent?.includes('Silent room brief');
    });
    const startIndex = sections.findIndex((section) =>
      section.querySelector('#startRoundBtn')
    );

    expect(briefIndex).toBeGreaterThan(-1);
    expect(startIndex).toBe(briefIndex + 1);

    app.destroy();
  });

  test('final comparison modal is created lazily', () => {
    const app = new MoodCanvasApp(root);
    app.renderShell();

    expect(document.querySelector('#final-modal')).toBeNull();
    expect(document.querySelector('#final-backdrop')).toBeNull();

    app.state.final = { imageUrl: 'current.jpg', notes: 'Keep' };
    app.state.candidate = { imageUrl: 'candidate.jpg', notes: 'Swap' };
    app.showFinalModal();

    expect(document.querySelector('#final-modal')).not.toBeNull();
    expect(document.querySelector('#final-backdrop')).not.toBeNull();

    app.closeFinalModal();
    app.destroy();
  });

  test('generate bar toggles the hidden attribute with selection state', () => {
    const app = new MoodCanvasApp(root);
    app.renderShell();

    app.state.rounds = [];
    app.state.selectedForNext.clear();
    app.renderGenerateBar();

    expect(app.generateBar.hasAttribute('hidden')).toBe(true);

    app.state.rounds.push({ id: 'round-1', tiles: [] });
    app.state.selectedForNext.add('tile-1');
    app.renderGenerateBar();

    expect(app.generateBar.hasAttribute('hidden')).toBe(false);

    app.destroy();
  });
});
