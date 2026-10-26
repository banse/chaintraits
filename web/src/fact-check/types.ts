export type FactCheckPhase = 'tx' | 'admission' | 'panel' | 'quorum' | 'delivery' | 'registry' | 'saved' | 'negative' | 'failed' | 'offline';

export type FactCheckAgent = {
  key: string;
  tokenId?: string;
  label?: string;
  state: 'pending' | 'queued' | 'agree' | 'disagree' | 'failed' | 'unknown';
  answer?: string;
  detail?: string;
};

export type FactCheckEvent = {
  id: string;
  time?: string;
  source: string;
  title: string;
  detail?: string;
  href?: string;
};

export type FactCheckSnapshot = {
  key: string;
  mode: 'demo' | 'live';
  phase: FactCheckPhase;
  wallet: string;
  ensName?: string;
  factId: number;
  factName: string;
  evidenceKind?: 'oracle' | 'direct';
  question: string;
  shortQuestion: string;
  answerKind?: 'boolean' | 'count' | 'list' | 'unknown';
  /** Number of identical reported answers, not a sum of different values. */
  matchingAnswers?: number;
  panelSize: number | null;
  quorum: number | null;
  agents: FactCheckAgent[];
  quorumReached: boolean;
  /** Only set from a terminal, request-bound Registry outcome in live mode. */
  result: boolean | null;
  registryStored: boolean;
  /** Actual token metadata image in live mode; never a fixture fallback. */
  cardImage?: string;
  cardless?: boolean;
  cardLoading?: boolean;
  cardError?: string;
  requestId?: string;
  transactionHash?: string;
  jobUrl?: string;
  evidenceWindow?: string;
  definitions?: string;
  latestEvent: string;
  events: FactCheckEvent[];
  notice?: string;
};
