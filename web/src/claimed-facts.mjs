import { shortFactQuestion } from './fact-check/history-model.mjs';

/** Registry-held facts only; an unminted direct preview is not a saved fact. */
export function claimedFactRows(facts, traits, specs = []) {
  if (!facts) return [];
  return [...new Set([...facts.traits, ...facts.verifiedSpecs].map(Number))]
    .filter(id => facts.token !== 0n || traits.find(trait => trait.id === id)?.class !== 'direct')
    .sort((a, b) => a - b)
    .map(id => {
      const trait = traits.find(item => item.id === id);
      const spec = specs.find(item => Number(item.id) === id);
      return {
        id,
        name: trait?.name || spec?.name || `Fact ${id}`,
        meaning: shortFactQuestion(id, traits, specs) || 'Community spec; its rule could not be read.',
        kind: trait?.class || (spec?.kind === 3 ? 'shared' : spec?.kind === 5 ? 'panel' : 'chain'),
        group: !trait ? 'community' : trait.class === 'direct' ? 'direct' : 'oracle',
      };
    });
}
