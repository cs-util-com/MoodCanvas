import { diversityDeck } from './diversity.js';

describe('diversityDeck', () => {
  it('returns twelve unique guidance hints', () => {
    const deck = diversityDeck();
    expect(deck).toHaveLength(12);
    const unique = new Set(deck.map((item) => item.toLowerCase()));
    expect(unique.size).toBe(12);
  });
});
