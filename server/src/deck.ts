import { randomUUID } from 'node:crypto';
import type { Card, CardValue, Color } from './types.js';

const colors: Color[] = ['red', 'yellow', 'green', 'blue'];
const numbered: CardValue[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function createDeck(): Card[] {
  const cards: Card[] = [];
  const add = (color: Color | null, value: CardValue) => cards.push({ id: randomUUID(), color, value });
  for (const color of colors) {
    add(color, '0');
    for (const value of numbered.slice(1)) { add(color, value); add(color, value); }
    for (const value of ['skip', 'reverse', 'draw2'] as CardValue[]) { add(color, value); add(color, value); }
  }
  for (let i = 0; i < 4; i++) { add(null, 'wild'); add(null, 'wild4'); }
  return cards;
}

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const isWild = (card: Card) => card.value === 'wild' || card.value === 'wild4';

export function scoreCard(card: Card): number {
  if (/^[0-9]$/.test(card.value)) return Number(card.value);
  if (card.value === 'wild' || card.value === 'wild4') return 50;
  return 20;
}
