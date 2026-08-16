import 'dotenv/config';

const required = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  sessionSecret: required('SESSION_SECRET', 'development-only-change-me-012345678901234567890'),
  emailEncryptionKey: required('EMAIL_ENCRYPTION_KEY', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  avatarStoragePath: process.env.AVATAR_STORAGE_PATH ?? 'uploads/avatars',
  turnSeconds: Math.max(10, Math.min(120, Number(process.env.TURN_SECONDS ?? 30))),
  production: process.env.NODE_ENV === 'production'
};

if (config.production && config.sessionSecret.includes('development-only')) {
  throw new Error('SESSION_SECRET must be set to a production secret.');
}
