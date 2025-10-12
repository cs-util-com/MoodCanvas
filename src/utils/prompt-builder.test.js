import {
  buildRoomBriefPrompt,
  buildIterationPrompt,
  buildDescriptorRepairPrompt,
  buildFinalizationPrompt,
  buildFinalizationRepairPrompt,
} from './prompt-builder.js';

describe('prompt builders', () => {
  const roomBrief = {
    paragraph: 'The room is bright with high ceilings and neutral walls.',
    bullets: ['Keep envelope and trim.', 'Mind 90 cm walkways.'],
  };

  const axis = {
    label: 'Palette warm',
    instruction: 'Favor warm neutrals and amber highlights.',
  };

  const favorites = [
    { descriptor: 'Soft modern lounge with walnut millwork.', note: 'Keep the millwork tone.' },
  ];

  it('builds a room brief prompt with heuristics and purpose', () => {
    const prompt = buildRoomBriefPrompt({ purpose: 'Reading lounge' });
    expect(prompt).toMatch(/Reading lounge/);
    expect(prompt).toMatch(/60-30-10/);
    expect(prompt).toMatch(/90 cm/);
  });

  it('falls back to generic purpose copy for the room brief when blank', () => {
    const prompt = buildRoomBriefPrompt({ purpose: '   ' });
    expect(prompt).toMatch(/purpose: not specified/i);
  });

  it('builds an iteration prompt referencing axis, room brief, and favorites', () => {
    const prompt = buildIterationPrompt({
      roomBrief,
      purpose: '',
      globalGuidance: 'Keep the bay window clear.',
      favorites,
      axis,
    });

    expect(prompt).toMatch(/No specific purpose provided/);
    expect(prompt).toMatch(/Keep the bay window clear/);
    expect(prompt).toMatch(/Soft modern lounge/);
    expect(prompt).toMatch(/1024×682/);
    expect(prompt).toMatch(/Diversity axis focus/);
    expect(prompt).toMatch(/Note: Keep the millwork tone/);
  });

  it('omits optional branches in the iteration prompt when data is missing', () => {
    const prompt = buildIterationPrompt({
      roomBrief,
      purpose: '  Intimate lounge  ',
      globalGuidance: '   ',
      favorites: [
        { descriptor: 'Cozy corner seating.', note: '   ' },
      ],
      axis,
    });

    expect(prompt).toMatch(/Intimate lounge/);
    expect(prompt).not.toMatch(/Note:/);
    expect(prompt).not.toMatch(/Global guidance/);
  });

  it('throws when building an iteration prompt without an axis', () => {
    expect(() =>
      buildIterationPrompt({
        roomBrief,
        purpose: 'Gallery',
        globalGuidance: '',
        favorites: [],
      }),
    ).toThrow(/axis is required/);
  });

  it('builds a descriptor repair prompt including context', () => {
    const prompt = buildDescriptorRepairPrompt({
      roomBrief,
      purpose: '',
      favorites,
      globalGuidance: '',
      axis,
    });
    expect(prompt).toMatch(/replacement paragraph/);
    expect(prompt).toMatch(/Axis context/);
  });

  it('builds finalization prompt with build note instructions', () => {
    const prompt = buildFinalizationPrompt({ roomBrief, purpose: 'Reading lounge', favorites });
    expect(prompt).toMatch(/1536×1024/);
    expect(prompt).toMatch(/build notes/);
    expect(prompt).toMatch(/Soft modern lounge/);
  });

  it('builds finalization repair prompt when text missing', () => {
    const prompt = buildFinalizationRepairPrompt({ roomBrief, purpose: '', favorites: [] });
    expect(prompt).toMatch(/replacement build notes/);
    expect(prompt).toMatch(/single paragraph/);
  });

  it('includes favorite notes in finalization repair prompts', () => {
    const prompt = buildFinalizationRepairPrompt({ roomBrief, purpose: 'Gallery', favorites });
    expect(prompt).toMatch(/Gallery/);
    expect(prompt).toMatch(/Note: Keep the millwork tone/);
  });

  it('omits favorite notes in finalization prompts when blank', () => {
    const prompt = buildFinalizationPrompt({
      roomBrief,
      purpose: 'Gallery',
      favorites: [{ descriptor: 'Layered sconces along the wall.', note: '  ' }],
    });

    expect(prompt).toMatch(/Layered sconces along the wall/);
    expect(prompt).not.toMatch(/Note:/);
  });

  it('throws when finalization prompt lacks a room brief paragraph', () => {
    expect(() =>
      buildFinalizationPrompt({
        roomBrief: { paragraph: '', bullets: [] },
        purpose: '',
      }),
    ).toThrow(/roomBrief with paragraph/);
  });
});

