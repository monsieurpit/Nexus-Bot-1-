// Dashboard session handling. The token is attached to every same-origin /api request through a
// single fetch wrapper (installed once in main.jsx), so no page needs to know about it. Any 401
// from a protected route asks the <LoginGate> to show the password prompt.
const TOKEN_KEY = 'nexus-dashboard-token'
export const AUTH_REQUIRED_EVENT = 'nexus-dashboard-auth-required'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable (private mode) — the session just won't survive a reload.
  }
  memoryToken = token || ''
}

let memoryToken = ''

function isApiUrl(input) {
  const url = typeof input === 'string' ? input : input?.url || ''
  if (url.startsWith('/api/')) return true
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

export function installAuthFetch() {
  if (window.__nexusAuthFetchInstalled) return
  window.__nexusAuthFetchInstalled = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    if (!isApiUrl(input)) return originalFetch(input, init)
    const token = getToken() || memoryToken
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {})
    if (token && !headers.has('X-Dashboard-Token')) headers.set('X-Dashboard-Token', token)
    const response = await originalFetch(input, { ...init, headers })
    if (response.status === 401) {
      const body = await response.clone().json().catch(() => null)
      if (body?.code === 'DASHBOARD_AUTH_REQUIRED') {
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
      }
    }
    return response
  }
}
