import { base64ToBlob, blobToBase64 } from './image.js';

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
