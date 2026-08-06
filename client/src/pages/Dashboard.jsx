import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { getAccessToken } from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { maskToken } from '../utils/jwt';

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatDuration(seconds) {
  if (seconds <= 0) return 'Expired';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDays(ms) {
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days}d ${hours}h`;
}

export default function Dashboard() {
  const { user, logout, tokenMeta, sessionInfo, events, forceRefresh, refreshSessionInfo } = useAuth();
  const navigate = useNavigate();
  const [protectedData, setProtectedData] = useState(null);
  const [error, setError] = useState('');
  const now = useNow();

  useEffect(() => {
    api
      .get('/me')
      .then((response) => setProtectedData(response.data))
      .catch(() => setError('Your session could not be loaded.'));
    refreshSessionInfo();
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/signin', { replace: true });
  }

  const accessSecondsLeft = tokenMeta ? tokenMeta.exp - Math.floor(now / 1000) : null;
  const accessTotalSeconds = tokenMeta ? tokenMeta.exp - tokenMeta.iat : null;
  const accessProgress =
    tokenMeta && accessTotalSeconds > 0
      ? Math.max(0, Math.min(100, (accessSecondsLeft / accessTotalSeconds) * 100))
      : 0;

  const accessStatus =
    accessSecondsLeft === null ? 'unknown' : accessSecondsLeft <= 0 ? 'expired' : accessSecondsLeft <= 60 ? 'expiring' : 'active';

  const refreshMsLeft = sessionInfo ? new Date(sessionInfo.expiresAt).getTime() - now : null;
  const refreshStatus = refreshMsLeft === null ? 'unknown' : refreshMsLeft <= 0 ? 'expired' : 'active';

  const statusLabel = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', unknown: 'Unknown' };
  const currentAccessToken = getAccessToken();

  return (
    <main className="dashboard-shell">
      <nav className="topbar">
        <div className="brand-mark">AUTH / CONSOLE</div>
        <div className="topbar-actions">
          <button className="button button-ghost" onClick={forceRefresh}>Force refresh</button>
          <button className="button button-ghost" onClick={handleLogout}>Log out</button>
        </div>
      </nav>

      <section className="dashboard-content">
        <div className="hero-copy">
          <p className="eyebrow">Private workspace</p>
          <h1>Welcome, {user?.email}</h1>
          <p className="muted">Live view of the access-token and refresh-token lifecycle for this session.</p>
        </div>

        <div className="lifecycle-grid">
          <article className="info-card glass-panel">
            <div className="card-head">
              <span className="card-label">Access token</span>
              <span className={`status-badge status-${accessStatus}`}>{statusLabel[accessStatus]}</span>
            </div>
            <code className="token-preview">{maskToken(currentAccessToken)}</code>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${accessProgress}%` }} />
            </div>
            <div className="token-meta-row">
              <span>Expires in</span>
              <strong>{accessSecondsLeft !== null ? formatDuration(accessSecondsLeft) : '—'}</strong>
            </div>
            <div className="token-meta-row">
              <span>Issued</span>
              <span>{tokenMeta ? new Date(tokenMeta.iat * 1000).toLocaleTimeString() : '—'}</span>
            </div>
            <div className="token-meta-row">
              <span>Storage</span>
              <span>JS memory (RS256 JWT)</span>
            </div>
          </article>

          <article className="info-card glass-panel">
            <div className="card-head">
              <span className="card-label">Refresh token</span>
              <span className={`status-badge status-${refreshStatus}`}>{statusLabel[refreshStatus]}</span>
            </div>
            <code className="token-preview">{sessionInfo ? maskToken(sessionInfo.familyId) : '—'}</code>
            <div className="token-meta-row">
              <span>Expires in</span>
              <strong>{refreshMsLeft !== null ? formatDays(refreshMsLeft) : '—'}</strong>
            </div>
            <div className="token-meta-row">
              <span>Issued</span>
              <span>{sessionInfo ? new Date(sessionInfo.issuedAt).toLocaleString() : '—'}</span>
            </div>
            <div className="token-meta-row">
              <span>Storage</span>
              <span>HttpOnly cookie (opaque, rotated)</span>
            </div>
          </article>
        </div>

        <article className="protected-card glass-panel">
          <div>
            <p className="eyebrow">API response</p>
            <h2>Protected data</h2>
          </div>
          {error ? <p className="form-error">{error}</p> : <pre>{JSON.stringify(protectedData, null, 2)}</pre>}
        </article>

        <article className="timeline-card glass-panel">
          <p className="eyebrow">Lifecycle events</p>
          <h2>Token activity</h2>
          <ul className="timeline-list">
            {events.length === 0 && <li className="muted">No events yet.</li>}
            {events.map((event) => (
              <li key={event.id} className={`timeline-item timeline-${event.type}`}>
                <span className="timeline-dot" />
                <div>
                  <p className="timeline-message">{event.message}</p>
                  <span className="timeline-time">{event.timestamp.toLocaleTimeString()}</span>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}