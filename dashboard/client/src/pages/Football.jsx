import { useState, useEffect } from 'react'
import { useGuild } from '../context/GuildContext.jsx'
import { SectionCard, Field, TextInput, Toggle, SaveButton } from '../components/SectionCard.jsx'

export default function Football() {
  const { fetchSection, saveSection, selectedGuildId } = useGuild()
  const [cfg, setCfg] = useState({
    enabled: false,
    channelId: '',
    roleId: '',
    postedMatches: []
  })
  const [matches, setMatches] = useState([])
  const [apiStatus, setApiStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState(null)
  const [error, setError] = useState(null)

  const loadData = async () => {
    if (!selectedGuildId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSection('football')
      setCfg({
        enabled: Boolean(data.enabled),
        channelId: data.channelId || '',
        roleId: data.roleId || '',
        postedMatches: data.postedMatches || []
      })

      // Fetch matches and API sync status
      const res = await fetch(`/api/guilds/${selectedGuildId}/football/matches`)
      if (res.ok) {
        const matchData = await res.json()
        setMatches(matchData.matches || [])
        setApiStatus(matchData.status || null)
      }
    } catch (err) {
      console.error(err)
      setError('Failed to load football settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    setSaved(false)
  }, [selectedGuildId])

  function set(key, value) {
    setCfg(c => ({ ...c, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveSection('football', {
        enabled: cfg.enabled,
        channelId: cfg.channelId ? cfg.channelId.trim() : null,
        roleId: cfg.roleId ? cfg.roleId.trim() : null,
      })
      setSaved(true)
    } catch (err) {
      console.error(err)
      setError('Failed to save football configuration')
    } finally {
      setSaving(false)
    }
  }

  async function handleSyncApi() {
    if (!selectedGuildId) return
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      const res = await fetch(`/api/guilds/${selectedGuildId}/football/sync`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('API Sync request failed')
      const data = await res.json()
      setSyncMessage(`Successfully fetched and updated ${data.count} FC Barcelona fixtures from live API!`)
      // Refresh match list
      const matchRes = await fetch(`/api/guilds/${selectedGuildId}/football/matches`)
      if (matchRes.ok) {
        const matchData = await matchRes.json()
        setMatches(matchData.matches || [])
        setApiStatus(matchData.status || null)
      }
    } catch (err) {
      console.error(err)
      setError('Failed to sync football API: ' + err.message)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-sm animate-pulse">Loading Football Matchday settings...</div>
  }

  const now = Date.now()
  const upcomingCount = matches.filter(m => new Date(m.kickoffUtc).getTime() >= now).length

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <span>⚽</span> FC Barcelona Matchday Alerts
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Automatically announce upcoming FC Barcelona matches 3 days in advance with bilingual details, kick-off times, locations, and transport directions.
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {syncMessage && (
        <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg p-3 text-emerald-300 text-sm flex items-center justify-between">
          <span>{syncMessage}</span>
          <button onClick={() => setSyncMessage(null)} className="text-emerald-400 hover:text-emerald-200 text-xs ml-2">✕</button>
        </div>
      )}

      {/* Live API Sync Status Card */}
      <div className="bg-[#13151f] border border-[#2a2d3e] rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <h3 className="text-base font-semibold text-white">Official Football API Integration</h3>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Checks public & official soccer APIs daily at 06:00 UTC for schedule changes, matchday adjustments, and kickoff confirmations.
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-300">
              <span className="bg-[#1c1f2e] px-2.5 py-1 rounded border border-[#2a2d3e]">
                📊 Total Season Fixtures: <strong className="text-white">{matches.length}</strong>
              </span>
              <span className="bg-[#1c1f2e] px-2.5 py-1 rounded border border-[#2a2d3e]">
                ⏳ Upcoming: <strong className="text-white">{upcomingCount}</strong>
              </span>
              <span className="bg-[#1c1f2e] px-2.5 py-1 rounded border border-[#2a2d3e]">
                🔄 Status: <span className="text-emerald-400">{apiStatus?.lastSyncStatus || 'Active (Daily Sync Enabled)'}</span>
              </span>
            </div>
          </div>
          <button
            onClick={handleSyncApi}
            disabled={syncing}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors shadow-sm shrink-0"
          >
            <span>{syncing ? '🔄 Syncing API...' : '⚡ Sync API Now'}</span>
          </button>
        </div>
      </div>

      <SectionCard
        title="Announcement Channel & Role"
        description="Configure which channel receives the 3-day match alert and which role to ping."
      >
        <Field
          label="Enable Automated Alerts"
          hint="When enabled, match announcements are automatically posted 3 days prior to kick-off."
        >
          <Toggle
            value={cfg.enabled}
            onChange={v => set('enabled', v)}
            label={cfg.enabled ? 'Active (Auto 3-Day Alerts On)' : 'Disabled'}
          />
        </Field>

        <Field
          label="Announcement Channel ID"
          hint="Text or Announcement Channel ID where match alerts will be sent."
        >
          <TextInput
            value={cfg.channelId}
            onChange={v => set('channelId', v)}
            placeholder="e.g. 123456789012345678"
          />
        </Field>

        <Field
          label="Alert Role ID (Optional)"
          hint="Role ID to ping at the very end of the announcement. Leave blank for no ping."
        >
          <TextInput
            value={cfg.roleId}
            onChange={v => set('roleId', v)}
            placeholder="e.g. 987654321098765432"
          />
        </Field>
      </SectionCard>

      {/* Season Matches List Preview */}
      <SectionCard
        title={`Scheduled Season Matches (${matches.length})`}
        description="Full FC Barcelona match schedule synchronized from official football APIs:"
      >
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {matches.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-6">No matches loaded yet. Click "Sync API Now" above.</div>
          ) : (
            matches.slice(0, 15).map(match => {
              const matchTime = new Date(match.kickoffUtc).getTime()
              const announceTime = matchTime - (3 * 24 * 60 * 60 * 1000)
              const isPast = matchTime < now
              const isAnnounceReady = now >= announceTime && !isPast
              const isPosted = cfg.postedMatches?.includes(match.id)

              let badgeColor = 'bg-blue-900/40 text-blue-300 border-blue-700/50'
              let badgeText = '⏳ Scheduled'

              if (isPast) {
                badgeColor = 'bg-gray-800 text-gray-400 border-gray-700'
                badgeText = match.score ? `🏁 Finished (${match.score})` : '🏁 Completed'
              } else if (isPosted) {
                badgeColor = 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
                badgeText = '✅ Announced (3-Day Alert Sent)'
              } else if (isAnnounceReady) {
                badgeColor = 'bg-amber-900/40 text-amber-300 border-amber-700/50'
                badgeText = '🚨 Within 3-Day Alert Window'
              }

              return (
                <div
                  key={match.id}
                  className="bg-[#0f1117] border border-[#2a2d3e] rounded-lg p-3 text-xs space-y-1.5 hover:border-[#3d425c] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold text-white text-sm">{match.title}</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] border font-medium ${badgeColor}`}>
                      {badgeText}
                    </span>
                  </div>
                  <div className="text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>🏆 <strong className="text-gray-300">{match.competition}</strong> ({match.matchday})</span>
                    <span>📍 <strong className="text-gray-300">{match.locationEn}</strong></span>
                    <span>📅 <strong className="text-gray-300">{match.kickoffEn}</strong></span>
                  </div>
                  {!isPast && (
                    <div className="text-[11px] text-gray-500 pt-0.5">
                      ⏱️ 3-day alert scheduled for: <span className="text-gray-400">{new Date(announceTime).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )
            })
          )}
          {matches.length > 15 && (
            <div className="text-center text-xs text-gray-500 py-2">
              ...and {matches.length - 15} more matches in the full season schedule.
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Live Announcement Template Preview"
        description="Every announcement adheres to this exact bilingual template with transport guides:"
      >
        <div className="bg-[#0f1117] border border-[#2a2d3e] rounded-xl p-5 font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
{`# FC BARCELONA – MATCHDAY ALERT / AVISO DE PARTIDO
**VALENCIA CF vs FC BARCELONA**

**LaLiga** – Matchday 38 / Jornada 38 (Final match of the season)

**Kick-off / Hora de inicio:** Saturday, May 23, 2026 – 9:00 PM CET / Sábado, 23 de mayo de 2026 – 21:00 CET 🇪🇸

**Location / Ubicación:** Estadio de Mestalla, Valencia 🇪🇸

**🔹 Transport / Transporte**
For those traveling to Mestalla, the stadium is well-connected within the city. The easiest way to get there is via the Valencia Metro (Lines 3, 5, 7, and 9), getting off directly at the 'Aragón' station, which leaves you right next to the stadium.

Para quienes viajen a Mestalla, el estadio está muy bien conectado dentro de la ciudad. La forma más fácil de llegar es a través del Metro de Valencia (Líneas 3, 5, 7 y 9), bajando directamente en la estación 'Aragón', la cual te deja justo al lado del campo.

${cfg.roleId ? `<@&${cfg.roleId}>` : '<@&MATCHDAY_ROLE>'}`}
        </div>
      </SectionCard>

      <SectionCard
        title="Quick Slash Commands"
        description="You can also manage match alerts directly inside Discord using slash commands:"
      >
        <div className="space-y-3 text-sm text-gray-300">
          <div className="flex items-center gap-2">
            <code className="bg-brand-950/60 text-brand-400 px-2 py-1 rounded border border-brand-800/40">/football set-channel #channel @role</code>
            <span className="text-gray-400">– Sets channel & optional ping role</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="bg-brand-950/60 text-brand-400 px-2 py-1 rounded border border-brand-800/40">/football sync-api</code>
            <span className="text-gray-400">– Force manual API refresh of all season fixtures</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="bg-brand-950/60 text-brand-400 px-2 py-1 rounded border border-brand-800/40">/football alert-now [match]</code>
            <span className="text-gray-400">– Instantly post an alert for testing or on-demand announcements</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="bg-brand-950/60 text-brand-400 px-2 py-1 rounded border border-brand-800/40">/football schedule</code>
            <span className="text-gray-400">– View all scheduled matches and 3-day countdown timers</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="bg-brand-950/60 text-brand-400 px-2 py-1 rounded border border-brand-800/40">/football custom-match</code>
            <span className="text-gray-400">– Add any custom match with venue and transport details</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="bg-brand-950/60 text-brand-400 px-2 py-1 rounded border border-brand-800/40">/football status</code>
            <span className="text-gray-400">– Check current config & announcement stats</span>
          </div>
        </div>
      </SectionCard>

      <div className="flex justify-end pt-2 pb-10">
        <SaveButton onClick={handleSave} saving={saving} saved={saved} />
      </div>
    </div>
  )
}
