import { ANALYSIS_SCHEMA } from './analysis-schema.js';

const FORBIDDEN_KEYS = new Set(['$schema', '$id', 'additionalProperties', 'anyOf']);

function collectForbiddenKeys(node, path = []) {
  const hits = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      hits.push(...collectForbiddenKeys(item, path.concat(index)));
    });
    return hits;
  }
  if (node && typeof node === 'object') {
    Object.entries(node).forEach(([key, value]) => {
      if (FORBIDDEN_KEYS.has(key)) {
        hits.push({ path: path.concat(key).join('.') });
      }
      hits.push(...collectForbiddenKeys(value, path.concat(key)));
    });
  }
  return hits;
}

describe('ANALYSIS_SCHEMA', () => {
  it('omits unsupported schema keywords for Gemini structured output', () => {
    const forbidden = collectForbiddenKeys(ANALYSIS_SCHEMA);
    expect(forbidden).toEqual([]);
  });

  it('allows nullable scale guesses while constraining numeric range', () => {
    const scaleGuesses = ANALYSIS_SCHEMA.properties.constraints.properties.scale_guesses;
    const sampleAxis = scaleGuesses.properties.width_m;
    expect(sampleAxis.properties.value.nullable).toBe(true);
    expect(sampleAxis.properties.value.minimum).toBe(0);
  });
});
