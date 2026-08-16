import { FormEvent, useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';
import type { Card, Color, Friend, GameSnapshot, MatchSummary, Profile, PublicProfile, RoomMeta, User } from './types';

const socketUrl = import.meta.env.VITE_API_URL || undefined;

export const AVATAR_PRESETS: Record<string, { label: string; emoji: string }> = {
  red_dragon: { label: 'Red Dragon', emoji: '🐲' },
  blue_bot: { label: 'Blue Bot', emoji: '🤖' },
  wild_crown: { label: 'Wild Crown', emoji: '👑' },
  star_master: { label: 'Star Master', emoji: '⭐' },
  gold_uno: { label: 'Gold Card', emoji: '🃏' },
  fire_cards: { label: 'Fire Cards', emoji: '🔥' },
  shield_hero: { label: 'Shield Hero', emoji: '🛡️' },
  cosmic_star: { label: 'Cosmic Pilot', emoji: '🚀' }
};

export const COUNTRIES: Record<string, { name: string; flag: string }> = {
  US: { name: 'United States', flag: '🇺🇸' },
  CA: { name: 'Canada', flag: '🇨🇦' },
  GB: { name: 'United Kingdom', flag: '🇬🇧' },
  IN: { name: 'India', flag: '🇮🇳' },
  DE: { name: 'Germany', flag: '🇩🇪' },
  JP: { name: 'Japan', flag: '🇯🇵' },
  BR: { name: 'Brazil', flag: '🇧🇷' },
  AU: { name: 'Australia', flag: '🇦🇺' },
  FR: { name: 'France', flag: '🇫🇷' },
  ES: { name: 'Spain', flag: '🇪🇸' },
  MX: { name: 'Mexico', flag: '🇲🇽' },
  IT: { name: 'Italy', flag: '🇮🇹' }
};

export const ALL_ACHIEVEMENTS = [
  { title: 'First Win', description: 'Win your first UNO match', emoji: '🏆' },
  { title: 'Hot Streak', description: 'Reach a 3-match win streak', emoji: '🔥' },
  { title: 'Unstoppable', description: 'Reach a 5-match win streak', emoji: '⚡' },
  { title: 'UNO Master', description: 'Call UNO 10 times in matches', emoji: '🃏' },
  { title: 'Table Regular', description: 'Play 25 total matches', emoji: '🎲' },
  { title: 'Hawk Eye', description: 'Catch 3 opponents who forgot UNO', emoji: '🦅' },
  { title: 'Century Club', description: 'Play 100 total matches', emoji: '💯' }
];

function AvatarDisplay({ url, preset, username, size = 'medium', onClick }: { url?: string; preset?: string; username: string; size?: 'small' | 'medium' | 'large'; onClick?: () => void }) {
  const presetEmoji = preset && AVATAR_PRESETS[preset] ? AVATAR_PRESETS[preset].emoji : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`avatar avatar-${size} ${onClick ? 'interactive' : ''}`}
      aria-label={`${username}'s avatar`}
    >
      {url ? (
        <img src={url} alt={username} />
      ) : presetEmoji ? (
        <span className="preset-emoji">{presetEmoji}</span>
      ) : (
        <span>{username.slice(0, 1).toUpperCase()}</span>
      )}
    </button>
  );
}

function CardView({ card, faceDown = false, active = false, onClick }: { card?: Card; faceDown?: boolean; active?: boolean; onClick?: () => void }) {
  if (faceDown) return <button onClick={onClick} className="uno-card card-back" aria-label="Face-down card" disabled={!onClick} />;
  if (!card) return <div className="uno-card empty-card">?</div>;
  const label = card.value === 'skip' ? '⊘' : card.value === 'reverse' ? '↺' : card.value === 'draw2' ? '+2' : card.value === 'wild4' ? '+4' : card.value === 'wild' ? 'W' : card.value;
  const palette = card.color ?? 'wild';
  return <button onClick={onClick} className={`uno-card ${palette} ${active ? 'active-card' : ''}`} aria-label={`${card.color ?? 'wild'} ${card.value}`}><span>{label}</span><i>{label}</i></button>;
}

function AuthPanel({ onDone }: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); const data = new FormData(event.currentTarget);
    try {
      const result = mode === 'login'
        ? await api.login({ email: String(data.get('email')), password: String(data.get('password')) })
        : await api.signup({ username: String(data.get('username')), email: String(data.get('email')), password: String(data.get('password')), avatarUrl: String(data.get('avatarUrl') || '') || undefined });
      onDone(result.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to authenticate.'); }
  };

  const playAsGuest = async () => {
    setError('');
    try {
      const result = await api.guest();
      onDone(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Guest session creation failed.');
    }
  };

  const handleOAuth = async (provider: 'google' | 'discord') => {
    setError('');
    try {
      const result = await api.oauthLogin(provider);
      onDone(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'OAuth sign-in failed.');
    }
  };

  return (
    <div className="panel form-stack">
      <button type="button" className="primary big width-full guest-cta-btn" onClick={playAsGuest}>
        ⚡ Play Instantly as Guest
      </button>

      <div className="divider-line"><span>OR SIGN IN WITH ACCOUNT</span></div>

      <div className="oauth-row">
        <button type="button" className="secondary oauth-btn" onClick={() => handleOAuth('google')}>
          🌐 Google
        </button>
        <button type="button" className="secondary oauth-btn" onClick={() => handleOAuth('discord')}>
          🎮 Discord
        </button>
      </div>

      <form onSubmit={submit} className="form-stack margin-top-sm">
        <div className="segment">
          <button type="button" onClick={() => setMode('signup')} className={mode === 'signup' ? 'selected' : ''}>Sign up</button>
          <button type="button" onClick={() => setMode('login')} className={mode === 'login' ? 'selected' : ''}>Sign in</button>
        </div>
        {mode === 'signup' && (
          <>
            <input name="username" placeholder="Username" required maxLength={24} />
            <input name="avatarUrl" type="url" placeholder="Avatar URL (optional)" />
          </>
        )}
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" minLength={10} placeholder="Password (10+ characters)" required />
        {error && <p className="error">{error}</p>}
        <button className="secondary">{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function Shell({ user, setUser, children }: { user?: User; setUser: (user?: User) => void; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <>
      <header>
        <Link to="/" className="brand"><b>UNO</b> NIGHT</Link>
        <nav>
          <Link to="/lobby">Lobby</Link>
          <Link to="/leaderboard">Leaders</Link>
          {user && !user.isGuest && <Link to="/history">History</Link>}
          {user ? (
            <div className="nav-user">
              <Link to="/profile" className="profile-link">
                <AvatarDisplay url={user.avatarUrl} preset={user.avatarPreset} username={user.username} size="small" />
                <span>{user.username} {user.isGuest ? '(Guest)' : ''}</span>
              </Link>
              <button className="text-button" onClick={async () => { await api.logout(); setUser(undefined); navigate('/'); }}>Sign out</button>
            </div>
          ) : (
            <button className="secondary small" onClick={() => navigate('/profile')}>Profile / Guest</button>
          )}
        </nav>
      </header>
      {children}
      <footer>Server-authoritative rooms · Play fair, have fun.</footer>
    </>
  );
}

function Home({ user, setUser, ensureGuest }: { user?: User; setUser: (user?: User) => void; ensureGuest: () => Promise<User> }) {
  const navigate = useNavigate(); const [how, setHow] = useState(false); const [account, setAccount] = useState(false); const [roomCode, setRoomCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const create = async (isPrivate: boolean, botCount = 0) => { setBusy(true); setError(''); try { await ensureGuest(); const { room } = await api.createRoom({ isPrivate, maxPlayers: Math.max(2, botCount + 1), botCount, autoStart: botCount > 0, targetScore: 500, maxRounds: 5, rules: { stacking: false, sevenZero: false, jumpIn: false } }); navigate(`/room/${room.code}`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a room.'); } finally { setBusy(false); } };
  
  const playGuest = async () => {
    setBusy(true); setError('');
    try {
      const { user: guestUser } = await api.guest();
      setUser(guestUser);
      navigate('/lobby');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start guest session.');
    } finally {
      setBusy(false);
    }
  };

  return <main className="landing"><section className="hero"><p className="eyebrow">REAL-TIME MULTIPLAYER</p><h1>Big cards.<br /><em>Bigger</em> chaos.</h1><p className="lead">A fast, friendly UNO table for two to ten players. Play instantly as a guest or sign in to save your rank.</p><div className="hero-actions"><button className="primary big" disabled={busy} onClick={playGuest}>⚡ Play Instantly as Guest</button><button className="secondary big" disabled={busy} onClick={() => create(true)}>Play with friends</button><button className="secondary big" disabled={busy} onClick={() => create(true, 1)}>Play vs bot</button><button className="secondary big" onClick={() => setHow(true)}>How to play</button></div>{error && <p className="error">{error}</p>}<div className="join-line"><input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ROOM CODE" maxLength={6} /><button className="secondary" onClick={() => roomCode.length === 6 && navigate(`/room/${roomCode}`)}>Join</button></div></section>
    <aside className="landing-card panel"><div className="mini-deck"><CardView card={{ id: 'a', color: 'red', value: 'reverse' }} /><CardView card={{ id: 'b', color: 'yellow', value: '7' }} /><CardView card={{ id: 'c', color: null, value: 'wild4' }} /></div><h2>Find a table</h2><p>Open rooms, private invites, spectators, rematches, chat, and optional classic house rules.</p><button className="link-button" onClick={() => navigate('/lobby')}>Browse public lobby →</button>{user?.isGuest !== false && <button className="link-button" onClick={() => setAccount(!account)}>Save stats with an account →</button>}{account && <AuthPanel onDone={(newUser) => { setUser(newUser); setAccount(false); }} />}</aside>
    {how && <Modal title="How to play" onClose={() => setHow(false)}><ol><li>Match the top card by color, number, or symbol—or play a Wild.</li><li>Use Skip, Reverse, Draw Two, and Wild Draw Four to swing the table.</li><li>When you reach one card, press <b>UNO!</b>. Another player can catch you otherwise.</li><li>The server validates every move, scores rounds, and keeps hands private.</li></ol></Modal>}
  </main>;
}

function Lobby({ ensureGuest }: { ensureGuest: () => Promise<User> }) {
  const navigate = useNavigate(); const [rooms, setRooms] = useState<RoomMeta[]>([]); const [error, setError] = useState(''); const [createOpen, setCreateOpen] = useState(false);
  const load = () => api.lobby().then((value) => setRooms(value.rooms)).catch((reason) => setError(reason.message));
  useEffect(() => { void load(); }, []);
  const quick = async () => { try { await ensureGuest(); const { room } = await api.createRoom({ isPrivate: false, maxPlayers: 4, botCount: 0, targetScore: 500, maxRounds: 5, rules: {} }); navigate(`/room/${room.code}`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create room.'); } };
  return <main className="page"><div className="page-heading"><div><p className="eyebrow">PUBLIC TABLES</p><h1>Lobby</h1></div><div className="hero-actions"><button className="secondary" onClick={() => setCreateOpen(true)}>Custom room</button><button className="primary" onClick={quick}>Create public room</button></div></div>{error && <p className="error">{error}</p>}<div className="room-list">{rooms.length ? rooms.map((room) => <article className="panel room-row" key={room.code}><div><b>{room.host ?? 'Open table'}</b><p>{room.players}/{room.maxPlayers} players{room.bots ? ` · ${room.bots} bot${room.bots === 1 ? '' : 's'}` : ''} · {room.rules.stacking ? 'Stacking' : 'Classic rules'}</p></div><button className="secondary" onClick={() => navigate(`/room/${room.code}`)}>Join {room.code}</button></article>) : <div className="panel empty"><h2>No open rooms yet</h2><p>Create one and invite a friend, or wait for a new public table.</p></div>}</div>{createOpen && <CreateRoom onClose={() => setCreateOpen(false)} onCreate={async (options) => { try { await ensureGuest(); const { room } = await api.createRoom(options); navigate(`/room/${room.code}`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a room.'); } }} />}</main>;
}

function CreateRoom({ onClose, onCreate }: { onClose: () => void; onCreate: (options: unknown) => void }) {
  const [isPrivate, setPrivate] = useState(true); const [maxPlayers, setMaxPlayers] = useState(4); const [botCount, setBotCount] = useState(0); const [stacking, setStacking] = useState(false); const [sevenZero, setSevenZero] = useState(false); const [jumpIn, setJumpIn] = useState(false);
  return <Modal title="Set the table" onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onCreate({ isPrivate, maxPlayers, botCount, targetScore: 500, maxRounds: 5, rules: { stacking, sevenZero, jumpIn } }); }}><label>Seats <select value={maxPlayers} onChange={(event) => { const seats = Number(event.target.value); setMaxPlayers(seats); setBotCount(Math.min(botCount, seats - 1)); }}>{Array.from({ length: 9 }, (_, index) => index + 2).map((value) => <option key={value}>{value}</option>)}</select></label><label>UNO bots <select value={botCount} onChange={(event) => setBotCount(Number(event.target.value))}>{Array.from({ length: maxPlayers }, (_, index) => index).map((value) => <option key={value}>{value}</option>)}</select></label><label><input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} /> Private invite-only room</label><label><input type="checkbox" checked={stacking} onChange={(event) => setStacking(event.target.checked)} /> Stack +2 / +4</label><label><input type="checkbox" checked={sevenZero} onChange={(event) => setSevenZero(event.target.checked)} /> 7-0 hand rules</label><label><input type="checkbox" checked={jumpIn} onChange={(event) => setJumpIn(event.target.checked)} /> Jump-in</label><button className="primary">Create room</button></form></Modal>;
}

function Leaderboard({ onInspectPlayer }: { onInspectPlayer?: (username: string) => void }) {
  const [players, setPlayers] = useState<{ id: string; username: string; avatarUrl?: string; avatarPreset?: string; wins: number; losses: number; rating: number }[]>([]);
  useEffect(() => { api.leaderboard().then((data) => setPlayers(data.players)).catch(() => undefined); }, []);
  return (
    <main className="page">
      <div className="page-heading">
        <div><p className="eyebrow">PERSISTENT STATS</p><h1>Leaderboard</h1></div>
      </div>
      <div className="panel leaderboard">
        {players.length ? (
          players.map((player, index) => (
            <div key={player.id} className="clickable-row" onClick={() => onInspectPlayer?.(player.username)}>
              <strong>#{index + 1}</strong>
              <div className="user-cell">
                <AvatarDisplay url={player.avatarUrl} preset={player.avatarPreset} username={player.username} size="small" />
                <span>{player.username}</span>
              </div>
              <small>{player.wins}W · {player.losses}L</small>
              <b>{player.rating} pts</b>
            </div>
          ))
        ) : (
          <div className="empty">No ranked matches yet. Be the first registered player!</div>
        )}
      </div>
    </main>
  );
}

function History({ user }: { user?: User }) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    api.history().then((data) => setMatches(data.matches)).catch((error: Error) => setMessage(error.message));
  }, []);

  return (
    <main className="page">
      <div className="page-heading">
        <div><p className="eyebrow">YOUR ACCOUNT</p><h1>Match history</h1></div>
      </div>
      <div className="history-list">
        {message && <p className="error panel">{message}</p>}
        {matches.length ? (
          matches.map((match) => {
            const isWinner = match.winnerId === user?.id;
            const winnerName = match.players.find((p) => p.id === match.winnerId)?.username ?? 'Unknown';
            const expanded = expandedId === match.id;
            return (
              <article key={match.id} className={`panel match-card ${isWinner ? 'match-win' : ''}`}>
                <div className="match-card-header" onClick={() => setExpandedId(expanded ? null : match.id)}>
                  <div>
                    <span className={`badge ${isWinner ? 'badge-win' : 'badge-loss'}`}>{isWinner ? 'VICTORY' : 'DEFEAT'}</span>
                    <strong>Room {match.roomCode}</strong>
                    <small>{new Date(match.completedAt).toLocaleDateString()} {new Date(match.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                  </div>
                  <div className="match-meta">
                    <span>Winner: <b>{winnerName}</b></span>
                    <button type="button" className="secondary small">{expanded ? 'Collapse ▲' : 'Details ▼'}</button>
                  </div>
                </div>
                {expanded && (
                  <div className="match-card-body">
                    <h4>Player Scores</h4>
                    <div className="match-players-grid">
                      {match.players.map((p) => (
                        <div key={p.id} className={`match-player-item ${p.id === match.winnerId ? 'winner' : ''}`}>
                          <span>{p.username} {p.id === user?.id ? '(You)' : ''}</span>
                          <b>{p.score} pts</b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })
        ) : (
          !message && <div className="panel empty">Your completed matches will appear here.</div>
        )}
      </div>
    </main>
  );
}

function PublicProfileModal({ username, onClose, onAddFriend }: { username: string; onClose: () => void; onAddFriend?: (username: string) => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

  useEffect(() => {
    api.getPublicProfile(username)
      .then((res) => setProfile(res.profile))
      .catch((err: Error) => setError(err.message));
  }, [username]);

  return (
    <Modal title={`Player Profile: ${username}`} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {profile ? (
        <div className="profile-public-view">
          <div className="profile-hero">
            <AvatarDisplay url={profile.avatarUrl} preset={profile.avatarPreset} username={profile.username} size="large" />
            <div>
              <h2>
                {profile.username}
                {profile.country && COUNTRIES[profile.country] && (
                  <span className="flag-badge" title={COUNTRIES[profile.country].name}>
                    {COUNTRIES[profile.country].flag}
                  </span>
                )}
              </h2>
              {profile.bio && <p className="bio-text">"{profile.bio}"</p>}
              {onAddFriend && (
                <button
                  className="secondary small margin-top"
                  disabled={added}
                  onClick={async () => {
                    try {
                      await onAddFriend(profile.username);
                      setAdded(true);
                    } catch {}
                  }}
                >
                  {added ? '✓ Friend Requested' : '+ Add Friend'}
                </button>
              )}
            </div>
          </div>

          <h3>Player Statistics</h3>
          <div className="stats-grid">
            <div className="stat-card"><small>Games</small><b>{profile.stats.gamesPlayed}</b></div>
            <div className="stat-card"><small>Wins</small><b>{profile.stats.wins}</b></div>
            <div className="stat-card"><small>Losses</small><b>{profile.stats.losses}</b></div>
            <div className="stat-card"><small>Win Rate</small><b>{profile.stats.winRate}%</b></div>
            <div className="stat-card"><small>Current Streak</small><b>{profile.stats.currentStreak}</b></div>
            <div className="stat-card"><small>Best Streak</small><b>{profile.stats.longestStreak}</b></div>
            <div className="stat-card"><small>UNO Calls</small><b>{profile.stats.unoCalls}</b></div>
            <div className="stat-card"><small>Caught</small><b>{profile.stats.caughtWithoutUno}</b></div>
          </div>

          <h3>Badges Unlocked ({profile.achievements.length})</h3>
          <div className="badges-shelf">
            {ALL_ACHIEVEMENTS.map((badge) => {
              const unlocked = profile.achievements.includes(badge.title);
              return (
                <div key={badge.title} className={`badge-item ${unlocked ? 'unlocked' : 'locked'}`}>
                  <span className="badge-emoji">{badge.emoji}</span>
                  <div>
                    <b>{badge.title}</b>
                    <small>{badge.description}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        !error && <p className="loading">Loading profile...</p>
      )}
    </Modal>
  );
}

function ProfileView({ user, setUser, ensureGuest }: { user?: User; setUser: (user?: User) => void; ensureGuest: () => Promise<User> }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friendsList, setFriendsList] = useState<Friend[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editModal, setEditModal] = useState(false);
  const [avatarModal, setAvatarModal] = useState(false);
  const [convertModal, setConvertModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [friendUsername, setFriendUsername] = useState('');
  const [friendError, setFriendError] = useState('');
  const [inspectUser, setInspectUser] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const p = await api.getProfile();
      setProfile(p.profile);
      if (user && !user.isGuest) {
        const f = await api.friends();
        setFriendsList(f.friends);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load profile.');
    }
  };

  useEffect(() => {
    void loadData();
  }, [user?.id, user?.isGuest]);

  const handleAddFriend = async (event?: FormEvent) => {
    event?.preventDefault();
    setFriendError('');
    if (!friendUsername.trim()) return;
    try {
      await api.addFriend(friendUsername.trim());
      setFriendUsername('');
      const f = await api.friends();
      setFriendsList(f.friends);
      setSuccess('Friend added successfully!');
    } catch (err) {
      setFriendError(err instanceof Error ? err.message : 'Failed to add friend.');
    }
  };

  const handleRemoveFriend = async (name: string) => {
    try {
      await api.removeFriend(name);
      const f = await api.friends();
      setFriendsList(f.friends);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove friend.');
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setError(''); setSuccess('');
    try {
      const res = await api.uploadAvatar(file);
      setUser(res.user);
      await loadData();
      setAvatarModal(false);
      setSuccess('Avatar uploaded successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    }
  };

  const handleAvatarPreset = async (presetKey: string) => {
    setError(''); setSuccess('');
    try {
      const res = await api.updateProfile({ username: profile?.username || user?.username, avatarPreset: presetKey, avatarUrl: '' });
      setUser(res.user);
      setProfile(res.profile);
      setAvatarModal(false);
      setSuccess('Preset avatar updated!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preset update failed.');
    }
  };

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLAYER CONTROL CENTER</p>
          <h1>Profile</h1>
        </div>
        <div className="hero-actions">
          {user?.isGuest ? (
            <button className="primary" onClick={() => setConvertModal(true)}>Upgrade to Full Account</button>
          ) : (
            <button className="secondary" onClick={() => setSettingsModal(true)}>Account Settings</button>
          )}
        </div>
      </div>

      {error && <p className="error panel">{error}</p>}
      {success && <p className="success-toast panel">{success}</p>}

      {user?.isGuest && (
        <section className="panel guest-banner">
          <div>
            <h3>⚡ Playing as Guest ({user.username})</h3>
            <p>Convert your guest session to a free registered account anytime to save your win streaks, unlock achievements, and add friends!</p>
          </div>
          <button className="primary" onClick={() => setConvertModal(true)}>Save My Progress</button>
        </section>
      )}

      {profile && (
        <div className="profile-layout">
          {/* Header Card */}
          <section className="panel profile-main-card">
            <div className="avatar-section">
              <AvatarDisplay
                url={profile.avatarUrl}
                preset={profile.avatarPreset}
                username={profile.username}
                size="large"
                onClick={() => !user?.isGuest && setAvatarModal(true)}
              />
              {!user?.isGuest && <button className="text-button small" onClick={() => setAvatarModal(true)}>Change avatar</button>}
            </div>

            <div className="profile-info-section">
              <div className="user-header">
                <h2>
                  {profile.username} {user?.isGuest ? '(Guest)' : ''}
                  {profile.country && COUNTRIES[profile.country] && (
                    <span className="flag-badge" title={COUNTRIES[profile.country].name}>
                      {COUNTRIES[profile.country].flag}
                    </span>
                  )}
                </h2>
                {!user?.isGuest && (
                  <button className="secondary small" onClick={() => setEditModal(true)}>Edit profile</button>
                )}
              </div>

              <p className="bio-display">{profile.bio ? `"${profile.bio}"` : <em>Session active (Guest stats are retained)</em>}</p>
              <small className="member-since">Session created {new Date(profile.createdAt).toLocaleDateString()}</small>
            </div>
          </section>

          {/* Stats Grid */}
          <section className="panel stats-panel">
            <h3>Session & Career Statistics</h3>
            <div className="stats-grid">
              <div className="stat-card"><small>Games Played</small><b>{profile.stats.gamesPlayed}</b></div>
              <div className="stat-card"><small>Wins</small><b>{profile.stats.wins}</b></div>
              <div className="stat-card"><small>Losses</small><b>{profile.stats.losses}</b></div>
              <div className="stat-card"><small>Win Rate</small><b>{profile.stats.winRate}%</b></div>
              <div className="stat-card"><small>Current Streak</small><b>{profile.stats.currentStreak} 🔥</b></div>
              <div className="stat-card"><small>Longest Streak</small><b>{profile.stats.longestStreak} ⚡</b></div>
              <div className="stat-card"><small>UNO Calls</small><b>{profile.stats.unoCalls} 🃏</b></div>
              <div className="stat-card"><small>Caught Without UNO</small><b>{profile.stats.caughtWithoutUno} 🦅</b></div>
            </div>
          </section>

          {/* Achievements Grid */}
          <section className="panel achievements-panel">
            <h3>Achievement Badges ({profile.achievements.length}/{ALL_ACHIEVEMENTS.length})</h3>
            <div className="badges-shelf">
              {ALL_ACHIEVEMENTS.map((badge) => {
                const unlocked = profile.achievements.includes(badge.title);
                return (
                  <div key={badge.title} className={`badge-item ${unlocked ? 'unlocked' : 'locked'}`}>
                    <span className="badge-emoji">{badge.emoji}</span>
                    <div>
                      <b>{badge.title}</b>
                      <small>{badge.description}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Friends List Widget */}
          {!user?.isGuest ? (
            <section className="panel friends-panel">
              <div className="panel-header-line">
                <h3>Friends List ({friendsList.length})</h3>
                <form className="add-friend-form" onSubmit={handleAddFriend}>
                  <input
                    value={friendUsername}
                    onChange={(e) => setFriendUsername(e.target.value)}
                    placeholder="Friend's username"
                    maxLength={24}
                  />
                  <button className="primary small">+ Add</button>
                </form>
              </div>
              {friendError && <p className="error small">{friendError}</p>}
              <div className="friends-grid">
                {friendsList.length ? (
                  friendsList.map((f) => (
                    <div key={f.id} className="friend-card">
                      <div className="friend-info" onClick={() => setInspectUser(f.username)}>
                        <span className={`status-dot ${f.isOnline ? 'online' : 'offline'}`} />
                        <AvatarDisplay url={f.avatarUrl} preset={f.avatarPreset} username={f.username} size="small" />
                        <div>
                          <b>{f.username}</b>
                          <small>{f.isOnline ? 'Online now' : 'Offline'} · {f.stats.wins}W / {f.stats.losses}L</small>
                        </div>
                      </div>
                      <div className="friend-actions">
                        <button className="text-button small" onClick={() => setInspectUser(f.username)}>Profile</button>
                        <button className="text-button small danger" onClick={() => handleRemoveFriend(f.username)}>Remove</button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No friends added yet. Add a friend by username to check their online status!</p>
                )}
              </div>
            </section>
          ) : (
            <section className="panel guest-lock-banner">
              <h3>🔒 Friends List & Global Leaderboards</h3>
              <p>Friends list, permanent match history, and global rankings are unlocked when you upgrade to a free registered account!</p>
              <button className="secondary" onClick={() => setConvertModal(true)}>Upgrade Account Now</button>
            </section>
          )}
        </div>
      )}

      {/* Edit Profile Modal */}
      {editModal && profile && (
        <Modal title="Edit Profile" onClose={() => setEditModal(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              const data = new FormData(e.currentTarget);
              try {
                const res = await api.updateProfile({
                  username: String(data.get('username')),
                  bio: String(data.get('bio')),
                  country: String(data.get('country'))
                });
                setUser(res.user);
                setProfile(res.profile);
                setEditModal(false);
                setSuccess('Profile updated!');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not update profile.');
              }
            }}
          >
            <label>
              Username
              <input name="username" defaultValue={profile.username} required maxLength={24} />
            </label>
            <label>
              Country
              <select name="country" defaultValue={profile.country || ''}>
                <option value="">None (Hidden)</option>
                {Object.entries(COUNTRIES).map(([code, c]) => (
                  <option key={code} value={code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Bio (Short status or description)
              <textarea name="bio" defaultValue={profile.bio || ''} maxLength={200} placeholder="Say something about yourself..." />
            </label>
            <button className="primary">Save Changes</button>
          </form>
        </Modal>
      )}

      {/* Avatar Picker / Upload Modal */}
      {avatarModal && (
        <Modal title="Avatar Options" onClose={() => setAvatarModal(false)}>
          <div className="avatar-options-stack">
            <h4>1. Pick a Preset Avatar</h4>
            <div className="preset-grid">
              {Object.entries(AVATAR_PRESETS).map(([key, item]) => (
                <button key={key} type="button" className="preset-button" onClick={() => handleAvatarPreset(key)}>
                  <span className="preset-emoji-big">{item.emoji}</span>
                  <small>{item.label}</small>
                </button>
              ))}
            </div>

            <hr />

            <h4>2. Upload Custom Image</h4>
            <p className="small-lead">Supports PNG, JPEG, or WebP up to 1 MB.</p>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAvatarUpload(file);
              }}
            />
          </div>
        </Modal>
      )}

      {/* Convert Guest Account Modal */}
      {convertModal && (
        <Modal title="Upgrade Guest Account" onClose={() => setConvertModal(false)}>
          <div className="convert-stack">
            <p className="highlight-lead">🎉 Keep your win streak & session stats! Choose how to save your account:</p>
            
            <div className="oauth-row">
              <button
                type="button"
                className="secondary oauth-btn"
                onClick={async () => {
                  try {
                    const res = await api.convertOAuth('google');
                    setUser(res.user);
                    await loadData();
                    setConvertModal(false);
                    setSuccess('Account created via Google! Your stats have been saved.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Google conversion failed.');
                  }
                }}
              >
                🌐 Upgrade with Google
              </button>
              <button
                type="button"
                className="secondary oauth-btn"
                onClick={async () => {
                  try {
                    const res = await api.convertOAuth('discord');
                    setUser(res.user);
                    await loadData();
                    setConvertModal(false);
                    setSuccess('Account created via Discord! Your stats have been saved.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Discord conversion failed.');
                  }
                }}
              >
                🎮 Upgrade with Discord
              </button>
            </div>

            <div className="divider-line"><span>OR CREATE EMAIL ACCOUNT</span></div>

            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setError('');
                const data = new FormData(e.currentTarget);
                try {
                  const res = await api.convertGuest({
                    username: String(data.get('username')),
                    email: String(data.get('email')),
                    password: String(data.get('password'))
                  });
                  setUser(res.user);
                  await loadData();
                  setConvertModal(false);
                  setSuccess('Account created successfully! Your stats and history have been preserved.');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Account conversion failed.');
                }
              }}
            >
              <input name="username" defaultValue={user?.username} placeholder="Username" required maxLength={24} />
              <input name="email" type="email" placeholder="Email" required />
              <input name="password" type="password" minLength={10} placeholder="Password (10+ chars)" required />
              <button className="primary">Save Account & Stats</button>
            </form>
          </div>
        </Modal>
      )}

      {/* Settings Modal */}
      {settingsModal && profile && (
        <Modal title="Account Settings & Security" onClose={() => setSettingsModal(false)}>
          <div className="settings-sections">
            <section className="settings-block">
              <h4>Change Email / Password</h4>
              <form
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError(''); setSuccess('');
                  const data = new FormData(e.currentTarget);
                  try {
                    await api.updateCredentials({
                      currentPassword: String(data.get('currentPassword')),
                      newEmail: String(data.get('newEmail') || '') || undefined,
                      newPassword: String(data.get('newPassword') || '') || undefined
                    });
                    setSuccess('Credentials updated successfully!');
                    (e.target as HTMLFormElement).reset();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Credentials update failed.');
                  }
                }}
              >
                <input name="currentPassword" type="password" placeholder="Current Password" required />
                <input name="newEmail" type="email" placeholder="New Email (optional)" />
                <input name="newPassword" type="password" minLength={10} placeholder="New Password (optional)" />
                <button className="secondary">Update Credentials</button>
              </form>
            </section>

            <hr />

            <section className="settings-block">
              <h4>Preferences & Themes</h4>
              <form
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError(''); setSuccess('');
                  const data = new FormData(e.currentTarget);
                  try {
                    const res = await api.updateProfile({
                      username: profile.username,
                      preferences: {
                        notifications: data.get('notifications') === 'on',
                        sound: data.get('sound') === 'on',
                        theme: String(data.get('theme')) as 'midnight' | 'table' | 'cyber'
                      }
                    });
                    setProfile(res.profile);
                    setSuccess('Preferences saved!');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Preferences save failed.');
                  }
                }}
              >
                <label><input type="checkbox" name="notifications" defaultChecked={profile.preferences.notifications} /> Sound & turn notifications</label>
                <label><input type="checkbox" name="sound" defaultChecked={profile.preferences.sound} /> Sound effects enabled</label>
                <label>
                  Theme
                  <select name="theme" defaultValue={profile.preferences.theme}>
                    <option value="midnight">Midnight Dark (Default)</option>
                    <option value="table">Green Felt Table</option>
                    <option value="cyber">Cyber Neon</option>
                  </select>
                </label>
                <button className="secondary">Save Preferences</button>
              </form>
            </section>

            <hr />

            <section className="settings-block danger-zone">
              <h4>Data & Security</h4>
              <div className="hero-actions">
                <a className="secondary text-center" href={api.exportData()} target="_blank" rel="noreferrer">Export My Data (JSON)</a>
                <button
                  className="secondary danger"
                  onClick={async () => {
                    if (confirm('Log out of all devices? This will invalidate active sessions on other browser windows.')) {
                      await api.logoutAll();
                      setUser(undefined);
                      navigate('/');
                    }
                  }}
                >
                  Log out of all devices
                </button>
                <button
                  className="primary danger"
                  onClick={async () => {
                    if (confirm('Permanently delete your account and all associated statistics? This action cannot be undone.')) {
                      await api.deleteAccount();
                      setUser(undefined);
                      navigate('/');
                    }
                  }}
                >
                  Delete Account Permanently
                </button>
              </div>
            </section>
          </div>
        </Modal>
      )}

      {/* Public Profile Inspector Modal */}
      {inspectUser && (
        <PublicProfileModal
          username={inspectUser}
          onClose={() => setInspectUser(null)}
          onAddFriend={!user?.isGuest ? (name) => api.addFriend(name).then(() => undefined) : undefined}
        />
      )}
    </main>
  );
}

function Room({ user, ensureGuest }: { user?: User; ensureGuest: () => Promise<User> }) {
  const navigate = useNavigate();
  const { code = '' } = useParams(); const [state, setState] = useState<GameSnapshot>(); const [meta, setMeta] = useState<RoomMeta>(); const [error, setError] = useState(''); const [socket, setSocket] = useState<Socket>(); const [selected, setSelected] = useState<Card>(); const [wildColor, setWildColor] = useState<Color>('red'); const [swap, setSwap] = useState(''); const [callUno, setCallUno] = useState(true); const [chat, setChat] = useState(''); const [reporting, setReporting] = useState(false); const [now, setNow] = useState(Date.now()); const [inspectUser, setInspectUser] = useState<string | null>(null);
  useEffect(() => { let live = true; let client: Socket | undefined; (async () => { try { await ensureGuest(); if (!live) return; client = io(socketUrl, { withCredentials: true }); setSocket(client); client.on('room:state', (next: GameSnapshot) => { setState(next); setError(''); }); client.on('room:meta', setMeta); client.on('action:error', (item: { message: string }) => setError(item.message)); client.on('connect_error', () => setError('Connection failed. Reconnecting…')); client.emit('room:join', { code }, (result: { ok: boolean; error?: string }) => { if (!result.ok) setError(result.error ?? 'Unable to join room.'); }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to start your guest session.'); } })(); return () => { live = false; client?.disconnect(); }; }, [code]);
  useEffect(() => { if (!state?.topCard) return; const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); gain.gain.value = 0.015; oscillator.frequency.value = 420; oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.05); return () => { void context.close(); }; }, [state?.topCard?.id]);
  useEffect(() => { if (!state?.turnDeadline) return; setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, [state?.turnDeadline]);
  useEffect(() => { setSelected(undefined); setSwap(''); }, [state?.currentPlayerId, state?.topCard?.id]);
  const emit = (event: string, payload = {}) => socket?.emit(event, payload);
  const self = state?.players.find((player) => player.isYou); const isTurn = Boolean(state && user && state.currentPlayerId === user.id && !state.isSpectator); const seconds = state?.turnDeadline ? Math.max(0, Math.ceil((state.turnDeadline - now) / 1000)) : undefined;
  const canPlayCard = (card: Card) => {
    if (!state || state.status !== 'playing' || state.isSpectator || !self) return false;
    const isJumpIn = !isTurn && state.rules.jumpIn && !state.pendingDraw && card.color === state.topCard?.color && card.value === state.topCard?.value;
    if (!isTurn && !isJumpIn) return false;
    if (state.pendingDraw) return state.rules.stacking && (state.pendingDraw.type === 'draw2' ? card.value === 'draw2' : card.value === 'wild4');
    return !card.color || card.color === state.currentColor || card.value === state.topCard?.value;
  };
  const play = (card = selected) => { if (!card) return; emit('game:play', { cardId: card.id, chosenColor: card.color ? undefined : wildColor, swapWithPlayerId: card.value === '7' && state?.rules.sevenZero ? swap || undefined : undefined, callUno }); setSelected(undefined); };
  if (!state) return <main className="page"><div className="panel loading">Joining <b>{code}</b>… {error && <p className="error">{error}</p>}</div></main>;
  if (state.status === 'waiting') return <main className="game-page"><div className="game-top"><Link to="/lobby">← Lobby</Link><div><b>Room {code}</b><button className="text-button" onClick={() => navigator.clipboard.writeText(location.href)}>Copy invite</button></div></div>{error && <p className="error">{error}</p>}<section className="waiting panel"><p className="eyebrow">READY CHECK</p><h1>{state.isSpectator ? 'You’re spectating' : 'Set for UNO?'}</h1><p>Invite up to {meta?.maxPlayers ?? 10} players with the room code <b>{code}</b>. Late arrivals can watch from the sidelines.</p><div className="waiting-players">{state.players.map((player) => <PlayerBadge key={player.id} player={player} current={false} onClick={() => !player.isBot && setInspectUser(player.username)} />)}</div>{!state.isSpectator && <div className="hero-actions"><button className={self?.ready ? 'secondary' : 'primary'} onClick={() => emit('room:ready', { ready: !self?.ready })}>{self?.ready ? 'Not ready' : 'Ready up'}</button>{meta?.hostId === user?.id && <button className="primary" disabled={!state.players.every((player) => player.ready) || state.players.length < 2} onClick={() => emit('game:start')}>Start match</button>}</div>}<p className="rule-copy">{state.rules.stacking ? 'Stacking enabled · ' : ''}{state.rules.sevenZero ? '7-0 enabled · ' : ''}{state.rules.jumpIn ? 'Jump-in enabled' : 'Classic UNO rules'}</p></section>{inspectUser && <PublicProfileModal username={inspectUser} onClose={() => setInspectUser(null)} />}</main>;
  return <main className="game-page"><div className="game-top"><Link to="/lobby">← Lobby</Link><div><b>Room {code}</b><button className="text-button" onClick={() => navigator.clipboard.writeText(location.href)}>Copy invite</button></div><div>{state.isSpectator ? 'Spectating' : `${isTurn ? 'Your turn' : `${state.players.find((player) => player.id === state.currentPlayerId)?.username ?? '—'}’s turn`}`} {seconds !== undefined && <small className="timer">{seconds}s</small>}</div></div>{error && <p className="error toast">{error}</p>}
    <section className="scorebar panel"><span>Round {state.round}/{state.maxRounds}</span><span>Target {state.targetScore}</span><span>{state.rules.stacking ? '+ stacking' : 'classic'} {state.rules.sevenZero ? '+ 7-0' : ''} {state.rules.jumpIn ? '+ jump-in' : ''}</span></section>
    <section className="table"><div className="opponents">{state.players.filter((player) => !player.isYou).map((player) => <PlayerBadge key={player.id} player={player} current={player.id === state.currentPlayerId} onCatch={() => emit('game:catch-uno', { targetPlayerId: player.id })} onClick={() => !player.isBot && setInspectUser(player.username)} />)}</div><div className="board"><div className="draw-pile"><CardView faceDown onClick={isTurn ? () => emit(state.pendingDraw ? 'game:accept-penalty' : 'game:draw') : undefined} /><small>{state.drawCount}</small></div><div className="discard"><CardView card={state.topCard} /><p className={`color-dot ${state.currentColor}`}>{state.currentColor}</p></div>{state.pendingDraw && <div className="penalty"><b>+{state.pendingDraw.amount}</b><span>{state.pendingDraw.type === 'wild4' ? 'Challenge or draw' : 'Stack or draw'}</span>{isTurn && state.pendingDraw.type === 'wild4' && <button className="secondary" onClick={() => emit('game:challenge-wild4')}>Challenge</button>}{isTurn && <button className="primary" onClick={() => emit('game:accept-penalty')}>Take cards</button>}</div>}</div>
      <div className="hand-area"><div className="hand-header"><b>{self?.username ?? 'You'} · {self?.score ?? 0} pts</b><label><input type="checkbox" checked={callUno} onChange={(event) => setCallUno(event.target.checked)} /> Call UNO automatically</label></div><div className="hand">{state.hand.map((card) => <CardView key={card.id} card={card} active={selected?.id === card.id} onClick={canPlayCard(card) ? () => { if (!card.color || (card.value === '7' && state.rules.sevenZero)) { setSelected(card); } else { setSelected(card); play(card); } } : undefined} />)}</div>{selected && !selected.color && <div className="wild-picker"><span>Wild color:</span>{(['red', 'yellow', 'green', 'blue'] as Color[]).map((color) => <button key={color} className={`color-choice ${color}`} onClick={() => { setWildColor(color); play(selected); }}>{color}</button>)}</div>}{selected?.value === '7' && state.rules.sevenZero && <div className="wild-picker"><select value={swap} onChange={(event) => setSwap(event.target.value)}><option value="">Swap with…</option>{state.players.filter((player) => !player.isYou).map((player) => <option value={player.id} key={player.id}>{player.username}</option>)}</select><button className="primary" onClick={() => play(selected)} disabled={!swap}>Play 7</button></div>}<div className="controls"><button className="primary" disabled={!isTurn || Boolean(state.pendingDraw)} onClick={() => emit('game:draw')}>Draw</button><button className="secondary" disabled={!isTurn || !state.drewCardId} onClick={() => emit('game:pass')}>Pass</button><button className="uno-button" disabled={self?.handCount !== 1} onClick={() => emit('game:call-uno')}>UNO!</button></div></div></section>
    {(state.status === 'round-over' || state.status === 'match-over') && (
      <section className="result-panel panel">
        <h2>
          {state.status === 'match-over'
            ? `${state.players.find((player) => player.id === state.winnerId)?.username ?? 'A player'} wins the match!`
            : `${state.players.find((player) => player.id === state.roundWinnerId)?.username ?? 'A player'} takes the round!`}
        </h2>
        <div>{state.players.map((player) => <span key={player.id}>{player.username}: {player.score}</span>)}</div>
        {user?.isGuest && (
          <div className="post-game-guest-prompt">
            <span>⚡ Playing as Guest · Save your win streak & stats to a permanent account!</span>
            <button className="secondary small" onClick={() => navigate('/profile')}>Save Stats Now</button>
          </div>
        )}
        <button className="primary" onClick={() => emit(state.status === 'match-over' ? 'match:rematch' : 'round:next')}>
          {state.status === 'match-over' ? 'Vote rematch' : 'Next round'}
        </button>
      </section>
    )}
    <section className="below-game"><Chat state={state} onSend={() => { if (chat.trim()) { emit('chat:send', { text: chat }); setChat(''); } }} value={chat} setValue={setChat} onReact={(messageId, emoji) => emit('chat:react', { messageId, emoji })} /><div className="panel side-info"><h3>Players</h3>{state.players.map((player) => <PlayerBadge key={player.id} player={player} current={player.id === state.currentPlayerId} onClick={() => !player.isBot && setInspectUser(player.username)} />)}<p>{state.spectatorCount} spectator{state.spectatorCount === 1 ? '' : 's'}</p><button className="link-button" onClick={() => setReporting(true)}>Report a bug or abuse</button></div></section>{reporting && <Report code={code} onClose={() => setReporting(false)} />}{inspectUser && <PublicProfileModal username={inspectUser} onClose={() => setInspectUser(null)} />}</main>;
}

function PlayerBadge({ player, current, onCatch, onClick }: { player: GameSnapshot['players'][number]; current: boolean; onCatch?: () => void; onClick?: () => void }) {
  return (
    <div className={`player-badge ${current ? 'current' : ''} ${!player.connected ? 'offline' : ''}`}>
      <AvatarDisplay url={player.avatarUrl} preset={player.avatarPreset} username={player.username} size="small" onClick={onClick} />
      <span onClick={onClick} className={onClick ? 'clickable' : ''}>
        <b>{player.username}{player.isBot ? ' · BOT' : player.isYou ? ' (You)' : ''}</b>
        <small>{player.handCount} cards · {player.score} pts {!player.connected && ' · reconnecting'}</small>
      </span>
      {player.handCount === 1 && !player.unoCalled && onCatch && <button className="catch" onClick={onCatch}>Catch UNO</button>}
    </div>
  );
}

function Chat({ state, value, setValue, onSend, onReact }: { state: GameSnapshot; value: string; setValue: (value: string) => void; onSend: () => void; onReact: (id: string, emoji: string) => void }) { return <aside className="panel chat"><h3>Table chat</h3><div className="messages">{state.chat.map((message) => <div key={message.id} className="message"><b>{message.username}</b><p>{message.text}</p><div>{['👍', '😂', '🔥'].map((emoji) => <button key={emoji} onClick={() => onReact(message.id, emoji)}>{emoji} {message.reactions[emoji]?.length || ''}</button>)}</div></div>)}</div><form onSubmit={(event) => { event.preventDefault(); onSend(); }}><input maxLength={280} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Say something friendly…" /><button className="primary">Send</button></form></aside>; }

function Report({ code, onClose }: { code: string; onClose: () => void }) { const [message, setMessage] = useState(''); const [done, setDone] = useState(false); return <Modal title="Report an issue" onClose={onClose}><form className="form-stack" onSubmit={async (event) => { event.preventDefault(); await api.report({ category: 'bug', details: message, roomCode: code }); setDone(true); }}><textarea value={message} onChange={(event) => setMessage(event.target.value)} required maxLength={2000} placeholder="Tell us what happened." />{done ? <p>Thanks—your report was sent.</p> : <button className="primary">Send report</button>}</form></Modal>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="close" onClick={onClose}>×</button><h2>{title}</h2>{children}</section></div>; }

export default function App() {
  const [user, setUser] = useState<User>();
  const [inspectUser, setInspectUser] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(({ user: current }) => setUser(current)).catch(() => undefined);
  }, []);

  const ensureGuest = async () => {
    if (user) return user;
    const { user: guest } = await api.guest();
    setUser(guest);
    return guest;
  };

  return (
    <Shell user={user} setUser={setUser}>
      <Routes>
        <Route path="/" element={<Home user={user} setUser={setUser} ensureGuest={ensureGuest} />} />
        <Route path="/lobby" element={<Lobby ensureGuest={ensureGuest} />} />
        <Route path="/leaderboard" element={<Leaderboard onInspectPlayer={(username) => setInspectUser(username)} />} />
        <Route path="/history" element={<History user={user} />} />
        <Route path="/profile" element={<ProfileView user={user} setUser={setUser} ensureGuest={ensureGuest} />} />
        <Route path="/room/:code" element={<Room user={user} ensureGuest={ensureGuest} />} />
        <Route path="*" element={<Home user={user} setUser={setUser} ensureGuest={ensureGuest} />} />
      </Routes>
      {inspectUser && (
        <PublicProfileModal username={inspectUser} onClose={() => setInspectUser(null)} />
      )}
    </Shell>
  );
}
