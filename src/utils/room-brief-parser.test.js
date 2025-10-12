import { parseRoomBrief } from './room-brief-parser.js';

describe('parseRoomBrief', () => {
  it('splits paragraph and bullets from structured text', () => {
    const text = `The room enjoys tall ceilings and filtered daylight.\n- Keep the camera and envelope.\n- Maintain 90 cm main walkways.\n- Layer ambient, task, and accent lighting.`;
    const result = parseRoomBrief(text);

    expect(result.paragraph).toMatch(/tall ceilings/);
    expect(result.bullets).toHaveLength(3);
    expect(result.bullets[0]).toBe('Keep the camera and envelope.');
  });

  it('handles numbered bullets and limits to five entries', () => {
    const text = `Paragraph body.\n1. First bullet\n2. Second bullet\n3. Third bullet\n4. Fourth bullet\n5. Fifth bullet\n6. Sixth bullet`;
    const result = parseRoomBrief(text);

    expect(result.bullets).toHaveLength(5);
    expect(result.bullets[4]).toBe('Fifth bullet');
  });

  it('returns empty payload when text missing', () => {
    expect(parseRoomBrief('')).toEqual({ paragraph: '', bullets: [] });
  });

  it('throws when input is not a string', () => {
    expect(() => parseRoomBrief(null)).toThrow(TypeError);
  });
});

