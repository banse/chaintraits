import { configure, defaults } from './_settings.mjs';

const profiles = {
  default: {},
  delayed: {
    walletSeconds: 3, approvalSeconds: 5, preflightSeconds: 2, artworkSeconds: 4,
    transactionSeconds: 6, pickup: 12, firstAnswerSeconds: 8, answerEverySeconds: 2,
    attestAfterSeconds: 12, deliverAfterSeconds: 10, registrySeconds: 6, speed: 1,
  },
};

export function profileSettings(name = 'default') {
  if (!Object.hasOwn(profiles, name)) throw Error(`Unknown simulation profile: ${name}. Choose default or delayed.`);
  return configure({ ...defaults }, profiles[name]);
}
