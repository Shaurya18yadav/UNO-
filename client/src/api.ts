import type { Friend, MatchSummary, Profile, PublicProfile, RoomMeta, User } from './types';

const root = import.meta.env.VITE_API_URL ?? '';
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${root}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? 'Request failed.'); }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  guest: (username?: string) => request<{ user: User }>('/api/auth/guest', { method: 'POST', body: JSON.stringify({ username }) }),
  signup: (body: { username: string; email: string; password: string; avatarUrl?: string; avatarPreset?: string }) => request<{ user: User }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) => request<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  createRoom: (body: unknown) => request<{ room: RoomMeta; inviteUrl: string }>('/api/rooms', { method: 'POST', body: JSON.stringify(body) }),
  lobby: () => request<{ rooms: RoomMeta[] }>('/api/lobby'),
  leaderboard: () => request<{ players: { id: string; username: string; avatarUrl?: string; avatarPreset?: string; wins: number; losses: number; rating: number }[] }>('/api/leaderboard'),
  history: () => request<{ matches: MatchSummary[] }>('/api/history'),
  report: (body: unknown) => request<{ ok: true }>('/api/reports', { method: 'POST', body: JSON.stringify(body) }),
  
  // Profile & Account APIs
  getProfile: () => request<{ profile: Profile }>('/api/profile/me'),
  updateProfile: (body: unknown) => request<{ profile: Profile; user: User }>('/api/profile/me', { method: 'PATCH', body: JSON.stringify(body) }),
  uploadAvatar: async (file: File): Promise<{ avatarUrl: string; user: User }> => {
    const response = await fetch(`${root}/api/profile/avatar`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? 'Avatar upload failed.');
    }
    return response.json();
  },
  getPublicProfile: (username: string) => request<{ profile: PublicProfile }>(`/api/profile/public/${encodeURIComponent(username)}`),
  friends: () => request<{ friends: Friend[] }>('/api/friends'),
  addFriend: (username: string) => request<{ ok: true }>('/api/friends', { method: 'POST', body: JSON.stringify({ username }) }),
  removeFriend: (username: string) => request<{ ok: true }>(`/api/friends/${encodeURIComponent(username)}`, { method: 'DELETE' }),
  updateCredentials: (body: unknown) => request<{ ok: true }>('/api/account/credentials', { method: 'PATCH', body: JSON.stringify(body) }),
  convertGuest: (body: unknown) => request<{ user: User }>('/api/account/convert-guest', { method: 'POST', body: JSON.stringify(body) }),
  oauthLogin: (provider: 'google' | 'discord') => request<{ user: User }>('/api/auth/oauth-login', { method: 'POST', body: JSON.stringify({ provider }) }),
  convertOAuth: (provider: 'google' | 'discord') => request<{ user: User }>('/api/account/convert-oauth', { method: 'POST', body: JSON.stringify({ provider }) }),
  logoutAll: () => request<void>('/api/account/logout-all', { method: 'POST' }),
  exportData: () => `${root}/api/account/export`,
  deleteAccount: () => request<void>('/api/account/me', { method: 'DELETE' })
};

