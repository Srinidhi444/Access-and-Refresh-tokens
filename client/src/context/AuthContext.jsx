import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { clearAccessToken, getAccessToken, setAccessToken } from '../api/axios';
import { decodeJwt } from '../utils/jwt';

const AuthContext = createContext(null);

function makeEvent(type, message) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type, // 'success' | 'info' | 'warning' | 'error'
    message,
    timestamp: new Date(),
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenMeta, setTokenMeta] = useState(null); // { iat, exp } decoded from current access token
  const [sessionInfo, setSessionInfo] = useState(null); // refresh-token metadata from server
  const [events, setEvents] = useState([]);
  const hasInitialized = useRef(false);
  const warnedExpiringRef = useRef(false);

  const logEvent = useCallback((type, message) => {
    setEvents((current) => [makeEvent(type, message), ...current].slice(0, 40));
  }, []);

  const applyAccessToken = useCallback((token) => {
    setAccessToken(token);
    try {
      const payload = decodeJwt(token);
      setTokenMeta({ iat: payload.iat, exp: payload.exp });
    } catch {
      setTokenMeta(null);
    }
    warnedExpiringRef.current = false;
  }, []);

  const refreshSessionInfo = useCallback(async () => {
    try {
      const response = await api.get('/auth/session-info');
      setSessionInfo(response.data);
    } catch {
      setSessionInfo(null);
    }
  }, []);

  async function restoreSession() {
    try {
      const response = await api.post('/auth/refresh');
      applyAccessToken(response.data.accessToken);
      logEvent('success', 'Session restored — refresh token rotated, new access token issued');

      const meResponse = await api.get('/me');
      setUser(meResponse.data.user);
      await refreshSessionInfo();
    } catch {
      clearAccessToken();
      setUser(null);
      logEvent('error', 'No valid session found — sign-in required');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Guards against React StrictMode double-invoking effects in development,
    // which would otherwise fire two refresh calls and trip reuse detection.
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    restoreSession();

    const handleLogout = () => {
      clearAccessToken();
      setUser(null);
      setTokenMeta(null);
      logEvent('error', 'Refresh failed — session ended');
    };

    const handleRefreshed = (event) => {
      applyAccessToken(event.detail.accessToken);
      logEvent('info', 'Access token expired — refresh token rotated, new access token issued');
      refreshSessionInfo();
    };

    window.addEventListener('auth:logout', handleLogout);
    window.addEventListener('auth:token-refreshed', handleRefreshed);
    return () => {
      window.removeEventListener('auth:logout', handleLogout);
      window.removeEventListener('auth:token-refreshed', handleRefreshed);
    };
  }, []);

  // Ticks once a second; logs a one-time "expiring soon" warning per token.
  useEffect(() => {
    if (!tokenMeta) return;
    const interval = setInterval(() => {
      const secondsLeft = tokenMeta.exp - Math.floor(Date.now() / 1000);
      if (secondsLeft <= 60 && secondsLeft > 0 && !warnedExpiringRef.current) {
        warnedExpiringRef.current = true;
        logEvent('warning', 'Access token expiring in under 60 seconds');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [tokenMeta, logEvent]);

  async function signup(email, password) {
    const response = await api.post('/auth/signup', { email, password });
    applyAccessToken(response.data.accessToken);
    setUser(response.data.user);
    logEvent('success', 'Account created — access token issued, refresh session started');
    await refreshSessionInfo();
  }

  async function signin(email, password) {
    const response = await api.post('/auth/signin', { email, password });
    applyAccessToken(response.data.accessToken);
    setUser(response.data.user);
    logEvent('success', 'Signed in — access token issued, refresh session started');
    await refreshSessionInfo();
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
      logEvent('info', 'Logged out — refresh token family revoked');
    } finally {
      clearAccessToken();
      setUser(null);
      setTokenMeta(null);
      setSessionInfo(null);
    }
  }

  // Manually triggers rotation — useful to demo the flow without waiting 10 minutes.
  async function forceRefresh() {
    try {
      const response = await api.post('/auth/refresh');
      applyAccessToken(response.data.accessToken);
      logEvent('info', 'Manual refresh — refresh token rotated, new access token issued');
      await refreshSessionInfo();
    } catch {
      logEvent('error', 'Manual refresh failed — refresh token invalid or revoked');
    }
  }

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      tokenMeta,
      sessionInfo,
      events,
      signup,
      signin,
      logout,
      forceRefresh,
      refreshSessionInfo,
      getAccessToken,
    }),
    [user, isLoading, tokenMeta, sessionInfo, events]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}