function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const VERY_GOOD = new Set([
  'experience_very_good', 'muito boa', 'muito bom', 'excelente'
]);
const GOOD = new Set([
  'experience_good', 'boa', 'bom'
]);
const NEEDS_IMPROVEMENT = new Set([
  'experience_needs_improvement', 'poderia melhorar', 'pode melhorar',
  'precisa melhorar', 'nao foi boa', 'nao foi bom'
]);

export function classifyCustomerExperienceResponse(message) {
  const candidates = [message?.responseKey, message?.textBody]
    .map(normalize)
    .filter(Boolean);
  for (const value of candidates) {
    if (VERY_GOOD.has(value)) return 'very_good';
    if (GOOD.has(value)) return 'good';
    if (NEEDS_IMPROVEMENT.has(value)) return 'needs_improvement';
  }
  return null;
}

export const __test = { normalize, VERY_GOOD, GOOD, NEEDS_IMPROVEMENT };
