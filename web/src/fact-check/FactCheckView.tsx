import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HIVE_CELLS } from '../hive-layout';
import { arrangeAgents, CELL_POINTS, completionKind, FRAME_POINTS, hiveOutline, matchingAnswerCount, phaseStatus, progressSteps, quorumFamilies, safeImageSource } from './canvas-model.mjs';
import { installHiveAnchor } from './hive-anchor.mjs';
import { CardShare } from './CardShare';
import { usePrimaryName } from '../ens-name';
import type { FactCheckAgent, FactCheckSnapshot } from './types';
import './fact-check.css';

const cells = [...HIVE_CELLS];
const fullOutline = hiveOutline(cells, cells.map(c => c.family));
const brief = (address: string) => address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
const identity = (agent: FactCheckAgent) => agent.tokenId ? `IDMD #${agent.tokenId}` : agent.label || 'Identity not reported';
const stateLabel = (agent: FactCheckAgent, kind?: FactCheckSnapshot['answerKind']) => agent.answer || ({ pending: 'PENDING', queued: 'QUEUED', agree: kind === 'boolean' ? 'TRUE' : 'MATCH', disagree: kind === 'boolean' ? 'FALSE' : 'DIFFERENT', failed: 'NO ANSWER', unknown: 'UNKNOWN' }[agent.state]);
const isUrl = (value?: string) => !!value && /^https?:\/\//i.test(value);
const waitingPhases = {
  tx: { label: 'TRANSACTION', detail: 'Waiting for Ethereum confirmation' },
  admission: { label: 'SWARM REQUEST', detail: 'Waiting for the matching oracle job' },
  delivery: { label: 'DELIVERY', detail: 'Waiting for result delivery' },
  registry: { label: 'REGISTRY', detail: 'Waiting for the Registry update' },
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}

function readDismissed(key: string) {
  try { return localStorage.getItem(`sworn:fact-check:dismissed:${key}`) === '1'; } catch { return false; }
}

function AgentCanvas({ snapshot, flashAt, onMember, archived = false }: { snapshot: FactCheckSnapshot; flashAt: number | null; onMember: (key: string) => void; archived?: boolean }) {
  const layout = useMemo(() => arrangeAgents(snapshot.agents, snapshot.quorum), [snapshot.agents, snapshot.quorum]);
  const supportsPanel = layout.supported && (snapshot.panelSize === null || snapshot.panelSize <= 12);
  const flashDelay = useMemo(() => flashAt ? -(Date.now() - flashAt) : 0, [flashAt]);
  const families = quorumFamilies(snapshot.quorum);
  const border = hiveOutline(cells, families);
  const waitingCopy = archived ? undefined : waitingPhases[snapshot.phase as keyof typeof waitingPhases];
  const waiting = !!waitingCopy;
  const halted = archived || ['offline', 'failed', 'negative', 'saved'].includes(snapshot.phase);
  const occupied = new Set(layout.members.map(member => member.family));
  const showMembers = supportsPanel && (archived || !waiting && !['delivery', 'registry'].includes(snapshot.phase));
  const phase = snapshot.phase;
  const title = waitingCopy ? waitingCopy.detail : supportsPanel ? `${snapshot.agents.length} reported oracle members. The center is the requested fact, not an agent.` : 'This panel exceeds the hive canvas capacity. Every reported member is listed below.';
  return <svg className={`fc-hive fc-phase-${phase}${halted ? ' fc-halted' : ''}${flashAt ? ' fc-quorum-flash' : ''}`} viewBox="0 0 1000 1000" role="group" aria-label={title} style={{ '--fc-flash-delay': `${flashDelay}ms` } as CSSProperties}>
    <title>{title}</title>
    <polygon className="fc-outer-frame" points={FRAME_POINTS}/>
    <polygon className={`fc-trace fc-outer-trace fc-layer${phase === 'tx' || phase === 'registry' ? ' fc-layer-active' : ''}`} points={FRAME_POINTS} pathLength="100" aria-hidden="true"/>
    {phase !== 'tx' && <path className="fc-inner-outline" d={fullOutline}/>}
    <path className={`fc-trace fc-inner-trace fc-layer${phase === 'admission' || phase === 'delivery' || phase === 'registry' ? ' fc-layer-active' : ''}`} d={fullOutline} pathLength="100" aria-hidden="true"/>
    {!archived && Object.entries(waitingPhases).map(([waitingPhase, copy]) => <g key={waitingPhase} className={`fc-waiting fc-layer${phase === waitingPhase ? ' fc-layer-active' : ''}`} transform="translate(500 480)" aria-hidden={phase !== waitingPhase}>
      <text textAnchor="middle" y="-25" className="fc-waiting-label">{copy.label}</text>
      <text textAnchor="middle" y="25" className="fc-waiting-title">PENDING</text>
      <text textAnchor="middle" y="78" className="fc-waiting-detail">{copy.detail}</text>
    </g>)}
    {!supportsPanel && <g className={`fc-layer${archived || !waiting && !['delivery', 'registry'].includes(phase) ? ' fc-layer-active' : ''}`} transform="translate(500 440)" aria-hidden={!archived && (waiting || ['delivery', 'registry'].includes(phase))}>
      <text textAnchor="middle" className="fc-waiting-label">{snapshot.panelSize ?? snapshot.agents.length} REPORTED MEMBERS</text>
      <text textAnchor="middle" y="55" className="fc-waiting-detail">Full panel shown in the member list below</text>
      <text textAnchor="middle" y="90" className="fc-waiting-detail">The card canvas has 12 agent positions</text>
    </g>}
    <g className={`fc-agent-layer fc-layer${showMembers ? ' fc-layer-active' : ''}`} aria-hidden={!showMembers}>
      {cells.map(cell => <g transform={`translate(${cell.x} ${cell.y})`} key={cell.family} className={cell.family === 6 ? 'fc-cell fc-requested' : 'fc-cell'}>
        <polygon points={CELL_POINTS}/>
        {cell.family === 6 ? <><text className="fc-anchor-id" textAnchor="middle" y="7">{snapshot.factId}</text><text className="fc-anchor-caption" textAnchor="middle" y="36">REQUESTED</text></> : !occupied.has(cell.family) && <text className="fc-empty" textAnchor="middle" y="7">·</text>}
      </g>)}
      {layout.members.map(member => {
        const cell = cells.find(c => c.family === member.family);
        if (!cell) return null;
        const { agent, inside } = member, pending = agent.state === 'pending' || agent.state === 'queued';
        const token = agent.tokenId || '?';
        return <g key={agent.key} className={`fc-agent fc-agent-${agent.state}`} data-identity-token-id={agent.tokenId} data-inside={inside} style={{ transform: `translate(${cell.x}px, ${cell.y}px)` }} role="button" tabIndex={showMembers ? 0 : -1} aria-label={`${identity(agent)}: ${stateLabel(agent, snapshot.answerKind)}. Open reported details.`} onClick={() => onMember(agent.key)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onMember(agent.key); } }}>
          <title>{`${identity(agent)}: ${stateLabel(agent, snapshot.answerKind)}`}</title>
          <polygon className="fc-agent-fill" points={CELL_POINTS}/>
          {agent.state === 'agree' && <polygon className="fc-agent-confirmation" points={CELL_POINTS} aria-hidden="true"/>}
          {pending ? <>
            <text className="fc-pending-label" textAnchor="middle" y="-58">{agent.tokenId ? 'IDMD' : 'IDENTITY'}</text>
            <circle className="fc-spinner-track" cx="0" cy="-8" r="38"/>
            <circle className="fc-spinner" cx="0" cy="-8" r="38"/>
            <text className="fc-agent-number" textAnchor="middle" y="4" textLength={token.length > 4 ? 70 : undefined} lengthAdjust="spacingAndGlyphs">{token}</text>
          </> : <>
            <text className="fc-agent-name" textAnchor="middle" y="-20">{agent.tokenId ? `IDMD ${agent.tokenId}` : 'UNREPORTED ID'}</text>
            <text className="fc-agent-mark" textAnchor="middle" y="16">{agent.state === 'agree' ? '✓' : agent.state === 'disagree' || agent.state === 'failed' ? '×' : '?'}</text>
          </>}
          <text className="fc-agent-answer" textAnchor="middle" y={pending ? 60 : 48}>{stateLabel(agent, snapshot.answerKind).length < 13 ? stateLabel(agent, snapshot.answerKind) : 'ANSWER'}</text>
        </g>;
      })}
      {families.length > 0 && <>
        <path className={`fc-agreement-border${snapshot.quorumReached ? ' fc-agreement-complete' : ''}`} d={border}/>
        <path className={`fc-trace fc-agreement-trace fc-layer${phase === 'panel' || phase === 'quorum' ? ' fc-layer-active' : ''}`} d={border} pathLength="100"/>
      </>}
    </g>
  </svg>;
}

type Presentation = {
  history: boolean;
  snapshot: FactCheckSnapshot;
  reduced: boolean;
  flashAt: number | null;
  artworkUrl?: string;
  artworkLoaded: boolean;
  artworkError: boolean;
  revealAt: number | null;
  revealed: boolean;
  dismissed: boolean;
  onImageLoad: () => void;
  onImageError: () => void;
  onDismiss: () => void;
};

function FactCheckContent({ snapshot, history, reduced, flashAt, artworkUrl, artworkLoaded, artworkError, revealAt, revealed, dismissed, onImageLoad, onImageError, onDismiss }: Presentation) {
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const memberList = useRef<HTMLDetailsElement>(null);
  const kind = completionKind(snapshot);
  const completed = kind !== null;
  const resultAgents = (history || completed) && snapshot.evidenceKind !== 'direct';
  const textResult = !resultAgents && completed && (!artworkUrl || artworkError);
  const resultVisible = completed && (resultAgents || revealed);
  const finalMessageVisible = !history && (resultVisible || (completed && !!snapshot.cardless)) && !dismissed;
  const agree = snapshot.agents.filter(a => a.state === 'agree').length;
  const disagree = snapshot.agents.filter(a => a.state === 'disagree').length;
  const matching = matchingAnswerCount(snapshot);
  const valid = snapshot.agents.filter(a => a.state === 'agree' || a.state === 'disagree').length;
  const geometric = snapshot.agents.length <= 12 && (snapshot.quorum === null || snapshot.quorum <= 12) && (snapshot.panelSize === null || snapshot.panelSize <= 12);
  const revealDelay = useMemo(() => revealAt ? -(Date.now() - revealAt) : 0, [revealAt]);
  const explaining = !resultAgents && snapshot.phase === 'panel' && !snapshot.quorumReached;
  const headingId = useId();
  const cardPanel = useRef<HTMLElement>(null);
  const showMember = (key: string) => {
    setSelectedMember(key);
    if (memberList.current) { memberList.current.open = true; memberList.current.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'nearest' }); }
  };
  const mainCanvasSnapshot = completed && !resultAgents ? { ...snapshot, phase: 'registry' as const } : snapshot;
  const highlightedCell = cells.find(cell => cell.family === Math.floor(snapshot.factId / 100));
  const displayStatus = resultAgents && completed ? '' : resultAgents && snapshot.registryStored ? '✓ Registry confirmed this result.' : snapshot.cardError && snapshot.registryStored ? 'Registry write confirmed. Card artwork is unavailable.' : completed ? (snapshot.cardError || artworkError ? 'Registry result confirmed. Card artwork is unavailable.' : snapshot.cardLoading || !artworkUrl && !snapshot.cardless ? 'Registry result confirmed. Loading your card...' : snapshot.cardless ? 'Registry result confirmed. This wallet has no card.' : !revealed ? 'Registry result confirmed. Refreshing your card...' : '') : phaseStatus(snapshot.latestEvent || 'Waiting for request evidence', snapshot.phase);
  const progressLabel = ({ tx: 'Waiting for Ethereum confirmation...', admission: 'Waiting for the oracle job...', panel: 'Agents are checking your fact...', quorum: 'Agreement reached · waiting for a signed result...', delivery: 'Waiting for Registry delivery...', registry: 'Confirming the Registry result...', saved: kind === 'neutral' ? 'Registry result confirmed' : 'Registry fact confirmed', negative: 'Negative result confirmed', failed: 'Attempt ended without a saved fact', offline: 'Checking the latest status...' })[snapshot.phase];
  return <div className="fc-content">
    {/* The step strip stays pinned while the card is on screen; the card's end scrolls it away. */}
    <div className="fc-pinned">
    {!history && !(completed && dismissed) && <section className={`fc-progress-strip${completed ? ' fc-progress-complete' : ''}`} aria-label="Request progress">
      <div className="fc-progress-current"><span className={`fc-progress-icon${completed || snapshot.phase === 'failed' || snapshot.phase === 'offline' ? '' : ' fc-progress-active'}`} aria-hidden="true">{completed ? kind === 'negative' ? '×' : '✓' : snapshot.phase === 'failed' ? '×' : '◌'}</span><div><span>{snapshot.factName} / {snapshot.factId}</span><strong>{progressLabel}</strong></div></div>
      <ol>{progressSteps(snapshot.phase).map((step, i) => <li key={step.label} className={`fc-step-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}><span aria-hidden="true">{step.state === 'done' ? '✓' : i + 1}</span><span>{step.label}</span><span className="fc-screen-reader">{step.state === 'done' ? 'confirmed' : step.state === 'current' ? 'pending' : 'not confirmed'}</span></li>)}</ol>
    </section>}
    <div className="fc-check-panel">
    <section className="fc-question" aria-labelledby={headingId}>
      <h2 id={headingId} className="fc-label">{snapshot.evidenceKind === 'direct' ? 'Direct Facts Recorded at Card Mint' : 'Oracle Question'}</h2>
      <p>{snapshot.question || 'The exact oracle question has not been reported yet.'}</p>
    </section>
    {snapshot.evidenceKind !== 'direct' && <section className="fc-quorum" aria-label="Required agreement">
      <div className="fc-quorum-heading"><h2 className="fc-label">Required Agreement</h2><p aria-label={snapshot.quorum !== null && snapshot.panelSize !== null ? `${snapshot.quorum} matching answers required from ${snapshot.panelSize} agents` : undefined}><strong>{snapshot.quorum === null ? 'Quorum not reported' : `${snapshot.quorum} / ${snapshot.panelSize ?? '?'}`}</strong></p></div>
      {snapshot.quorum !== null && snapshot.quorum > 0 && snapshot.quorum <= 50 ? <div className="fc-meter" aria-label={`${matching} matching reported answers; ${snapshot.quorum} required`}>{Array.from({ length: snapshot.quorum }, (_, i) => <i key={i} className={i < matching ? snapshot.answerKind === 'boolean' && disagree > agree ? 'fc-meter-negative' : 'fc-meter-filled' : ''}/>)}</div> : null}
      <p className="fc-quorum-detail">{snapshot.agents.length ? snapshot.answerKind === 'boolean' ? `${valid} valid answers · ${agree} TRUE · ${disagree} FALSE` : snapshot.answerKind === 'count' ? `${valid} valid answers · ${agree} matching count · ${disagree} not matching` : `${valid} classified answers · ${agree} matching · ${disagree} differing` : snapshot.phase === 'tx' || snapshot.phase === 'admission' ? 'The panel starts after the request is confirmed and its oracle job is linked.' : 'No member answers have been reported for this request.'}</p>
    </section>}
    </div>
    <section className="fc-card-panel" aria-label="Oracle agent visualization" ref={cardPanel}>
      <h2 className="fc-canvas-title">{snapshot.evidenceKind === 'direct' ? 'YOUR WALLET CARD' : 'IDENTITY.MD JURY'}</h2>
      <div className={`fc-card-layout${snapshot.evidenceKind !== 'direct' ? ' fc-oracle-layout' : ''}${completed ? ' fc-completed' : ''}${textResult || resultAgents && !snapshot.agents.length ? ' fc-without-art' : ''}`}>
        <div className="fc-context">
          {snapshot.evidenceKind === 'direct' ? <>
            <p className="fc-short-question">{snapshot.shortQuestion || snapshot.question}</p>
            <div className="fc-wallet"><span>{snapshot.wallet || 'Wallet not reported'}</span>{snapshot.ensName && <strong>{snapshot.ensName}</strong>}</div>
          </> : <>
            <div className="fc-fact"><h3 className="fc-context-label">FACT</h3><p className="fc-short-question">{snapshot.shortQuestion || snapshot.question}</p></div>
            <p className="fc-fact-name"><strong>{snapshot.factName}</strong></p>
          </>}
        </div>
        <div className={`fc-artwork${!resultAgents && artworkLoaded && completed ? ' fc-artwork-returning' : ''}`}>
          {resultAgents && (snapshot.agents.length ? <div className="fc-current-scene fc-result-agents"><AgentCanvas key={snapshot.key} snapshot={mainCanvasSnapshot} flashAt={null} onMember={showMember} archived/></div> : <div className="fc-no-art"><strong>Agent data unavailable</strong><p>The recorded agents and their answers have not been reported for this request. The Registry outcome is shown separately.</p></div>)}
          {!history && !resultAgents && !textResult && <div className={`fc-current-scene${artworkLoaded && completed ? ' fc-scene-leave' : ''}`}><AgentCanvas key={snapshot.key} snapshot={mainCanvasSnapshot} flashAt={flashAt} onMember={showMember}/></div>}
          {!resultAgents && completed && artworkUrl && !artworkError && <div className={`fc-returned-art${artworkLoaded ? ' fc-image-ready' : ''}`} style={{ '--fc-reveal-delay': `${revealDelay}ms` } as CSSProperties}>
            <img src={artworkUrl} alt={`${snapshot.factName}: current onchain-rendered card for ${snapshot.ensName || brief(snapshot.wallet)}`} onLoad={onImageLoad} onError={onImageError}/>
            {kind === 'positive' && highlightedCell && <svg className="fc-new-fact" viewBox="0 0 1000 1000" aria-hidden="true"><polygon points={CELL_POINTS} transform={`translate(${highlightedCell.x} ${highlightedCell.y})`}/></svg>}
          </div>}
          {textResult && <div className="fc-no-art"><strong>{snapshot.cardless ? 'Wallet fact record' : artworkError || snapshot.cardError ? 'Card artwork unavailable' : 'Loading your card...'}</strong><p>{snapshot.cardless ? 'This wallet has no minted card. Its Registry result is available independently.' : snapshot.cardError || (artworkError ? 'The card image could not be loaded. The Registry result is unchanged.' : 'Waiting for the actual token metadata image.')}</p></div>}
        </div>
        <div className="fc-answer" aria-live="polite">
          {snapshot.evidenceKind !== 'direct' && <div className="fc-wallet"><h3 className="fc-context-label">WALLET</h3><span>{snapshot.wallet || 'Wallet not reported'}</span>{snapshot.ensName && <strong>{snapshot.ensName}</strong>}</div>}
          {explaining && <p className="fc-explanation">{geometric && snapshot.quorum && snapshot.answerKind === 'boolean' ? <>Spinners mean agents are checking. Green answers move inside the border; red answers move outside. All {snapshot.quorum} bordered agent hives must turn green for YES. {snapshot.quorum} FALSE answers mean NO.</> : <>Each hive shows one reported agent. Spinners mean a response is pending. The complete member list below shows every reported answer.{snapshot.quorum === null ? ' The required quorum has not been reported.' : ` ${snapshot.quorum} matching answers are required.`}{snapshot.answerKind === 'count' ? ' Green means the same reported count; red means a different count. The Registry applies the rule’s threshold after agreement.' : snapshot.answerKind === 'list' ? ' Green means agreement with the reported list, not personal wallet eligibility.' : ''}</>}</p>}
          {resultVisible && <span className={`fc-result-mark${kind === 'negative' ? ' fc-no' : ''}`} aria-label={kind === 'positive' ? 'Confirmed true' : kind === 'negative' ? 'Confirmed false' : 'Registry result confirmed'}><span className="fc-result-badge" aria-hidden="true">{kind === 'negative' ? '×' : '✓'}</span></span>}
        </div>
        {resultVisible && <div className={`fc-saved-label${kind === 'negative' ? ' fc-no' : ''}`}>
          {kind !== 'negative' && snapshot.evidenceKind !== 'direct' && <span>✓ SWORN BY SWARM</span>}
          <span>{kind === 'positive' ? '✓ FACT SAVED' : kind === 'negative' ? '× FACT NOT ADDED' : '✓ RESULT SAVED'}</span>
        </div>}
      </div>
      {displayStatus && <p className={`fc-latest-event${snapshot.phase === 'failed' ? ' fc-no' : ''}`} role="status">{displayStatus}</p>}
      {!resultAgents && snapshot.cardError && !completed && <p className="fc-notice">{snapshot.registryStored ? 'The Registry write is confirmed. ' : ''}{snapshot.cardError} Refresh the request to retry the artwork read. No new fact request is needed.</p>}
      {!geometric && <p className="fc-notice">This panel does not fit the card’s 12 agent positions. Every reported member appears below; no member has been omitted.</p>}
      {resultVisible && kind && <CardShare panel={cardPanel} snapshot={snapshot} kind={kind} title={snapshot.evidenceKind === 'direct' ? 'YOUR WALLET CARD' : 'IDENTITY.MD JURY'} saved={[...(kind !== 'negative' && snapshot.evidenceKind !== 'direct' ? ['✓ SWORN BY SWARM'] : []), kind === 'positive' ? '✓ FACT SAVED' : kind === 'negative' ? '× FACT NOT ADDED' : '✓ RESULT SAVED']}/>}
    </section>
    </div>
    {finalMessageVisible && <section className={`fc-confirmation${kind === 'negative' ? ' fc-confirmation-negative' : ''}`} role="status">
      <button className="fc-dismiss" type="button" aria-label="Dismiss Registry confirmation" onClick={onDismiss}>×</button>
      <span className="fc-confirmation-icon" aria-hidden="true">{kind === 'negative' ? '×' : '✓'}</span>
      <div><p className="fc-label">Registry confirmed</p><h2>{kind === 'positive' ? `${snapshot.factName} Is Now a Wallet Fact.` : kind === 'negative' ? 'The Result Is NO.' : 'The Result Is Saved in the Registry.'}</h2>
      <p>{kind === 'positive' ? `Fact ${snapshot.factId} is saved. ${snapshot.cardless ? 'A card can read it when you mint one.' : 'Your card now reads and displays it.'}` : kind === 'negative' ? 'The Registry recorded a negative result. No new wallet fact was added.' : 'This result is stored in the Registry. It does not establish a personal wallet fact.'}</p>
      {snapshot.mode === 'live' && <div className="fc-actions"><a href={`#/explorer?address=${encodeURIComponent(snapshot.wallet)}`} onClick={onDismiss}>{snapshot.cardless ? 'View wallet facts' : 'View wallet and card'}</a>{isUrl(snapshot.jobUrl) && <a href={snapshot.jobUrl} target="_blank" rel="noreferrer">View oracle job</a>}</div>}
      </div>
    </section>}
    {snapshot.agents.length > 0 && <details className="fc-members" ref={memberList} open={history && resultAgents || !geometric || undefined}>
      <summary>Agent details · {snapshot.agents.length}{snapshot.panelSize !== null ? ` of ${snapshot.panelSize}` : ''} reported members</summary>
      <ul>{snapshot.agents.map(agent => <li key={agent.key} className={`fc-member fc-member-${agent.state}${selectedMember === agent.key ? ' fc-member-selected' : ''}`}>
        <div><strong>{identity(agent)}</strong><span>{stateLabel(agent, snapshot.answerKind)}</span></div>
        {agent.detail && <p>{agent.detail}</p>}
      </li>)}</ul>
    </details>}
    {snapshot.notice && <p className="fc-notice" role="status">{snapshot.notice}</p>}
    {!history && <section className="fc-feed" aria-label="Action feed"><h2>Action Feed</h2>
      {snapshot.events.length ? <ol>{snapshot.events.map(event => <li key={event.id}>
        <div className="fc-event-meta">{event.time && <time>{event.time}</time>}<span>{event.source}</span></div>
        <div><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}{isUrl(event.href) && <a href={event.href} target="_blank" rel="noreferrer">View source ↗</a>}</div>
      </li>)}</ol> : <p className="fc-empty-state">No request events have been observed.</p>}
    </section>}
    {!history && <div className="fc-evidence">
      <details><summary>View pinned definitions and evidence window</summary><div>{snapshot.definitions ? <p>{snapshot.definitions}</p> : <p>No pinned definition text is available for this request.</p>}{snapshot.evidenceWindow && <p>{snapshot.evidenceWindow}</p>}{snapshot.requestId && <p>Request ID: <code>{snapshot.requestId}</code></p>}{snapshot.transactionHash && /^0x[0-9a-f]{64}$/i.test(snapshot.transactionHash) && <a href={`https://etherscan.io/tx/${snapshot.transactionHash}`} target="_blank" rel="noreferrer">View request transaction ↗</a>}</div></details>
      <p><span>Wallet <strong title={snapshot.wallet}>{brief(snapshot.wallet) || 'Not reported'}</strong></span>{snapshot.evidenceWindow && <span>{snapshot.evidenceWindow}</span>}<span>Ethereum mainnet</span></p>
    </div>}
  </div>;
}

/** Presentation only. All chain evidence is provided by the parent controller. */
export function FactCheckView({ snapshot: reported, embedded = false, variant = 'progress' }: { snapshot: FactCheckSnapshot; embedded?: boolean; variant?: 'progress' | 'history' }) {
  const primaryName = usePrimaryName(reported.ensName ? undefined : reported.wallet);
  const snapshot = useMemo(() => primaryName && !reported.ensName ? { ...reported, ensName: primaryName } : reported, [reported, primaryName]);
  const prefersReducedMotion = useReducedMotion();
  const history = variant === 'history';
  const reduced = prefersReducedMotion || history;
  const imageUrl = safeImageSource(snapshot.cardImage);
  const imageKey = `${snapshot.key}:${imageUrl || ''}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ key: string; at: number; done: boolean } | null>(null);
  const [flash, setFlash] = useState<{ key: string; at: number } | null>(null);
  const flashed = useRef<string | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const completed = completionKind(snapshot) !== null;
  const artworkLoaded = loadedKey === imageKey && errorKey !== imageKey;
  const revealed = reveal?.key === imageKey && reveal.done && completed;
  const flashAt = flash?.key === snapshot.key ? flash.at : null;

  useEffect(() => {
    if (!completed || !artworkLoaded) { setReveal(null); return; }
    setReveal({ key: imageKey, at: Date.now(), done: reduced });
    if (reduced) return;
    const timer = window.setTimeout(() => setReveal(current => current?.key === imageKey ? { ...current, done: true } : current), 700);
    return () => window.clearTimeout(timer);
  }, [completed, artworkLoaded, imageKey, reduced]);

  useEffect(() => {
    if (snapshot.quorumReached && snapshot.quorum !== null && snapshot.agents.filter(agent => agent.state === 'agree').length >= snapshot.quorum && (snapshot.phase === 'panel' || snapshot.phase === 'quorum') && flashed.current !== snapshot.key && !reduced) {
      flashed.current = snapshot.key;
      setFlash({ key: snapshot.key, at: Date.now() });
      const timer = window.setTimeout(() => setFlash(null), 1400);
      return () => window.clearTimeout(timer);
    }
  }, [snapshot.key, snapshot.quorumReached, reduced]);

  useEffect(() => { installHiveAnchor(window); }, []);
  useEffect(() => { setDismissedKey(readDismissed(snapshot.key) ? snapshot.key : null); }, [snapshot.key]);
  const dismiss = () => { setDismissedKey(snapshot.key); try { localStorage.setItem(`sworn:fact-check:dismissed:${snapshot.key}`, '1'); } catch { /* Persistence may be disabled by the browser. */ } };
  const presentation: Presentation = { snapshot, history, reduced, flashAt, artworkUrl: imageUrl, artworkLoaded, artworkError: errorKey === imageKey, revealAt: reveal?.key === imageKey ? reveal.at : null, revealed, dismissed: dismissedKey === snapshot.key, onImageLoad: () => setLoadedKey(imageKey), onImageError: () => setErrorKey(imageKey), onDismiss: dismiss };
  return <div className="fact-check-view" data-mode={snapshot.mode} data-presentation={variant} data-request-key={snapshot.key}>
    {!history && !embedded && <div className="fc-toolbar"><button type="button" onClick={() => { setDialogOpen(true); dialog.current?.showModal(); }}>Open progress dialog</button></div>}
    <FactCheckContent {...presentation}/>
    {!history && !embedded && <dialog ref={dialog} className="fc-progress-dialog" aria-label="Fact Check progress" onClose={() => setDialogOpen(false)} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="fc-dialog-header"><strong>Fact Check progress</strong><button type="button" aria-label="Close progress dialog" onClick={() => dialog.current?.close()}>×</button></div>
      {dialogOpen && <FactCheckContent {...presentation}/>}
    </dialog>}
  </div>;
}
