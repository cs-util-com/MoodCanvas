import { buildDiversityDeck, summarizeDeck, DIVERSITY_AXIS_DECK } from './diversity-deck.js';

describe('buildDiversityDeck', () => {
  it('returns 12 slots covering each axis once when count is 12', () => {
    const deck = buildDiversityDeck(12);
    expect(deck).toHaveLength(12);

    const summary = summarizeDeck(deck);
    for (const axis of DIVERSITY_AXIS_DECK) {
      expect(summary.get(axis.id)?.count).toBe(1);
    }
  });

  it('cycles the deck when requesting more than 12 entries', () => {
    const deck = buildDiversityDeck(18);
    expect(deck).toHaveLength(18);

    const summary = summarizeDeck(deck);
    const fullCycles = Math.floor(18 / DIVERSITY_AXIS_DECK.length);
    const remainder = 18 % DIVERSITY_AXIS_DECK.length;
    DIVERSITY_AXIS_DECK.forEach((axis, index) => {
      const expected = fullCycles + (index < remainder ? 1 : 0);
      expect(summary.get(axis.id)?.count).toBe(expected);
    });
  });

  it('supports offsets to rotate the deck', () => {
    const deck = buildDiversityDeck(3, 5);
    expect(deck[0].axis.id).toBe(DIVERSITY_AXIS_DECK[5].id);
    expect(deck[1].axis.id).toBe(DIVERSITY_AXIS_DECK[6].id);
    expect(deck[2].axis.id).toBe(DIVERSITY_AXIS_DECK[7].id);
  });

  it('returns an empty array when count is zero', () => {
    expect(buildDiversityDeck(0)).toEqual([]);
  });

  it('throws when count is negative', () => {
    expect(() => buildDiversityDeck(-1)).toThrow(TypeError);
  });
});

