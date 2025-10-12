import { diversityDeck } from './diversity.js';

describe('diversityDeck', () => {
  it('returns the twelve agreed diversity hints', () => {
    const deck = diversityDeck();
    expect(deck).toHaveLength(12);
    expect(new Set(deck).size).toBe(12);
    expect(deck[0]).toBe('slightly warmer palette; gentler contrast');
    expect(deck[deck.length - 1]).toBe(
      'bolder accents; stronger figure-ground definition'
    );
  });
});
