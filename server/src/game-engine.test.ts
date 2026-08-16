import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from './deck.js';
import { UnoGame } from './game-engine.js';
import type { Card } from './types.js';

const card = (id: string, color: Card['color'], value: Card['value']): Card => ({ id, color, value });

function twoPlayerGame() {
  const game = new UnoGame('ROOM');
  game.addPlayer({ id: 'a', username: 'A', isGuest: true });
  game.addPlayer({ id: 'b', username: 'B', isGuest: true });
  game.setReady('a', true); game.setReady('b', true); game.startMatch();
  game.state.drawPile = Array.from({ length: 20 }, (_, index) => card(`draw-${index}`, 'blue', '1'));
  game.state.discardPile = [card('top', 'red', '5')];
  game.state.currentColor = 'red'; game.state.currentPlayerIndex = 0;
  return game;
}

test('creates the standard 108-card deck', () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(deck.filter((card) => card.value === 'wild4').length, 4);
});

test('deals seven cards and keeps hands private in snapshots', () => {
  const game = new UnoGame('ROOM');
  game.addPlayer({ id: 'a', username: 'A', isGuest: true });
  game.addPlayer({ id: 'b', username: 'B', isGuest: true });
  game.setReady('a', true); game.setReady('b', true); game.startMatch();
  assert.equal(game.state.players[0].hand.length, 7);
  const snapshot = game.snapshotFor('a');
  assert.equal(snapshot.hand.length, 7);
  assert.equal(snapshot.players.find((player) => player.id === 'b')?.handCount, 7);
  assert.equal('hand' in (snapshot.players.find((player) => player.id === 'b') ?? {}), false);
});

test('rejects an opponent trying to play out of turn', () => {
  const game = new UnoGame('ROOM');
  game.addPlayer({ id: 'a', username: 'A', isGuest: true });
  game.addPlayer({ id: 'b', username: 'B', isGuest: true });
  game.setReady('a', true); game.setReady('b', true); game.startMatch();
  assert.throws(() => game.play({ playerId: 'b', cardId: game.state.players[1].hand[0].id }), /not your turn|cannot be played/);
});

test('a successful Wild Draw Four challenge penalizes the offender and preserves challenger turn', () => {
  const game = twoPlayerGame();
  game.state.players[0].hand = [card('wild4', null, 'wild4'), card('held-red', 'red', '9')];
  game.state.players[1].hand = [card('other', 'green', '3')];
  game.play({ playerId: 'a', cardId: 'wild4', chosenColor: 'blue' });
  assert.equal(game.state.pendingDraw?.amount, 4);
  const result = game.challengeWildDrawFour('b');
  assert.equal(result.success, true);
  assert.equal(game.state.players[0].hand.length, 5);
  assert.equal(game.state.players[1].hand.length, 1);
  assert.equal(game.state.players[game.state.currentPlayerIndex].id, 'b');
});

test('catching an uncalled UNO draws two cards for that player', () => {
  const game = twoPlayerGame();
  game.state.players[0].hand = [card('red-five', 'red', '5'), card('blue-nine', 'blue', '9')];
  game.state.players[1].hand = [card('other', 'green', '3')];
  game.play({ playerId: 'a', cardId: 'red-five' });
  assert.equal(game.state.players[0].hand.length, 1);
  assert.equal(game.state.players[0].unoCalled, false);
  const penalty = game.catchUno('b', 'a');
  assert.equal(penalty.length, 2);
  assert.equal(game.state.players[0].hand.length, 3);
});
