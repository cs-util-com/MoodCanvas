/* istanbul ignore file */

const STORAGE_KEY = 'moodcanvas.gemini.key';

const listeners = new Set();

export function readGeminiKey(storage = window.localStorage) {
  try {
    return storage.getItem(STORAGE_KEY) ?? '';
  } catch (error) {
    console.warn('Unable to read Gemini key from storage', error);
    return '';
  }
}

export function saveGeminiKey(key, storage = window.localStorage) {
  if (typeof key !== 'string') {
    throw new TypeError('Expected key to be a string');
  }

  try {
    if (!key.trim()) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, key.trim());
    }
    emit();
  } catch (error) {
    console.warn('Unable to persist Gemini key', error);
  }
}

export function clearGeminiKey(storage = window.localStorage) {
  try {
    storage.removeItem(STORAGE_KEY);
    emit();
  } catch (error) {
    console.warn('Unable to clear Gemini key', error);
  }
}

export function onKeyChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error('Key listener failed', error);
    }
  }
}
