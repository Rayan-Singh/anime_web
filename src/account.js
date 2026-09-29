async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({ message: 'Invalid account response' }));
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

export const getAccount = () => request('/api/auth/me');
export const signIn = (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
export const signUp = (name, email, password) => request('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
export const signOut = () => request('/api/auth/logout', { method: 'POST' });
export const saveAccountProgress = (key, progress) => request(`/api/account/progress/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(progress) });
