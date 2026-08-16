import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const MAX_AVATAR_BYTES = 1_000_000;
const avatarDir = config.avatarStoragePath;

type ImageKind = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; extension: 'png' | 'jpg' | 'webp' };

function identifyImage(buffer: Buffer): ImageKind | undefined {
  if (buffer.length < 12 || buffer.length > MAX_AVATAR_BYTES) return undefined;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return undefined;
}

export async function saveAvatar(buffer: Buffer, declaredMime: string | undefined): Promise<string> {
  const image = identifyImage(buffer);
  if (!image || (declaredMime && declaredMime !== image.mime)) throw new Error('Use a PNG, JPEG, or WebP image smaller than 1 MB.');
  await mkdir(avatarDir, { recursive: true });
  const fileName = `${randomUUID()}.${image.extension}`;
  await writeFile(path.join(avatarDir, fileName), buffer, { flag: 'wx' });
  return `/api/avatars/${fileName}`;
}

export async function loadAvatar(fileName: string): Promise<{ buffer: Buffer; mime: string } | undefined> {
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(fileName)) return undefined;
  try {
    const buffer = await readFile(path.join(avatarDir, fileName));
    const image = identifyImage(buffer);
    return image ? { buffer, mime: image.mime } : undefined;
  } catch { return undefined; }
}

export const avatarUploadLimit = MAX_AVATAR_BYTES;
