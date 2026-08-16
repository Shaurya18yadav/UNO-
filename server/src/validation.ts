import { z } from 'zod';

export const roomOptionsSchema = z.object({
  isPrivate: z.boolean().default(true),
  maxPlayers: z.number().int().min(2).max(10).default(2),
  botCount: z.number().int().min(0).max(9).default(0),
  autoStart: z.boolean().default(false),
  targetScore: z.number().int().min(50).max(1000).default(500),
  maxRounds: z.number().int().min(1).max(20).default(5),
  rules: z.object({ stacking: z.boolean().optional(), sevenZero: z.boolean().optional(), jumpIn: z.boolean().optional() }).default({})
}).refine((options) => options.botCount <= options.maxPlayers - 1, { message: 'Leave at least one seat for the host.', path: ['botCount'] })
  .refine((options) => !options.autoStart || options.botCount > 0, { message: 'Quick start is only available for bot matches.', path: ['autoStart'] });
export const guestSchema = z.object({ username: z.string().max(24).optional(), avatarPreset: z.string().max(32).optional() });
export const signupSchema = z.object({ username: z.string().min(1).max(24), email: z.string().email().max(254), password: z.string().min(10).max(72), avatarUrl: z.string().url().max(500).refine((value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } }, 'Avatar URL must use HTTPS.').optional(), avatarPreset: z.string().max(32).optional() });
export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(72) });
export const reportSchema = z.object({ category: z.enum(['bug', 'abuse', 'cheating', 'other']), details: z.string().min(1).max(2000), roomCode: z.string().regex(/^[A-Z2-9]{6}$/).optional() });
export const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);

export const updateProfileSchema = z.object({
  username: z.string().min(1).max(24),
  bio: z.string().max(200).optional().or(z.literal('')),
  country: z.string().max(8).optional().or(z.literal('')),
  avatarUrl: z.string().max(500).optional().or(z.literal('')),
  avatarPreset: z.string().max(32).optional().or(z.literal('')),
  preferences: z.object({
    notifications: z.boolean().default(true),
    sound: z.boolean().default(true),
    theme: z.enum(['midnight', 'table', 'cyber']).default('midnight')
  }).optional()
});

export const updateCredentialsSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newEmail: z.string().email().max(254).optional(),
  newPassword: z.string().min(10).max(72).optional()
}).refine((data) => data.newEmail || data.newPassword, { message: 'Provide either a new email or a new password.' });

export const convertGuestSchema = z.object({
  username: z.string().min(1).max(24),
  email: z.string().email().max(254),
  password: z.string().min(10).max(72),
  bio: z.string().max(200).optional(),
  country: z.string().max(8).optional(),
  avatarUrl: z.string().max(500).optional(),
  avatarPreset: z.string().max(32).optional()
});

export const friendSchema = z.object({ username: z.string().min(1).max(24) });

export const socketSchemas = {
  join: z.object({ code: codeSchema }),
  ready: z.object({ ready: z.boolean() }),
  play: z.object({ cardId: z.string().uuid(), chosenColor: z.enum(['red', 'yellow', 'green', 'blue']).optional(), swapWithPlayerId: z.string().uuid().optional(), callUno: z.boolean().optional() }),
  catchUno: z.object({ targetPlayerId: z.string().uuid() }),
  chat: z.object({ text: z.string().min(1).max(280) }),
  react: z.object({ messageId: z.string().uuid(), emoji: z.string().max(4) })
};

