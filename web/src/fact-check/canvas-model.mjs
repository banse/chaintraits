// Pure presentation rules. This module never obtains or infers chain evidence.
export const CELL_POINTS = '89,0 44.5,77.1 -44.5,77.1 -89,0 -44.5,-77.1 44.5,-77.1';
export const FRAME_POINTS = '940,480 720,861.1 280,861.1 60,480 280,98.9 720,98.9';
const seatOrder = [1, 2, 3, 4, 5, 7, 8, 10, 9, 11, 12, 13];
const initial = [1, 2, 3, 4, 5, 7, 9, 10, 8, 11, 12, 13];

/** @param {number|null} quorum */
export function quorumFamilies(quorum) {
  return Number.isInteger(quorum) && quorum > 0 && quorum <= 12 ? seatOrder.slice(0, quorum) : [];
}

/** @param {import('./types').FactCheckAgent[]} agents @param {number|null} quorum */
export function arrangeAgents(agents, quorum) {
  const supported = agents.length <= 12 && (quorum === null || (Number.isInteger(quorum) && quorum >= 1 && quorum <= 12));
  if (!supported) return { supported, members: agents.map(agent => ({ agent, family: null, inside: false })) };
  const inside = quorumFamilies(quorum), outside = seatOrder.filter(s => !inside.includes(s));
  const seats = initial.slice(0, agents.length);
  const observed = agents.map(() => 'pending');
  const findAt = slot => seats.indexOf(slot);
  const pending = index => index >= 0 && !['agree', 'disagree', 'failed'].includes(observed[index]);
  const swap = (index, family) => {
    const other = findAt(family), old = seats[index];
    seats[index] = family;
    if (other >= 0) seats[other] = old;
  };
  agents.forEach((agent, index) => {
    observed[index] = agent.state;
    if (['disagree', 'failed'].includes(agent.state) && inside.includes(seats[index])) {
      const family = outside.find(s => pending(findAt(s))) ?? outside.find(s => findAt(s) < 0);
      if (family !== undefined) swap(index, family);
    }
    if (agent.state === 'agree' && !inside.includes(seats[index])) {
      const family = [...inside].reverse().find(s => pending(findAt(s))) ?? inside.find(s => findAt(s) < 0) ?? inside.find(s => ['disagree', 'failed'].includes(observed[findAt(s)]));
      if (family !== undefined) swap(index, family);
    }
  });
  return { supported, members: agents.map((agent, i) => ({ agent, family: seats[i], inside: inside.includes(seats[i]) })) };
}

/** @param {{family:number,x:number,y:number}[]} cells @param {number[]} families */
export function hiveOutline(cells, families) {
  const edges = new Map(), height = Math.sqrt(3) * 48;
  cells.filter(c => c.family === 6 || families.includes(c.family)).forEach(c => {
    const q = Math.round((c.x - 500) / 144), r = Math.round(((c.y - 480) / height - q) / 2);
    const vertices = [[2, 0], [1, 1], [-1, 1], [-2, 0], [-1, -1], [1, -1]].map(([x, y]) => [3 * q + x, 2 * r + q + y]);
    vertices.forEach((a, i) => {
      const b = vertices[(i + 1) % 6], key = `${a}|${b}`, reverse = `${b}|${a}`;
      if (edges.has(reverse)) edges.delete(reverse); else edges.set(key, { a, b });
    });
  });
  if (!edges.size) return '';
  const next = new Map([...edges.values()].map(e => [e.a.join(','), e.b]));
  const start = [...edges.values()][0].a, vertices = [start];
  let current = start;
  do {
    current = next.get(current.join(','));
    if (!current) break;
    vertices.push(current);
  } while (current.join(',') !== start.join(',') && vertices.length <= edges.size);
  return vertices.map(([x, y], i) => `${i ? 'L' : 'M'}${500 + x * 48},${(480 + y * height).toFixed(3)}`).join(' ') + ' Z';
}

/** @param {Pick<import('./types').FactCheckSnapshot, 'phase'|'registryStored'|'result'>} snapshot */
export function completionKind(snapshot) {
  if (snapshot.phase === 'negative' && snapshot.result === false) return 'negative';
  if (snapshot.phase !== 'saved' || !snapshot.registryStored) return null;
  return snapshot.result === true ? 'positive' : snapshot.result === false ? 'negative' : 'neutral';
}

/** @param {string} event @param {string} phase */
export function phaseStatus(event, phase) {
  const clean = event.replace(/^[✓✔]\s*/, '').replace(/[.\s…]+$/, '');
  const waiting = /waiting|pending|checking|confirming|loading|retrieving/i.test(clean);
  const confirmation = /confirmed|received|linked|reached|recorded|saved|refreshed|completed/i.test(clean);
  if (confirmation && !waiting) return `✓ ${clean}`;
  return ['failed', 'negative', 'saved'].includes(phase) ? clean : `${clean}...`;
}

/** @param {string|undefined} source */
export function safeImageSource(source) {
  if (!source) return undefined;
  if (/^ipfs:\/\//i.test(source)) return `https://ipfs.io/ipfs/${source.replace(/^ipfs:\/\/(ipfs\/)?/i, '')}`;
  if (/^ar:\/\//i.test(source)) return `https://arweave.net/${source.slice(5)}`;
  if (/^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/i.test(source)) return source;
  if (/^https?:\/\//i.test(source) || /^\.?\.?\//.test(source)) return source;
  return undefined;
}

/** @param {import('./types').FactCheckPhase} phase */
export function progressSteps(phase) {
  const index = { tx: 0, admission: 1, panel: 2, quorum: 3, delivery: 4, registry: 5, saved: 6, negative: 6, failed: -1, offline: -1 }[phase];
  return ['Transaction', 'Swarm request', 'Agents', 'Signed result', 'Delivery', 'Registry'].map((label, i) => ({ label, state: i < index ? 'done' : i === index ? 'current' : 'future' }));
}

/** @param {Pick<import('./types').FactCheckSnapshot, 'agents'|'answerKind'|'matchingAnswers'>} snapshot */
export function matchingAnswerCount(snapshot) {
  const agree = snapshot.agents.filter(agent => agent.state === 'agree').length;
  if (snapshot.answerKind === 'boolean') return Math.max(agree, snapshot.agents.filter(agent => agent.state === 'disagree').length);
  return typeof snapshot.matchingAnswers === 'number' && Number.isInteger(snapshot.matchingAnswers) && snapshot.matchingAnswers >= 0 ? snapshot.matchingAnswers : agree;
}
