import { base64ToBlob, blobToBase64, normalizeImageFile } from './image.js';

describe('base64ToBlob', () => {
  it('converts base64 strings into blobs with the expected contents', async () => {
    const content = 'hello world';
    const base64 = Buffer.from(content, 'utf8').toString('base64');
    const blob = base64ToBlob(base64, 'text/plain');

    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(content.length);
    const roundTrip = await blobToBase64(blob);
    expect(roundTrip).toBe(base64);
    expect(Buffer.from(roundTrip, 'base64').toString('utf8')).toBe(content);
  });

  it('returns an empty blob when given an empty base64 string', () => {
    const blob = base64ToBlob('', 'image/png');

    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(0);
  });
});

describe('normalizeImageFile', () => {
  const originalCreateImageBitmap = global.createImageBitmap;
  const originalCreateElement = document.createElement.bind(document);

  let capturedDraws;

  beforeEach(() => {
    capturedDraws = [];
    global.createImageBitmap = jest.fn(async () => ({ width: 4096, height: 2048 }));
    document.createElement = jest.fn((tag) => {
      if (tag !== 'canvas') {
        return originalCreateElement(tag);
      }
      return createMockCanvas(capturedDraws);
    });
  });

  afterEach(() => {
    global.createImageBitmap = originalCreateImageBitmap;
    document.createElement = originalCreateElement;
  });

  it('caps the longest edge at 2048px and produces a 512px thumb', async () => {
    const file = new Blob(['dummy'], { type: 'image/jpeg' });
    const result = await normalizeImageFile(file);

    expect(result.width).toBe(2048);
    expect(result.height).toBe(1024);
    expect(result.resized).toBe(true);
    expect(result.original).toBeInstanceOf(Blob);
    expect(result.thumb).toBeInstanceOf(Blob);

    const [originalDraw, thumbDraw] = capturedDraws;
    expect(originalDraw).toEqual({ width: 2048, height: 1024 });
    expect(thumbDraw).toEqual({ width: 512, height: 256 });
  });

  it('keeps native size when already below threshold', async () => {
    global.createImageBitmap.mockResolvedValueOnce({ width: 1600, height: 900 });

    const file = new Blob(['dummy'], { type: 'image/png' });
    const result = await normalizeImageFile(file);

    expect(result.width).toBe(1600);
    expect(result.height).toBe(900);
    expect(result.resized).toBe(false);
  });
});

function createMockCanvas(draws) {
  return {
    width: 0,
    height: 0,
    getContext: jest.fn(() => ({
      drawImage: jest.fn((_, __, ___, width, height) => {
        draws.push({ width, height });
      }),
    })),
    toBlob(callback, mime) {
      callback(new Blob(['canvas'], { type: mime }));
    },
  };
}
