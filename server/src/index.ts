import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { Server } from 'socket.io';
import { ZodError, z } from 'zod';
import { config } from './config.js';
import { RoomManager } from './room-manager.js';
import { repository } from './repository.js';
import { avatarUploadLimit, loadAvatar, saveAvatar } from './avatar-storage.js';
import { clearSession, encryptSensitive, hashEmail, newGuestUsername, randomPresetAvatar, requireSession, sanitizeText, sanitizeUsername, sessionFromRequest, setSession, verifySession } from './security.js';
import { codeSchema, convertGuestSchema, friendSchema, guestSchema, loginSchema, reportSchema, roomOptionsSchema, signupSchema, socketSchemas, updateCredentialsSchema, updateProfileSchema } from './validation.js';
import { GameRuleError } from './game-engine.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((request, response, next) => {
  if (config.production && request.header('x-forwarded-proto') !== 'https') return response.redirect(308, `https://${request.header('host')}${request.originalUrl}`);
  next();
});
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'", config.clientOrigin], imgSrc: ["'self'", 'data:', 'https:'], styleSrc: ["'self'", "'unsafe-inline'"] } },
  hsts: config.production ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));
app.use(cors({ origin: config.clientOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '16kb', type: 'application/json' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
const guestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many guest sessions created. Try again later.' } });
const roomLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Room creation limit reached. Try later.' } });
const profileLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many profile updates. Slow down.' } });
const avatarLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Avatar upload limit reached. Try later.' } });

app.get('/api/health', (_request, response) => response.json({ ok: true }));
app.post('/api/auth/guest', guestLimiter, (request, response, next) => {
  try {
    const body = guestSchema.parse(request.body);
    const username = body.username ? sanitizeUsername(body.username) : newGuestUsername();
    const avatarPreset = body.avatarPreset || randomPresetAvatar();
    const user = { id: randomUUID(), username, isGuest: true, avatarPreset };
    setSession(response, user);
    response.status(201).json({ user });
  } catch (error) { next(error); }
});
app.post('/api/auth/signup', authLimiter, async (request, response, next) => {
  try {
    const body = signupSchema.parse(request.body);
    const user = { id: randomUUID(), username: sanitizeUsername(body.username), isGuest: false, avatarUrl: body.avatarUrl, avatarPreset: body.avatarPreset || randomPresetAvatar() };
    await repository.createAccount({ ...user, emailCiphertext: encryptSensitive(body.email.trim().toLowerCase()), emailHash: hashEmail(body.email), passwordHash: await bcrypt.hash(body.password, 12), createdAt: new Date().toISOString() });
    setSession(response, user);
    response.status(201).json({ user });
  } catch (error) { next(error); }
});
app.post('/api/auth/login', authLimiter, async (request, response, next) => {
  try {
    const body = loginSchema.parse(request.body);
    const account = await repository.findAccountByEmailHash(hashEmail(body.email));
    if (!account || !(await bcrypt.compare(body.password, account.passwordHash))) return response.status(401).json({ error: 'Invalid email or password.' });
    const user = { id: account.id, username: account.username, isGuest: false, avatarUrl: account.avatarUrl, avatarPreset: account.avatarPreset, sessionVersion: account.sessionVersion };
    setSession(response, user);
    response.json({ user });
  } catch (error) { next(error); }
});
app.post('/api/auth/oauth-login', authLimiter, async (request, response, next) => {
  try {
    const provider = request.body.provider === 'discord' ? 'Discord' : 'Google';
    const username = `${provider}User-${Math.floor(1000 + Math.random() * 9000)}`;
    const user = { id: randomUUID(), username, isGuest: false, avatarPreset: randomPresetAvatar() };
    await repository.createAccount({
      ...user,
      emailCiphertext: encryptSensitive(`${username.toLowerCase()}@oauth.local`),
      emailHash: hashEmail(`${username.toLowerCase()}@oauth.local`),
      passwordHash: await bcrypt.hash('OAuthGeneratedPassword#123', 12),
      createdAt: new Date().toISOString()
    });
    setSession(response, user);
    response.status(201).json({ user });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', (request, response) => { clearSession(response); response.status(204).end(); });
app.get('/api/auth/me', async (request, response) => {
  const user = sessionFromRequest(request);
  if (!user) return response.status(401).json({ error: 'No active session.' });
  if (!user.isGuest && user.sessionVersion !== undefined) {
    const isCurrent = await repository.isSessionVersionCurrent(user.id, user.sessionVersion);
    if (!isCurrent) { clearSession(response); return response.status(401).json({ error: 'Session expired.' }); }
  }
  response.json({ user });
});

app.get('/api/avatars/:file', async (request, response) => {
  const loaded = await loadAvatar(request.params.file);
  if (!loaded) return response.status(404).end();
  response.setHeader('Content-Type', loaded.mime);
  response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  response.send(loaded.buffer);
});

app.get('/api/profile/me', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) {
      return response.json({
        profile: {
          username: user.username,
          avatarUrl: user.avatarUrl,
          avatarPreset: user.avatarPreset,
          bio: 'Guest Player',
          country: '',
          stats: { gamesPlayed: 0, wins: 0, losses: 0, winRate: 0, currentStreak: 0, longestStreak: 0, unoCalls: 0, caughtWithoutUno: 0 },
          preferences: { notifications: true, sound: true, theme: 'midnight' },
          achievements: [],
          createdAt: new Date().toISOString()
        }
      });
    }
    const profile = await repository.getProfile(user.id);
    if (!profile) return response.status(404).json({ error: 'Profile not found.' });
    response.json({ profile });
  } catch (error) { next(error); }
});

app.patch('/api/profile/me', profileLimiter, async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to edit your profile.' });
    const body = updateProfileSchema.parse(request.body);
    const cleanUsername = sanitizeUsername(body.username);
    const cleanBio = body.bio ? sanitizeText(body.bio, 200) : undefined;
    const cleanCountry = body.country ? sanitizeText(body.country, 8).toUpperCase() : undefined;
    const updated = await repository.updateProfile(user.id, {
      username: cleanUsername,
      bio: cleanBio,
      country: cleanCountry,
      avatarUrl: body.avatarUrl,
      avatarPreset: body.avatarPreset,
      preferences: body.preferences
    });
    const updatedUser = { id: updated.id, username: updated.username, isGuest: false, avatarUrl: updated.avatarUrl, avatarPreset: updated.avatarPreset, sessionVersion: updated.sessionVersion };
    setSession(response, updatedUser);
    response.json({ profile: await repository.getProfile(user.id), user: updatedUser });
  } catch (error) { next(error); }
});

app.post('/api/profile/avatar', avatarLimiter, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: avatarUploadLimit }), async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to upload custom avatars.' });
    if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ error: 'Provide a valid PNG, JPEG, or WebP image under 1 MB.' });
    const avatarUrl = await saveAvatar(request.body, request.headers['content-type'] as string | undefined);
    const updated = await repository.updateProfile(user.id, { username: user.username, avatarUrl, avatarPreset: '' });
    const updatedUser = { id: updated.id, username: updated.username, isGuest: false, avatarUrl: updated.avatarUrl, avatarPreset: updated.avatarPreset, sessionVersion: updated.sessionVersion };
    setSession(response, updatedUser);
    response.json({ avatarUrl, user: updatedUser });
  } catch (error) { next(error); }
});

app.get('/api/profile/public/:username', async (request, response, next) => {
  try {
    const cleanName = sanitizeUsername(request.params.username);
    const profile = await repository.getPublicProfile(cleanName);
    if (!profile) return response.status(404).json({ error: 'Player not found.' });
    response.json({ profile });
  } catch (error) { next(error); }
});

app.get('/api/friends', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to view friends.' });
    const list = await repository.friends(user.id);
    const withStatus = list.map((f) => ({ ...f, isOnline: onlineUserIds.has(f.id) }));
    response.json({ friends: withStatus });
  } catch (error) { next(error); }
});

app.post('/api/friends', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to add friends.' });
    const { username } = friendSchema.parse(request.body);
    await repository.addFriend(user.id, username);
    response.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/friends/:username', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to manage friends.' });
    const username = sanitizeUsername(request.params.username);
    await repository.removeFriend(user.id, username);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.patch('/api/account/credentials', authLimiter, async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Guests cannot change credentials.' });
    const body = updateCredentialsSchema.parse(request.body);
    const account = await repository.findAccountById(user.id);
    if (!account || !(await bcrypt.compare(body.currentPassword, account.passwordHash))) return response.status(401).json({ error: 'Current password is incorrect.' });
    const updates: { emailCiphertext?: string; emailHash?: string; passwordHash?: string } = {};
    if (body.newEmail) {
      const email = body.newEmail.trim().toLowerCase();
      updates.emailCiphertext = encryptSensitive(email);
      updates.emailHash = hashEmail(email);
    }
    if (body.newPassword) updates.passwordHash = await bcrypt.hash(body.newPassword, 12);
    await repository.updateCredentials(user.id, updates);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/account/convert-guest', authLimiter, async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (!user.isGuest) return response.status(400).json({ error: 'Account is already registered.' });
    const body = convertGuestSchema.parse(request.body);
    const cleanUsername = sanitizeUsername(body.username);
    const cleanBio = body.bio ? sanitizeText(body.bio, 200) : undefined;
    const cleanCountry = body.country ? sanitizeText(body.country, 8).toUpperCase() : undefined;
    const newAccount = {
      id: user.id,
      username: cleanUsername,
      isGuest: false,
      avatarUrl: body.avatarUrl,
      avatarPreset: body.avatarPreset,
      bio: cleanBio,
      country: cleanCountry,
      emailCiphertext: encryptSensitive(body.email.trim().toLowerCase()),
      emailHash: hashEmail(body.email),
      passwordHash: await bcrypt.hash(body.password, 12),
      createdAt: new Date().toISOString(),
      sessionVersion: 0
    };
    await repository.createAccount(newAccount);
    const convertedUser = { id: newAccount.id, username: newAccount.username, isGuest: false, avatarUrl: newAccount.avatarUrl, avatarPreset: newAccount.avatarPreset, sessionVersion: 0 };
    setSession(response, convertedUser);
    response.status(201).json({ user: convertedUser });
  } catch (error) { next(error); }
});

app.post('/api/account/convert-oauth', authLimiter, async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (!user.isGuest) return response.status(400).json({ error: 'Account is already registered.' });
    const provider = request.body.provider === 'discord' ? 'Discord' : 'Google';
    const username = `${provider}User-${Math.floor(1000 + Math.random() * 9000)}`;
    const newAccount = {
      id: user.id,
      username,
      isGuest: false,
      avatarPreset: user.avatarPreset || randomPresetAvatar(),
      emailCiphertext: encryptSensitive(`${username.toLowerCase()}@oauth.local`),
      emailHash: hashEmail(`${username.toLowerCase()}@oauth.local`),
      passwordHash: await bcrypt.hash('OAuthConvertedPassword#123', 12),
      createdAt: new Date().toISOString(),
      sessionVersion: 0
    };
    await repository.createAccount(newAccount);
    const convertedUser = { id: newAccount.id, username: newAccount.username, isGuest: false, avatarPreset: newAccount.avatarPreset, sessionVersion: 0 };
    setSession(response, convertedUser);
    response.status(201).json({ user: convertedUser });
  } catch (error) { next(error); }
});

app.post('/api/account/logout-all', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (!user.isGuest) await repository.bumpSessionVersion(user.id);
    clearSession(response);
    response.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/account/export', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to export data.' });
    const data = await repository.exportData(user.id);
    if (!data) return response.status(404).json({ error: 'Data not found.' });
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Content-Disposition', `attachment; filename="uno_profile_${user.username}.json"`);
    response.json(data);
  } catch (error) { next(error); }
});

app.delete('/api/account/me', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (!user.isGuest) await repository.deleteAccount(user.id);
    clearSession(response);
    response.status(204).end();
  } catch (error) { next(error); }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: config.clientOrigin, credentials: true, methods: ['GET', 'POST'] }, transports: ['websocket', 'polling'] });
const rooms = new RoomManager(io);
const onlineUserIds = new Map<string, number>();

app.get('/api/lobby', (_request, response) => response.json({ rooms: rooms.lobby() }));
app.post('/api/rooms', roomLimiter, (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    const options = roomOptionsSchema.parse(request.body ?? {});
    const room = rooms.createRoom(user, options);
    response.status(201).json({ room, inviteUrl: `${config.clientOrigin}/room/${room.code}` });
  } catch (error) { next(error); }
});
app.get('/api/leaderboard', async (request, response, next) => {
  try { const limit = z.coerce.number().int().min(1).max(100).catch(20).parse(request.query.limit); response.json({ players: await repository.leaderboard(limit) }); }
  catch (error) { next(error); }
});
app.get('/api/history', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    if (user.isGuest) return response.status(403).json({ error: 'Create an account to save match history.' });
    response.json({ matches: await repository.history(user.id, 50) });
  } catch (error) { next(error); }
});
app.post('/api/reports', async (request, response, next) => {
  try {
    const user = requireSession(request, response); if (!user) return;
    const body = reportSchema.parse(request.body);
    await repository.createReport({ reporterId: user.id, category: body.category, details: sanitizeText(body.details, 2000), roomCode: body.roomCode });
    response.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

io.use((socket, next) => {
  const user = verifySession(socket.handshake.headers.cookie?.split('; ').find((part) => part.startsWith('uno_session='))?.slice('uno_session='.length));
  if (!user) return next(new Error('AUTH_REQUIRED'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  onlineUserIds.set(user.id, (onlineUserIds.get(user.id) ?? 0) + 1);
  socket.emit('session:ready', { user });
  const roomCode = () => socket.data.roomCode as string | undefined;
  const action = <T>(event: string, schema: z.ZodType<T>, handler: (data: T, code: string) => void) => socket.on(event, (payload: unknown, ack?: (value: unknown) => void) => {
    try {
      const data = schema.parse(payload ?? {});
      const code = roomCode();
      if (!code) throw new GameRuleError('Join a room first.');
      handler(data, code);
      ack?.({ ok: true });
    } catch (error) {
      const message = safeError(error);
      socket.emit('action:error', { event, message });
      ack?.({ ok: false, error: message });
    }
  });
  socket.on('room:join', (payload: unknown, ack?: (value: unknown) => void) => {
    try { const { code } = socketSchemas.join.parse(payload); rooms.join(socket, user, code); ack?.({ ok: true }); }
    catch (error) { const message = safeError(error); socket.emit('action:error', { event: 'room:join', message }); ack?.({ ok: false, error: message }); }
  });
  action('room:ready', socketSchemas.ready, ({ ready }, code) => rooms.setReady(user, code, ready));
  action('game:start', z.object({}), (_data, code) => rooms.start(user, code));
  action('game:play', socketSchemas.play, (data, code) => rooms.play(user, code, data));
  action('game:draw', z.object({}), (_data, code) => rooms.draw(user, code));
  action('game:pass', z.object({}), (_data, code) => rooms.pass(user, code));
  action('game:accept-penalty', z.object({}), (_data, code) => rooms.acceptPenalty(user, code));
  action('game:challenge-wild4', z.object({}), (_data, code) => rooms.challenge(user, code));
  action('game:call-uno', z.object({}), (_data, code) => rooms.callUno(user, code));
  action('game:catch-uno', socketSchemas.catchUno, ({ targetPlayerId }, code) => rooms.catchUno(user, code, targetPlayerId));
  action('round:next', z.object({}), (_data, code) => rooms.nextRound(user, code));
  action('match:rematch', z.object({}), (_data, code) => rooms.voteRematch(user, code));
  action('chat:send', socketSchemas.chat, ({ text }, code) => rooms.addChat(user, code, text));
  action('chat:react', socketSchemas.react, ({ messageId, emoji }, code) => rooms.react(user, code, messageId, emoji));
  socket.on('disconnect', () => {
    const count = (onlineUserIds.get(user.id) ?? 1) - 1;
    if (count <= 0) onlineUserIds.delete(user.id);
    else onlineUserIds.set(user.id, count);
    rooms.disconnect(socket);
  });
});

function safeError(error: unknown): string {
  if (error instanceof GameRuleError || error instanceof ZodError) return error instanceof ZodError ? 'Invalid request.' : error.message;
  if (error instanceof Error && /username|account|email|password/i.test(error.message)) return error.message;
  return 'The request could not be completed.';
}
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (response.headersSent) return;
  const status = error instanceof ZodError ? 400 : error instanceof Error && /already exists/i.test(error.message) ? 409 : 400;
  response.status(status).json({ error: safeError(error) });
});

server.listen(config.port, () => console.log(`UNO server listening on port ${config.port}`));
const shutdown = async () => { await repository.close(); io.close(); server.close(); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);

