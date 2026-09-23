import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AUTH_REQUIRED_EVENT, setToken } from '../auth.js'

// Password prompt shown whenever a protected API call answers 401. The public "Nexus Code" page
// never needs it.
export default function LoginGate() {
  const location = useLocation()
  const [visible, setVisible] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const show = () => setVisible(true)
    window.addEventListener(AUTH_REQUIRED_EVENT, show)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, show)
  }, [])

  if (!visible || location.pathname === '/nexus-code') return null

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.token) {
        setError(body.error || 'Login failed')
        return
      }
      setToken(body.token)
      window.location.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#1a1d27] border border-[#2a2d3e] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">🔒 Dashboard login</h2>
          <p className="text-gray-400 text-sm mt-1">
            Enter the dashboard password (the <code>DASHBOARD_PASSWORD</code> variable on Railway,
            or the temporary one printed in the deploy logs).
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full bg-[#0f1117] border border-[#2a2d3e] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {error && <div className="text-red-400 text-sm">{error}</div>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2"
        >
          {busy ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  )
}
