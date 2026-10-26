import { liveSnapshot } from './live-model.mjs';
import { isSharedFact } from '../progress-experience.mjs';
import { safeImageSource } from './canvas-model.mjs';

const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Adapt validated shared observations; saved browser records alone are not evidence. */
export function swarmSnapshot({fact,wallet,view}) {
  if (!wallet || !view?.requestConfirmed || !view.identity || !same(view.address,wallet) || !same(view.requestId,fact.requestId)) return null;
  const identity=view.identity, origin=identity.origin;
  const shared=isSharedFact(fact.id,identity.spec);
  if (identity.chainId !== 1 || !origin || origin.removed || origin.eventName !== 'TraitRequested' ||
      !same(origin.address,identity.registry) || !same(origin.args?.requestId,fact.requestId) ||
      !same(identity.requestId,fact.requestId) || Number(origin.args?.traitId) !== fact.id ||
      !same(origin.args?.questionHash,identity.questionHash) || !same(origin.args?.claimant,identity.claimant) ||
      !(same(identity.claimant,wallet) || (shared && /^0x0{40}$/i.test(identity.claimant))))
    throw Error('Registry request binding does not match this wallet and fact.');
  return liveSnapshot({
    identity:{...identity,wallet,factId:fact.id,factName:fact.name},
    progress:view.progress,
    terminal:view.event,
    hasFact:view.hasFact,
    token:view.token,
    cardImage:view.cardImage,
    cardError:view.cardError,
    apiError:view.apiError || '',
    chainError:view.chainError || '',
    events:view.events || [],
  });
}

/** readContract is scoped to the current Registry and abort signal by the observer.
 * @param {(name:string,args:any[]) => Promise<any>} readContract
 * @param {string} wallet
 * @param {bigint|null} knownToken
 */
export async function readCardArtwork(readContract,wallet,knownToken=null) {
  const token=knownToken ?? await readContract('tokenOf',[wallet]);
  if (token === 0n) return {token};
  try {
    const uri=await readContract('tokenURI',[token]);
    if (typeof uri !== 'string' || !uri.startsWith('data:application/json;base64,'))
      throw Error('Card artwork unavailable: unsupported metadata envelope.');
    const raw=atob(uri.slice(uri.indexOf(',')+1));
    const metadata=JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
    const cardImage=typeof metadata?.image === 'string' ? safeImageSource(metadata.image) : undefined;
    if (!cardImage) throw Error('Card artwork unavailable: metadata has no supported image.');
    return {token,cardImage};
  } catch (error) {
    return {token,cardError:error instanceof Error?error.message:'Card artwork unavailable'};
  }
}
