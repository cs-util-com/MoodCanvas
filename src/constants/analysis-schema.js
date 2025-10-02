/* istanbul ignore file */

export const SUPPORTED_ROOM_FUNCTIONS = [
  'Bedroom',
  'Home-Office',
  'Kids Room',
  'Guest Room',
  'Living Room',
  'Dining Room',
  'Hobby/Studio',
  'Fitness/Yoga',
  'Library/Reading',
  'Music/Recording',
  'Walk-in Closet',
  'Storage/Utility',
  'Other',
];

export const SUPPORTED_STYLES = [
  'Scandi',
  'Japandi',
  'Modern Minimal',
  'Contemporary Cozy',
  'Mid-Century',
  'Industrial Soft',
  'Boho',
  'Rustic',
  'Mediterranean',
  'Art-Deco',
];

export const ANALYSIS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://moodcanvas.app/schemas/analysis.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'usage_candidates',
    'photo_findings',
    'palette_60_30_10',
    'constraints',
    'quick_wins',
    'styles_top10',
    'smart_mixed_axes',
    'negative_prompts',
    'safety_checks',
    'render_gallery',
  ],
  properties: {
    usage_candidates: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['function', 'confidence', 'why'],
        properties: {
          function: {
            type: 'string',
            enum: SUPPORTED_ROOM_FUNCTIONS,
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          why: { type: 'string', minLength: 1 },
        },
      },
    },
    photo_findings: {
      type: 'object',
      additionalProperties: false,
      required: ['envelope', 'lighting', 'architectural_features', 'warnings'],
      properties: {
        envelope: { type: 'string' },
        lighting: { type: 'string' },
        architectural_features: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    palette_60_30_10: {
      type: 'object',
      additionalProperties: false,
      required: ['primary', 'secondary', 'accent'],
      properties: {
        primary: paletteColorSchema(),
        secondary: paletteColorSchema(),
        accent: paletteColorSchema(),
      },
    },
    constraints: {
      type: 'object',
      additionalProperties: false,
      required: ['scale_guesses', 'limitations', 'notes'],
      properties: {
        scale_guesses: {
          type: 'object',
          additionalProperties: false,
          required: ['width_m', 'depth_m', 'height_m'],
          properties: {
            width_m: scaleGuessSchema(),
            depth_m: scaleGuessSchema(),
            height_m: scaleGuessSchema(),
          },
        },
        limitations: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    },
    quick_wins: {
      type: 'array',
      minItems: 5,
      maxItems: 5,
      items: quickWinSchema(),
    },
    styles_top10: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      items: styleScoreSchema(),
    },
    smart_mixed_axes: {
      type: 'object',
      additionalProperties: false,
      required: ['axisA', 'axisB', 'summary'],
      properties: {
        axisA: smartAxisSchema(),
        axisB: smartAxisSchema(),
        summary: { type: 'string' },
      },
    },
    negative_prompts: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
    safety_checks: {
      type: 'object',
      additionalProperties: false,
      required: ['nsfw', 'copyright', 'architectural_integrity'],
      properties: {
        nsfw: safetyFlagSchema(),
        copyright: safetyFlagSchema(),
        architectural_integrity: safetyFlagSchema(),
      },
    },
    render_gallery: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      items: renderPromptSchema(),
    },
  },
};

function paletteColorSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'hex', 'finish', 'usage'],
    properties: {
      name: { type: 'string' },
      hex: {
        type: 'string',
        pattern: '^#([A-Fa-f0-9]{6})$',
      },
      finish: { type: 'string' },
      usage: { type: 'string' },
    },
  };
}

function scaleGuessSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['value', 'confidence'],
    properties: {
      value: {
        anyOf: [
          { type: 'number', minimum: 0 },
          { type: 'null' },
        ],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
  };
}

function quickWinSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description', 'effort', 'impact'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      effort: { type: 'string' },
      impact: { type: 'string' },
    },
  };
}

function styleScoreSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['style', 'score', 'why'],
    properties: {
      style: { type: 'string', enum: SUPPORTED_STYLES },
      score: { type: 'number', minimum: 0, maximum: 1 },
      why: { type: 'string' },
    },
  };
}

function smartAxisSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'description', 'spectrum'],
    properties: {
      label: { type: 'string' },
      description: { type: 'string' },
      spectrum: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['position', 'descriptor'],
          properties: {
            position: { type: 'number', minimum: 0, maximum: 1 },
            descriptor: { type: 'string' },
          },
        },
      },
    },
  };
}

function safetyFlagSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'notes'],
    properties: {
      status: { type: 'string', enum: ['ok', 'warn', 'block'] },
      notes: { type: 'string' },
    },
  };
}

function renderPromptSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['style', 'prompt', 'focus', 'guidance'],
    properties: {
      style: { type: 'string', enum: SUPPORTED_STYLES },
      prompt: { type: 'string' },
      focus: { type: 'string' },
      guidance: { type: 'string' },
    },
  };
}
