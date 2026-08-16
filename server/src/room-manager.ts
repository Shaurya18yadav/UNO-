import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { GameRuleError, UnoGame } from './game-engine.js';
import { repository, type Repository } from './repository.js';
import { sanitizeText } from './security.js';
import type { HouseRules, SessionUser } from './types.js';
import { config } from './config.js';

type RoomOptions = { isPrivate: boolean; maxPlayers: number; botCount: number; autoStart: boolean; targetScore: number; maxRounds: number; rules: Partial<HouseRules> };
type Room = {
  code: string;
  hostId: string;
  isPrivate: boolean;
  maxPlayers: number;
  game: UnoGame;
  users: Map<string, Set<string>>;
  rematchVotes: Set<string>;
  timer?: NodeJS.Timeout;
  botTimer?: NodeJS.Timeout;
  persisted: boolean;
  createdAt: number;
};

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const reactionSet = new Set(['👍', '😂', '🔥', '👏', '😮', '🎉']);

const makeCode = () => Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
const channel = (code: string) => `room:${code}`;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private chatEvents = new Map<string, number[]>();
  constructor(private io: Server, private db: Repository = repository) {}

  createRoom(creator: SessionUser, options: RoomOptions) {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const game = new UnoGame(code, { targetScore: options.targetScore, maxRounds: options.maxRounds, rules: options.rules });
    game.addPlayer(creator);
    for (let number = 1; number <= options.botCount; number++) {
      game.addPlayer({ id: randomUUID(), username: `UNO Bot ${number}`, isGuest: true, isBot: true });
      game.state.players.at(-1)!.ready = true;
    }
    const room: Room = { code, hostId: creator.id, isPrivate: options.isPrivate, maxPlayers: options.maxPlayers, game, users: new Map(), rematchVotes: new Set(), persisted: false, createdAt: Date.now() };
    this.rooms.set(code, room);
    if (options.autoStart) {
      game.state.players[0].ready = true;
      game.startMatch();
      this.armTimer(room);
      this.armBotTurn(room);
    }
    return this.roomInfo(room);
  }

  join(socket: Socket, user: SessionUser, roomCode: string): void {
    const code = roomCode.trim().toUpperCase();
    const room = this.requireRoom(code);
    const player = room.game.state.players.find((candidate) => candidate.id === user.id);
    if (player) {
      player.connected = true;
      player.username = user.username;
      player.avatarUrl = user.avatarUrl;
    } else if (room.game.state.status === 'waiting') {
      if (room.game.state.players.length >= room.maxPlayers) throw new GameRuleError('This room is full.');
      room.game.addPlayer(user);
    } else {
      room.game.state.spectators.set(user.id, { id: user.id, username: user.username, connected: true });
    }
    if (socket.data.roomCode && socket.data.roomCode !== code) this.detachSocket(socket);
    socket.join(channel(code));
    socket.data.roomCode = code;
    const sockets = room.users.get(user.id) ?? new Set<string>();
    sockets.add(socket.id); room.users.set(user.id, sockets);
    this.publish(room, false);
  }

  disconnect(socket: Socket): void {
    this.detachSocket(socket);
  }

  private detachSocket(socket: Socket): void {
    const code: string | undefined = socket.data.roomCode;
    const user: SessionUser | undefined = socket.data.user;
    if (!code || !user) return;
    const room = this.rooms.get(code);
    if (!room) return;
    socket.leave(channel(code));
    const sockets = room.users.get(user.id);
    sockets?.delete(socket.id);
    if (!sockets?.size) {
      room.users.delete(user.id);
      const player = room.game.state.players.find((candidate) => candidate.id === user.id);
      if (player) player.connected = false;
      const spectator = room.game.state.spectators.get(user.id);
      if (spectator) spectator.connected = false;
      this.publish(room, false);
    }
    socket.data.roomCode = undefined;
  }

  setReady(user: SessionUser, code: string, ready: boolean): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.setReady(user.id, ready);
    this.publish(room, false);
  }

  start(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    if (room.hostId !== user.id) throw new GameRuleError('Only the host can start the match.');
    room.game.startMatch();
    this.publish(room, true);
  }

  play(user: SessionUser, code: string, input: { cardId: string; chosenColor?: 'red' | 'yellow' | 'green' | 'blue'; swapWithPlayerId?: string; callUno?: boolean }): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.play({ playerId: user.id, ...input });
    this.afterGameAction(room);
  }

  draw(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.draw(user.id);
    this.afterGameAction(room);
  }

  pass(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.pass(user.id);
    this.afterGameAction(room);
  }

  acceptPenalty(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.acceptPenalty(user.id);
    this.afterGameAction(room);
  }

  challenge(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.challengeWildDrawFour(user.id);
    this.afterGameAction(room);
  }

  callUno(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.callUno(user.id);
    this.publish(room, false);
  }

  catchUno(user: SessionUser, code: string, targetPlayerId: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    room.game.catchUno(user.id, targetPlayerId);
    this.publish(room, false);
  }

  nextRound(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    if (room.hostId !== user.id) throw new GameRuleError('Only the host can start the next round.');
    room.game.startNextRound();
    this.publish(room, true);
  }

  voteRematch(user: SessionUser, code: string): void {
    const room = this.requirePlayerRoom(code, user.id);
    if (room.game.state.status !== 'match-over') throw new GameRuleError('A rematch is available after the match ends.');
    room.rematchVotes.add(user.id);
    for (const bot of room.game.state.players.filter((player) => player.isBot)) room.rematchVotes.add(bot.id);
    if (room.game.state.players.every((player) => room.rematchVotes.has(player.id))) {
      room.rematchVotes.clear();
      room.persisted = false;
      room.game.prepareRematch();
      room.game.startMatch();
      this.publish(room, true);
      return;
    }
    this.publish(room, false);
  }

  addChat(user: SessionUser, code: string, rawText: string): void {
    const room = this.requireRoom(code);
    if (![...room.game.state.players, ...room.game.state.spectators.values()].some((person) => person.id === user.id)) throw new GameRuleError('Join the room before chatting.');
    this.enforceChatRate(user.id);
    const text = sanitizeText(rawText, 280);
    room.game.state.chat.push({ id: randomUUID(), playerId: user.id, username: user.username, text, createdAt: Date.now(), reactions: {} });
    if (room.game.state.chat.length > 100) room.game.state.chat.shift();
    this.publish(room, false);
  }

  react(user: SessionUser, code: string, messageId: string, emoji: string): void {
    const room = this.requireRoom(code);
    if (!reactionSet.has(emoji)) throw new GameRuleError('Unsupported reaction.');
    const message = room.game.state.chat.find((item) => item.id === messageId);
    if (!message) throw new GameRuleError('Chat message not found.');
    const people = new Set(message.reactions[emoji] ?? []);
    people.has(user.id) ? people.delete(user.id) : people.add(user.id);
    message.reactions[emoji] = [...people];
    this.publish(room, false);
  }

  lobby() { return [...this.rooms.values()].filter((room) => !room.isPrivate && room.game.state.status === 'waiting').map((room) => this.roomInfo(room)); }
  roomInfo(room: Room) { return { code: room.code, isPrivate: room.isPrivate, players: room.game.state.players.length, bots: room.game.state.players.filter((player) => player.isBot).length, maxPlayers: room.maxPlayers, status: room.game.state.status, hostId: room.hostId, host: room.game.state.players.find((player) => player.id === room.hostId)?.username, rules: room.game.state.rules, createdAt: room.createdAt }; }

  private afterGameAction(room: Room): void {
    if (room.game.state.status === 'match-over' && !room.persisted) {
      room.persisted = true;
      void this.db.saveCompletedMatch(room.game.state).catch(() => { room.persisted = false; });
    }
    this.publish(room, true);
  }

  private publish(room: Room, resetTimer: boolean): void {
    if (resetTimer && room.game.state.status === 'playing') { this.armTimer(room); this.armBotTurn(room); }
    if (room.game.state.status !== 'playing') {
      if (room.timer) clearTimeout(room.timer);
      if (room.botTimer) clearTimeout(room.botTimer);
      room.timer = undefined; room.botTimer = undefined; room.game.state.turnDeadline = undefined;
    }
    for (const socketId of this.io.sockets.adapter.rooms.get(channel(room.code)) ?? []) {
      const socket = this.io.sockets.sockets.get(socketId);
      const user: SessionUser | undefined = socket?.data.user;
      if (socket && user) socket.emit('room:state', room.game.snapshotFor(user.id));
    }
    this.io.to(channel(room.code)).emit('room:meta', this.roomInfo(room));
  }

  private armTimer(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.game.state.turnDeadline = Date.now() + config.turnSeconds * 1000;
    room.timer = setTimeout(() => {
      try { room.game.autoPlayTurn(); this.afterGameAction(room); }
      catch { this.publish(room, true); }
    }, config.turnSeconds * 1000);
  }

  private armBotTurn(room: Room): void {
    if (room.botTimer) clearTimeout(room.botTimer);
    const active = room.game.state.players[room.game.state.currentPlayerIndex];
    if (!active?.isBot) { room.botTimer = undefined; return; }
    const botId = active.id;
    room.botTimer = setTimeout(() => {
      const current = room.game.state.players[room.game.state.currentPlayerIndex];
      if (room.game.state.status !== 'playing' || current?.id !== botId || !current.isBot) return;
      try { room.game.autoPlayTurn(); this.afterGameAction(room); }
      catch { this.publish(room, true); }
    }, 650);
  }

  private enforceChatRate(userId: string): void {
    const now = Date.now();
    const entries = (this.chatEvents.get(userId) ?? []).filter((time) => now - time < 10_000);
    if (entries.length >= 5) throw new GameRuleError('Chat rate limit exceeded. Please wait a moment.');
    entries.push(now); this.chatEvents.set(userId, entries);
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) throw new GameRuleError('Room not found.');
    return room;
  }
  private requirePlayerRoom(code: string, userId: string): Room {
    const room = this.requireRoom(code);
    if (!room.game.state.players.some((player) => player.id === userId)) throw new GameRuleError('Spectators cannot take game actions.');
    return room;
  }
}
