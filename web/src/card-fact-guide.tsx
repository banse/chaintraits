import {FAMILIES} from './data';
import {HIVE_CELLS} from './hive-layout';
import {communityDisplay} from './card-facts.mjs';

export function CardFactGuide({ids,onFamily}:{ids:number[];onFamily?:(family:number)=>void}) {
  const display=communityDisplay(ids,HIVE_CELLS.map(cell=>cell.family));
  return <details className="card-fact-guide">
    <summary>How facts appear on this card · {display.count} community {display.count===1?'fact':'facts'}</summary>
    <p>The card reads your facts from the Registry contract. The 13 cells show the built-in fact families. Verified community facts add rings in acceptance order, up to three per cell. Mint Rule alone adds no ring; Mint Facts must first store an accepted fact for your wallet.</p>
    {display.count>0&&<ul aria-label="Community facts on the card">{display.positions.map(({id,family,ring}: {id:number;family:number|null;ring:number|null})=><li key={id}>
      <a href={`#/catalog#community-${id}`}>{id}</a>{' · '}
      {family!==null&&onFamily?<button className="card-ring-link" onClick={()=>onFamily(family)}>Ring {ring} on {FAMILIES[family-1]}</button>:family!==null?`Ring ${ring} on ${FAMILIES[family-1]}`:'Contributes to the frame level'}
    </li>)}</ul>}
    <p className="muted">From 40 community facts, the frame level grows in steps with the total. Card metadata lists at most 32 community facts; the wallet record and eligibility checks use the full verified list. The Registry is the source of wallet facts; the artwork displays them. A preview before minting is not an NFT.</p>
    <a href="#/curator">Use these facts in a list or eligibility rule</a>
  </details>;
}
