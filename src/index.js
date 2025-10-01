/* istanbul ignore file */
import { MoodCanvasApp } from './components/app.js';

async function main() {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('Root container #app missing');
  }
  const app = new MoodCanvasApp(root);
  await app.init();
  window.moodCanvas = app;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    main().catch((error) => console.error(error));
  });
} else {
  main().catch((error) => console.error(error));
}
