import {
  AUTH_EVENTS,
  AuthError,
  MissingIdentityError,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  logout,
  oauthLogin,
  onAuthChange,
  requestPasswordRecovery,
  signup,
  updateUser,
} from '@netlify/identity';

window.TinyWorldAuth = {
  AUTH_EVENTS,
  AuthError,
  MissingIdentityError,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  logout,
  oauthLogin,
  onAuthChange,
  requestPasswordRecovery,
  signup,
  updateUser,
};

if (typeof window.__resolveTinyWorldAuthReady === 'function') {
  window.__resolveTinyWorldAuthReady(true);
}
