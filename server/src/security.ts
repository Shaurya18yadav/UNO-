import { createCipheriv, createDecipheriv, createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import sanitizeHtml from 'sanitize-html';
import type { Request, Response } from 'express';
import { parse } from 'cookie';
import { config } from './config.js';
import type { SessionUser } from './types.js';

const COOKIE_NAME = 'uno_session';

export function sanitizeText(value: string, max: number): string {
  const clean = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!clean || clean.length > max) throw new Error(`Must be between 1 and ${max} characters.`);
  return clean;
}

export function sanitizeUsername(value: string): string {
  const clean = sanitizeText(value, 24);
  if (!/^[\p{L}\p{N}_ .-]+$/u.test(clean)) throw new Error('Username contains unsupported characters.');
  return clean;
}

export function newGuestUsername(): string {
  const adjs = ['Lucky', 'Wild', 'Super', 'Hyper', 'Cosmic', 'Mega', 'Swift', 'Bold', 'Golden', 'Apex'];
  const nouns = ['Deck', 'Card', 'UNO', 'Ace', 'Player', 'Rider', 'Flame', 'Spark', 'Viper', 'Hero'];
  const adj = adjs[Math.floor(Math.random() * adjs.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function randomPresetAvatar(): string {
  const presets = ['red_dragon', 'blue_bot', 'wild_crown', 'star_master', 'gold_uno', 'fire_cards', 'shield_hero', 'cosmic_star'];
  return presets[Math.floor(Math.random() * presets.length)];
}

export function signSession(user: SessionUser): string {
  return jwt.sign({ username: user.username, isGuest: user.isGuest, avatarUrl: user.avatarUrl, avatarPreset: user.avatarPreset, sessionVersion: user.sessionVersion ?? 0 }, config.sessionSecret, {
    subject: user.id, expiresIn: user.isGuest ? '48h' : '7d', issuer: 'uno-realtime', audience: 'uno-client'
  });
}

export function verifySession(token?: string): SessionUser | undefined {
  if (!token) return undefined;
  try {
    const payload = jwt.verify(token, config.sessionSecret, { issuer: 'uno-realtime', audience: 'uno-client' }) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.username !== 'string' || typeof payload.isGuest !== 'boolean') return undefined;
    return {
      id: payload.sub,
      username: payload.username,
      isGuest: payload.isGuest,
      avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
      avatarPreset: typeof payload.avatarPreset === 'string' ? payload.avatarPreset : undefined,
      sessionVersion: typeof payload.sessionVersion === 'number' ? payload.sessionVersion : undefined
    };
  } catch { return undefined; }
}

export function sessionFromRequest(request: Request): SessionUser | undefined {
  return verifySession(parse(request.headers.cookie ?? '')[COOKIE_NAME]);
}

export function requireSession(request: Request, response: Response): SessionUser | undefined {
  const user = sessionFromRequest(request);
  if (!user) { response.status(401).json({ error: 'Authentication required.' }); return undefined; }
  return user;
}

export function setSession(response: Response, user: SessionUser): void {
  response.cookie(COOKIE_NAME, signSession(user), {
    httpOnly: true, secure: config.production, sameSite: 'strict', path: '/', maxAge: user.isGuest ? 48 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  });
}

export function clearSession(response: Response): void {
  response.clearCookie(COOKIE_NAME, { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/' });
}

export function hashEmail(email: string): string { return createHmac('sha256', config.sessionSecret).update(email.trim().toLowerCase()).digest('hex'); }

function encryptionKey(): Buffer {
  const key = Buffer.from(config.emailEncryptionKey, 'hex');
  if (key.length !== 32) throw new Error('EMAIL_ENCRYPTION_KEY must be a 64-character hexadecimal AES-256 key.');
  return key;
}

export function encryptSensitive(value: string): string {
  const iv = Buffer.from(randomUUID().replace(/-/g, '').slice(0, 24), 'hex');
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSensitive(value: string): string {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, 'base64')), decipher.final()]).toString('utf8');
}
