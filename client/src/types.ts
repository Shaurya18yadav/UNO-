export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type CardValue = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';
export type Card = { id: string; color: Color | null; value: CardValue };
export type User = { id: string; username: string; isGuest: boolean; avatarUrl?: string; avatarPreset?: string; sessionVersion?: number };

export type Preferences = { notifications: boolean; sound: boolean; theme: 'midnight' | 'table' | 'cyber' };
export type ProfileStats = { gamesPlayed: number; wins: number; losses: number; winRate: number; currentStreak: number; longestStreak: number; unoCalls: number; caughtWithoutUno: number };
export type Profile = { username: string; avatarUrl?: string; avatarPreset?: string; bio?: string; country?: string; stats: ProfileStats; preferences: Preferences; achievements: string[]; createdAt: string };
export type PublicProfile = Pick<Profile, 'username' | 'avatarUrl' | 'avatarPreset' | 'bio' | 'country' | 'stats' | 'achievements'>;
export type Friend = { id: string; username: string; avatarUrl?: string; avatarPreset?: string; isOnline?: boolean; stats: Pick<ProfileStats, 'wins' | 'losses'> };
export type MatchSummary = { id: string; roomCode: string; winnerId: string; completedAt: string; players: { id: string; username: string; score: number }[] };

export type RoomMeta = { code: string; isPrivate: boolean; players: number; bots: number; maxPlayers: number; status: string; hostId: string; host?: string; rules: { stacking: boolean; sevenZero: boolean; jumpIn: boolean }; createdAt: number };
export type GameSnapshot = {
  roomId: string; status: 'waiting' | 'playing' | 'round-over' | 'match-over'; players: { id: string; username: string; avatarUrl?: string; avatarPreset?: string; ready: boolean; connected: boolean; isBot: boolean; score: number; handCount: number; unoCalled: boolean; isYou: boolean }[];
  spectatorCount: number; topCard?: Card; currentColor: Color; currentPlayerId?: string; direction: 1 | -1; drawCount: number;
  pendingDraw?: { amount: number; type: 'draw2' | 'wild4'; sourcePlayerId: string }; targetScore: number; maxRounds: number; round: number; winnerId?: string; roundWinnerId?: string;
  rules: RoomMeta['rules']; turnDeadline?: number; chat: { id: string; playerId: string; username: string; text: string; createdAt: number; reactions: Record<string, string[]> }[]; hand: Card[]; drewCardId?: string; isSpectator: boolean;
};

