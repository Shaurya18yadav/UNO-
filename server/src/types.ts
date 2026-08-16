export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type CardValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: string;
  color: Color | null;
  value: CardValue;
}

export interface HouseRules {
  stacking: boolean;
  sevenZero: boolean;
  jumpIn: boolean;
}

export interface Player {
  id: string;
  username: string;
  avatarUrl?: string;
  avatarPreset?: string;
  hand: Card[];
  ready: boolean;
  connected: boolean;
  isGuest: boolean;
  isBot?: boolean;
  score: number;
  unoCalled: boolean;
  drewCardId?: string;
}

export interface PendingDraw {
  amount: number;
  type: 'draw2' | 'wild4';
  sourcePlayerId: string;
  sourceHadMatchingColor: boolean;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  username: string;
  text: string;
  createdAt: number;
  reactions: Record<string, string[]>;
}

export interface MatchMetrics {
  unoCalls: number;
  caughtWithoutUno: number;
}

export interface GameState {
  roomId: string;
  status: 'waiting' | 'playing' | 'round-over' | 'match-over';
  players: Player[];
  spectators: Map<string, { id: string; username: string; connected: boolean }>;
  drawPile: Card[];
  discardPile: Card[];
  currentColor: Color;
  currentPlayerIndex: number;
  direction: 1 | -1;
  pendingDraw?: PendingDraw;
  targetScore: number;
  maxRounds: number;
  round: number;
  winnerId?: string;
  roundWinnerId?: string;
  rules: HouseRules;
  chat: ChatMessage[];
  matchMetrics: Map<string, MatchMetrics>;
  turnDeadline?: number;
}

export interface SessionUser {
  id: string;
  username: string;
  isGuest: boolean;
  avatarUrl?: string;
  avatarPreset?: string;
  sessionVersion?: number;
}

