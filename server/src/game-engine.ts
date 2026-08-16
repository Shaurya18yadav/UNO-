import { createDeck, isWild, scoreCard, shuffle } from './deck.js';
import type { Card, CardValue, Color, GameState, HouseRules, Player } from './types.js';

export class GameRuleError extends Error {
  constructor(message: string) { super(message); this.name = 'GameRuleError'; }
}

export const DEFAULT_RULES: HouseRules = { stacking: false, sevenZero: false, jumpIn: false };

type PlayInput = {
  playerId: string;
  cardId: string;
  chosenColor?: Color;
  swapWithPlayerId?: string;
  callUno?: boolean;
};

const colors: Color[] = ['red', 'yellow', 'green', 'blue'];

export class UnoGame {
  readonly state: GameState;

  constructor(roomId: string, options?: { targetScore?: number; maxRounds?: number; rules?: Partial<HouseRules> }) {
    this.state = {
      roomId,
      status: 'waiting',
      players: [],
      spectators: new Map(),
      drawPile: [],
      discardPile: [],
      currentColor: 'red',
      currentPlayerIndex: 0,
      direction: 1,
      targetScore: options?.targetScore ?? 500,
      maxRounds: options?.maxRounds ?? 5,
      round: 0,
      rules: { ...DEFAULT_RULES, ...options?.rules },
      chat: [],
      matchMetrics: new Map()
    };
  }

  addPlayer(player: Omit<Player, 'hand' | 'ready' | 'connected' | 'score' | 'unoCalled'>): void {
    if (this.state.status !== 'waiting') throw new GameRuleError('The match is already in progress.');
    if (this.state.players.length >= 10) throw new GameRuleError('This room is full.');
    if (this.state.players.some((existing) => existing.id === player.id)) return;
    this.state.players.push({ ...player, hand: [], ready: false, connected: true, score: 0, unoCalled: false });
  }

  removeWaitingPlayer(playerId: string): void {
    if (this.state.status !== 'waiting') throw new GameRuleError('Players can only leave before the match starts.');
    this.state.players = this.state.players.filter((player) => player.id !== playerId);
  }

  startMatch(): void {
    if (this.state.status !== 'waiting') throw new GameRuleError('The match has already started.');
    if (this.state.players.length < 2) throw new GameRuleError('At least two players are required.');
    if (!this.state.players.every((player) => player.ready)) throw new GameRuleError('Every player must be ready.');
    for (const player of this.state.players) player.score = 0;
    this.state.matchMetrics = new Map(this.state.players.map((player) => [player.id, { unoCalls: 0, caughtWithoutUno: 0 }]));
    this.state.round = 1;
    this.startRound();
  }

  startNextRound(): void {
    if (this.state.status !== 'round-over') throw new GameRuleError('The round is not over.');
    this.state.round += 1;
    this.startRound();
  }

  prepareRematch(): void {
    if (this.state.status !== 'match-over') throw new GameRuleError('The match is not over.');
    this.state.status = 'waiting';
    this.state.winnerId = undefined;
    this.state.roundWinnerId = undefined;
    this.state.round = 0;
    this.state.pendingDraw = undefined;
    for (const player of this.state.players) {
      player.ready = true;
      player.score = 0;
      player.hand = [];
      player.unoCalled = false;
    }
  }

  private startRound(): void {
    this.state.status = 'playing';
    this.state.roundWinnerId = undefined;
    this.state.pendingDraw = undefined;
    this.state.direction = 1;
    this.state.currentPlayerIndex = 0;
    this.state.drawPile = shuffle(createDeck());
    this.state.discardPile = [];
    for (const player of this.state.players) {
      player.hand = [];
      player.unoCalled = false;
      player.drewCardId = undefined;
      for (let count = 0; count < 7; count++) player.hand.push(this.takeCard());
    }
    // Wild Draw Four cannot be an opening discard card; return it and draw again.
    let opening = this.takeCard();
    while (opening.value === 'wild4') {
      this.state.drawPile.unshift(opening);
      this.state.drawPile = shuffle(this.state.drawPile);
      opening = this.takeCard();
    }
    this.state.discardPile.push(opening);
    this.state.currentColor = opening.color ?? colors[Math.floor(Math.random() * colors.length)];
  }

  setReady(playerId: string, ready: boolean): void {
    if (this.state.status !== 'waiting') throw new GameRuleError('Ready status is only available before the match.');
    const player = this.requirePlayer(playerId);
    player.ready = ready;
  }

  play(input: PlayInput): void {
    this.requirePlaying();
    const player = this.requirePlayer(input.playerId);
    const top = this.topCard();
    const cardIndex = player.hand.findIndex((card) => card.id === input.cardId);
    if (cardIndex < 0) throw new GameRuleError('That card is not in your hand.');
    const card = player.hand[cardIndex];
    const isTurn = this.currentPlayer().id === player.id;
    const isJumpIn = !isTurn && this.state.rules.jumpIn && !this.state.pendingDraw && card.color === top.color && card.value === top.value;
    if (!isTurn && !isJumpIn) throw new GameRuleError('It is not your turn.');
    if (!this.isLegalCard(player, card)) throw new GameRuleError('That card cannot be played now.');
    if (isWild(card) && !input.chosenColor) throw new GameRuleError('Choose a color for a Wild card.');
    if (input.chosenColor && !colors.includes(input.chosenColor)) throw new GameRuleError('Invalid Wild color.');
    if (card.value === '7' && this.state.rules.sevenZero && !input.swapWithPlayerId) throw new GameRuleError('Choose a player to swap hands with.');

    const existingPending = this.state.pendingDraw;
    const matchingColorWasHeld = card.value === 'wild4' && player.hand.some((held) => held.id !== card.id && held.color === this.state.currentColor);
    if (isJumpIn) this.state.currentPlayerIndex = this.playerIndex(player.id);
    player.hand.splice(cardIndex, 1);
    player.drewCardId = undefined;
    player.unoCalled = player.hand.length === 1 && Boolean(input.callUno);
    if (player.unoCalled) this.recordUnoCall(player.id);
    this.state.discardPile.push(card);
    if (card.color) this.state.currentColor = card.color;
    if (isWild(card)) this.state.currentColor = input.chosenColor!;

    if (card.value === '7' && this.state.rules.sevenZero) this.swapHands(player.id, input.swapWithPlayerId!);
    if (card.value === '0' && this.state.rules.sevenZero) this.rotateHands();

    if (player.hand.length === 0) {
      this.finishRound(player.id);
      return;
    }

    this.applyCardEffect(card, player.id, matchingColorWasHeld, existingPending?.amount ?? 0);
  }

  draw(playerId: string): Card[] {
    this.requirePlaying();
    if (this.currentPlayer().id !== playerId) throw new GameRuleError('It is not your turn.');
    if (this.state.pendingDraw) throw new GameRuleError('Resolve the pending draw first.');
    const player = this.requirePlayer(playerId);
    if (player.drewCardId) throw new GameRuleError('Pass or play the card you already drew.');
    const card = this.takeCard();
    player.hand.push(card);
    player.drewCardId = card.id;
    return [card];
  }

  pass(playerId: string): void {
    this.requirePlaying();
    const player = this.requirePlayer(playerId);
    if (this.currentPlayer().id !== playerId || !player.drewCardId || this.state.pendingDraw) {
      throw new GameRuleError('You can only pass after drawing a normal card.');
    }
    player.drewCardId = undefined;
    this.advance();
  }

  acceptPenalty(playerId: string): Card[] {
    this.requirePlaying();
    if (this.currentPlayer().id !== playerId) throw new GameRuleError('It is not your turn.');
    const pending = this.state.pendingDraw;
    if (!pending) throw new GameRuleError('There is no pending draw penalty.');
    const cards = this.drawCards(this.requirePlayer(playerId), pending.amount);
    this.state.pendingDraw = undefined;
    this.advance();
    return cards;
  }

  challengeWildDrawFour(playerId: string): { success: boolean; cards: Card[] } {
    this.requirePlaying();
    if (this.currentPlayer().id !== playerId) throw new GameRuleError('It is not your turn.');
    const pending = this.state.pendingDraw;
    if (!pending || pending.type !== 'wild4') throw new GameRuleError('There is no Wild Draw Four to challenge.');
    this.state.pendingDraw = undefined;
    if (pending.sourceHadMatchingColor) {
      const offender = this.requirePlayer(pending.sourcePlayerId);
      const cards = this.drawCards(offender, pending.amount);
      return { success: true, cards: [] };
    }
    const cards = this.drawCards(this.requirePlayer(playerId), pending.amount + 2);
    this.advance();
    return { success: false, cards };
  }

  callUno(playerId: string): void {
    this.requirePlaying();
    const player = this.requirePlayer(playerId);
    if (player.hand.length !== 1) throw new GameRuleError('UNO can only be called with one card remaining.');
    if (!player.unoCalled) this.recordUnoCall(player.id);
    player.unoCalled = true;
  }

  catchUno(callerId: string, targetPlayerId: string): Card[] {
    this.requirePlaying();
    if (callerId === targetPlayerId) throw new GameRuleError('You cannot catch yourself.');
    const target = this.requirePlayer(targetPlayerId);
    if (target.hand.length !== 1 || target.unoCalled) throw new GameRuleError('That player cannot be caught for UNO.');
    const cards = this.drawCards(target, 2);
    this.metricsFor(targetPlayerId).caughtWithoutUno += 1;
    target.unoCalled = false;
    return cards;
  }

  autoPlayTurn(): void {
    if (this.state.status !== 'playing') return;
    const player = this.currentPlayer();
    if (this.state.pendingDraw) { this.acceptPenalty(player.id); return; }
    const legal = player.hand.find((card) => this.isLegalCard(player, card));
    if (!legal) {
      const [drawn] = this.draw(player.id);
      if (this.isLegalCard(player, drawn)) {
        this.play({ playerId: player.id, cardId: drawn.id, chosenColor: drawn.color ? undefined : this.bestWildColor(player), swapWithPlayerId: drawn.value === '7' && this.state.rules.sevenZero ? this.state.players.find((candidate) => candidate.id !== player.id)?.id : undefined, callUno: player.hand.length === 2 });
      } else this.pass(player.id);
      return;
    }
    const color = legal.color ? undefined : this.bestWildColor(player);
    const swapTarget = legal.value === '7' && this.state.rules.sevenZero
      ? this.state.players.find((candidate) => candidate.id !== player.id)?.id
      : undefined;
    this.play({ playerId: player.id, cardId: legal.id, chosenColor: color, swapWithPlayerId: swapTarget, callUno: player.hand.length === 2 });
  }

  private applyCardEffect(card: Card, sourcePlayerId: string, sourceHadMatchingColor: boolean, stackedAmount = 0): void {
    if (card.value === 'draw2') {
      this.state.pendingDraw = { amount: stackedAmount + 2, type: 'draw2', sourcePlayerId, sourceHadMatchingColor: false };
      this.advance();
      return;
    }
    if (card.value === 'wild4') {
      this.state.pendingDraw = { amount: stackedAmount + 4, type: 'wild4', sourcePlayerId, sourceHadMatchingColor };
      this.advance();
      return;
    }
    if (card.value === 'skip') { this.advance(2); return; }
    if (card.value === 'reverse') {
      this.state.direction = this.state.direction === 1 ? -1 : 1;
      this.advance();
      return;
    }
    this.advance();
  }

  private isLegalCard(player: Player, card: Card): boolean {
    const pending = this.state.pendingDraw;
    if (pending) {
      if (!this.state.rules.stacking) return false;
      return pending.type === 'draw2' ? card.value === 'draw2' : card.value === 'wild4';
    }
    // Wild Draw Four is allowed here; the server records whether the player
    // held the active color so the next player can resolve a challenge.
    if (isWild(card)) return true;
    const top = this.topCard();
    return card.color === this.state.currentColor || card.value === top.value;
  }

  private takeCard(): Card {
    if (!this.state.drawPile.length) this.reshuffleDiscard();
    const card = this.state.drawPile.pop();
    if (!card) throw new GameRuleError('There are no cards available to draw.');
    return card;
  }

  private drawCards(player: Player, amount: number): Card[] {
    const cards = Array.from({ length: amount }, () => this.takeCard());
    player.hand.push(...cards);
    player.drewCardId = undefined;
    player.unoCalled = false;
    return cards;
  }

  private reshuffleDiscard(): void {
    if (this.state.discardPile.length <= 1) throw new GameRuleError('The draw pile is exhausted.');
    const top = this.state.discardPile.pop()!;
    this.state.drawPile = shuffle(this.state.discardPile);
    this.state.discardPile = [top];
  }

  private swapHands(sourceId: string, targetId: string): void {
    const source = this.requirePlayer(sourceId);
    const target = this.requirePlayer(targetId);
    if (source.id === target.id) throw new GameRuleError('Choose another player to swap hands with.');
    [source.hand, target.hand] = [target.hand, source.hand];
    source.unoCalled = source.hand.length === 1 && source.unoCalled;
    target.unoCalled = target.hand.length === 1 && target.unoCalled;
  }

  private rotateHands(): void {
    const hands = this.state.players.map((player) => player.hand);
    for (let index = 0; index < this.state.players.length; index++) {
      const from = (index - this.state.direction + this.state.players.length) % this.state.players.length;
      this.state.players[index].hand = hands[from];
      this.state.players[index].unoCalled = false;
    }
  }

  private finishRound(winnerId: string): void {
    const winner = this.requirePlayer(winnerId);
    const points = this.state.players.filter((player) => player.id !== winnerId).reduce((total, player) => total + player.hand.reduce((sum, card) => sum + scoreCard(card), 0), 0);
    winner.score += points;
    this.state.roundWinnerId = winnerId;
    this.state.pendingDraw = undefined;
    if (winner.score >= this.state.targetScore || this.state.round >= this.state.maxRounds) {
      this.state.status = 'match-over';
      this.state.winnerId = [...this.state.players].sort((a, b) => b.score - a.score)[0].id;
    } else {
      this.state.status = 'round-over';
    }
  }

  private currentPlayer(): Player { return this.state.players[this.state.currentPlayerIndex]; }
  private topCard(): Card { return this.state.discardPile[this.state.discardPile.length - 1]; }
  private playerIndex(id: string): number {
    const index = this.state.players.findIndex((player) => player.id === id);
    if (index < 0) throw new GameRuleError('Player is not in this room.');
    return index;
  }
  private requirePlayer(id: string): Player { return this.state.players[this.playerIndex(id)]; }
  private requirePlaying(): void { if (this.state.status !== 'playing') throw new GameRuleError('A round is not currently in progress.'); }
  private advance(steps = 1): void {
    const size = this.state.players.length;
    this.state.currentPlayerIndex = (this.state.currentPlayerIndex + this.state.direction * steps % size + size) % size;
  }
  private bestWildColor(player: Player): Color {
    return [...colors].sort((a, b) => player.hand.filter((card) => card.color === b).length - player.hand.filter((card) => card.color === a).length)[0];
  }
  private metricsFor(playerId: string) {
    const existing = this.state.matchMetrics.get(playerId);
    if (existing) return existing;
    const metrics = { unoCalls: 0, caughtWithoutUno: 0 };
    this.state.matchMetrics.set(playerId, metrics);
    return metrics;
  }
  private recordUnoCall(playerId: string): void { this.metricsFor(playerId).unoCalls += 1; }

  snapshotFor(viewerId?: string) {
    const viewer = this.state.players.find((player) => player.id === viewerId);
    const top = this.topCard();
    return {
      roomId: this.state.roomId,
      status: this.state.status,
      players: this.state.players.map((player) => ({
        id: player.id, username: player.username, avatarUrl: player.avatarUrl, ready: player.ready,
        connected: player.connected, isBot: Boolean(player.isBot), score: player.score, handCount: player.hand.length,
        unoCalled: player.unoCalled, isYou: player.id === viewerId
      })),
      spectatorCount: this.state.spectators.size,
      topCard: top ? { id: top.id, color: top.color, value: top.value } : undefined,
      currentColor: this.state.currentColor,
      currentPlayerId: this.currentPlayer()?.id,
      direction: this.state.direction,
      drawCount: this.state.drawPile.length,
      pendingDraw: this.state.pendingDraw ? { amount: this.state.pendingDraw.amount, type: this.state.pendingDraw.type, sourcePlayerId: this.state.pendingDraw.sourcePlayerId } : undefined,
      targetScore: this.state.targetScore,
      maxRounds: this.state.maxRounds,
      round: this.state.round,
      winnerId: this.state.winnerId,
      roundWinnerId: this.state.roundWinnerId,
      rules: this.state.rules,
      turnDeadline: this.state.turnDeadline,
      chat: this.state.chat,
      hand: viewer?.hand ?? [],
      drewCardId: viewer?.drewCardId,
      isSpectator: Boolean(viewerId && !viewer)
    };
  }
}
