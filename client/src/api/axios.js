import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const requestUrl = originalRequest?.url || '';

    const isAuthRequest =
      requestUrl.includes('/auth/signin') ||
      requestUrl.includes('/auth/signup') ||
      requestUrl.includes('/auth/refresh');

    if (status !== 401 || originalRequest?._retry || isAuthRequest) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = api
          .post('/auth/refresh')
          .then((response) => {
            const newToken = response.data.accessToken;
            setAccessToken(newToken);
            // NEW: notify the rest of the app (AuthContext) that a silent
            // rotation just happened, so it can log it in the timeline.
            window.dispatchEvent(
              new CustomEvent('auth:token-refreshed', { detail: { accessToken: newToken } })
            );
            return newToken;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }

      const newToken = await refreshPromise;
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      clearAccessToken();
      window.dispatchEvent(new Event('auth:logout'));
      return Promise.reject(refreshError);
    }
  }
);

export default api;