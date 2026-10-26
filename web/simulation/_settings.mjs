export const defaults = Object.freeze({
  walletSeconds: 0, approvalSeconds: null, preflightSeconds: 0, artworkSeconds: 0,
  nextAnswer: 'auto', delivery: 'normal', transactionSeconds: 3, pickup: 8,
  firstAnswerSeconds: 2, answerEverySeconds: 2, attestAfterSeconds: 8,
  deliverAfterSeconds: 6, registrySeconds: 3, speed: 1,
  questionWallet: 'claimant', detailJobId: true,
});

export function configure(settings, patch) {
  const next = { ...settings };
  const enums = { nextAnswer: ['auto', 'true', 'false', 'split', 'stall'],
    delivery: ['normal', 'hold', 'starved'], questionWallet: ['claimant', 'other'] };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults)) continue;
    if (enums[key]) {
      if (!enums[key].includes(value)) throw Error(`Invalid ${key}`);
    } else if (key === 'detailJobId') {
      if (typeof value !== 'boolean') throw Error(`Invalid ${key}`);
    } else if (key === 'approvalSeconds' && value === null) {
      // With no override, approvals keep the existing transaction mining delay.
    } else if (!Number.isFinite(value) || value < (key === 'speed' ? 0.1 : 0) || value > 600) {
      throw Error(`Invalid ${key}: expected seconds from 0 to 600`);
    }
    next[key] = value;
  }
  Object.assign(settings, next);
  return settings;
}

export const freezeRequest = settings => Object.freeze({ ...settings });
