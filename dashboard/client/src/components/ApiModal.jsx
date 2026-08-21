import { useState, useEffect } from 'react'

export default function ApiModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('setup')
  const [copiedKey, setCopiedKey] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [authStatus, setAuthStatus] = useState(null)

  // Chat Tab State
  const [testPrompt, setTestPrompt] = useState('yo what is up bro')
  const [isVipUser, setIsVipUser] = useState(true)
  const [chatImageUrl, setChatImageUrl] = useState('')
  const [chatResponse, setChatResponse] = useState(null)
  const [chatLoading, setChatLoading] = useState(false)

  // Vision Tab State
  const [visionImage, setVisionImage] = useState('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500')
  const [visionPrompt, setVisionPrompt] = useState('Analyze this image and extract all readable text or icons.')
  const [visionSecurityScan, setVisionSecurityScan] = useState(false)
  const [visionResponse, setVisionResponse] = useState(null)
  const [visionLoading, setVisionLoading] = useState(false)

  // Security Tab State
  const [secText, setSecText] = useState('FREE NITRO: http://dlscord.gift/drop @everyone @here')
  const [secResponse, setSecResponse] = useState(null)
  const [secLoading, setSecLoading] = useState(false)

  // Queue & Railway State
  const [queueStats, setQueueStats] = useState(null)
  const [burstRunning, setBurstRunning] = useState(false)
  const [burstResults, setBurstResults] = useState([])

  const apiKey = 'nexus_sk_discord_bot_1394001641899954368'
  const apiUrl = `${window.location.origin}/api/v1`

  useEffect(() => {
    if (isOpen) {
      fetch('/api/v1/auth/verify', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
        .then(res => res.json())
        .then(data => setAuthStatus(data))
        .catch(() => setAuthStatus({ valid: false }));

      fetchQueueStats();
    }
  }, [isOpen])

  const fetchQueueStats = () => {
    fetch('/api/v1/health')
      .then(res => res.json())
      .then(data => setQueueStats(data))
      .catch(() => {});
  }

  if (!isOpen) return null

  const handleCopyKey = () => {
    navigator.clipboard.writeText(apiKey)
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(apiUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const handleChatTest = async () => {
    setChatLoading(true)
    setChatResponse(null)
    try {
      const res = await fetch('/api/v1/nexus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: testPrompt,
          authorId: isVipUser ? '1394001641899954368' : '999999999999999999',
          username: isVipUser ? 'VIP Legend' : 'Casual User',
          isSuperChillUser: isVipUser,
          image: chatImageUrl.trim() || null
        })
      })
      const data = await res.json()
      setChatResponse(data)
      fetchQueueStats()
    } catch (err) {
      setChatResponse({ error: err.message })
    } finally {
      setChatLoading(false)
    }
  }

  const handleVisionTest = async () => {
    setVisionLoading(true)
    setVisionResponse(null)
    try {
      const res = await fetch('/api/v1/vision/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          image: visionImage,
          prompt: visionPrompt,
          isSecurityScan: visionSecurityScan
        })
      })
      const data = await res.json()
      setVisionResponse(data)
      fetchQueueStats()
    } catch (err) {
      setVisionResponse({ error: err.message })
    } finally {
      setVisionLoading(false)
    }
  }

  const handleSecurityTest = async (overrideText) => {
    const textToTest = overrideText || secText
    if (overrideText) setSecText(overrideText)
    setSecLoading(true)
    setSecResponse(null)
    try {
      const res = await fetch('/api/v1/raidshield', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messageText: textToTest,
          authorId: '1394001641899954368'
        })
      })
      const data = await res.json()
      setSecResponse(data)
      fetchQueueStats()
    } catch (err) {
      setSecResponse({ error: err.message })
    } finally {
      setSecLoading(false)
    }
  }

  const runBurstStressTest = async () => {
    setBurstRunning(true)
    setBurstResults([])
    const requests = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      prompt: `Burst query #${i + 1}: What is ${i + 1} * 7?`
    }))

    const results = []
    for (const req of requests) {
      fetch('/api/v1/nexus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          prompt: req.prompt,
          authorId: '1394001641899954368',
          username: `Tester_${req.id}`
        })
      })
        .then(r => r.json())
        .then(data => {
          results.push({ id: req.id, success: true, telemetry: data.telemetry, response: data.response })
          setBurstResults([...results])
          fetchQueueStats()
        })
        .catch(err => {
          results.push({ id: req.id, success: false, error: err.message })
          setBurstResults([...results])
        })
    }

    setTimeout(() => {
      setBurstRunning(false)
      fetchQueueStats()
    }, 4000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="bg-[#10121a] border border-[#1e2233] rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2233] bg-[#0c0e14]">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Nexus Custom AI & RaidShield Engine</h2>
                {authStatus?.valid ? (
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold rounded-full">
                    ● Live Verified
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-semibold rounded-full">
                    Ready
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">Autonomous Dual-Engine API, Multimodal Vision, and FIFO Waitlist Queue</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#1e2233] bg-[#141622] px-6 gap-2 text-xs font-medium">
          {[
            { id: 'setup', label: '🔑 API & SDK Setup' },
            { id: 'chat', label: '💬 Live AI & Casseurt' },
            { id: 'vision', label: '🖼️ Multimodal Vision' },
            { id: 'security', label: '🛡️ RaidShield 21-Rules' },
            { id: 'queue', label: '🚦 FIFO Queue & Burst' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-300 font-bold'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* TAB 1: API & SDK SETUP */}
          {activeTab === 'setup' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#161824] p-4 rounded-xl border border-[#222638] space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-400">NEXUS_API_KEY</label>
                    <button 
                      onClick={handleCopyKey}
                      className="px-2.5 py-1 bg-brand-600/80 hover:bg-brand-500 text-white text-[11px] font-semibold rounded-md transition-colors"
                    >
                      {copiedKey ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <input 
                    type="text" 
                    readOnly 
                    value={apiKey} 
                    className="w-full bg-[#0d0e14] border border-[#222638] rounded-lg px-3 py-2 text-xs text-brand-300 font-mono focus:outline-none"
                  />
                </div>

                <div className="bg-[#161824] p-4 rounded-xl border border-[#222638] space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-400">NEXUS_API_URL</label>
                    <button 
                      onClick={handleCopyUrl}
                      className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold rounded-md transition-colors"
                    >
                      {copiedUrl ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <input 
                    type="text" 
                    readOnly 
                    value={apiUrl} 
                    className="w-full bg-[#0d0e14] border border-[#222638] rounded-lg px-3 py-2 text-xs text-gray-300 font-mono focus:outline-none"
                  />
                </div>
              </div>

              {/* Bot Quickstart */}
              <div className="bg-[#161824] p-4 rounded-xl border border-[#222638] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-200 uppercase tracking-wider">🚀 3-Step Discord Bot Quickstart</span>
                  <span className="text-[11px] text-brand-400 font-mono">bot.js & nexus-ai.js ready in root</span>
                </div>
                <div className="bg-[#0b0c12] p-3 rounded-lg border border-[#1b1e2c] text-xs font-mono text-gray-300 space-y-1">
                  <p className="text-gray-500"># 1. Install dependencies</p>
                  <p className="text-emerald-400">npm install discord.js dotenv</p>
                  <p className="text-gray-500 mt-2"># 2. Configure .env with your DISCORD_BOT_TOKEN</p>
                  <p className="text-brand-300">DISCORD_BOT_TOKEN="your_token_here"</p>
                  <p className="text-gray-500 mt-2"># 3. Start your custom AI Discord Bot</p>
                  <p className="text-emerald-400">node bot.js</p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LIVE AI & CASSEURT TESTER */}
          {activeTab === 'chat' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTestPrompt('Do you like Casseurt?')}
                  className="px-2.5 py-1 bg-red-950/40 border border-red-800/50 hover:bg-red-900/50 text-red-300 text-xs rounded-lg transition-colors"
                >
                  💥 Test Casseurt Crash-Out Rant
                </button>
                <button
                  onClick={() => setTestPrompt('Yo what is 1337 * 42?')}
                  className="px-2.5 py-1 bg-blue-950/40 border border-blue-800/50 hover:bg-blue-900/50 text-blue-300 text-xs rounded-lg transition-colors"
                >
                  ⚡ Test Math/Logic
                </button>
                <button
                  onClick={() => setTestPrompt('How do I make a clean Discord bot in Node.js?')}
                  className="px-2.5 py-1 bg-purple-950/40 border border-purple-800/50 hover:bg-purple-900/50 text-purple-300 text-xs rounded-lg transition-colors"
                >
                  💻 Test Coding Advice
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-gray-300">User Prompt</label>
                  <label className="flex items-center gap-2 text-xs text-amber-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isVipUser}
                      onChange={e => setIsVipUser(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-brand-600 focus:ring-0"
                    />
                    <span>Super Chill VIP Mode (ID: 1394001641899954368)</span>
                  </label>
                </div>
                <textarea
                  value={testPrompt}
                  onChange={e => setTestPrompt(e.target.value)}
                  rows={3}
                  className="w-full bg-[#161824] border border-[#222638] rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">Optional Image URL attachment</label>
                <input
                  type="text"
                  placeholder="https://... (or leave empty for text-only)"
                  value={chatImageUrl}
                  onChange={e => setChatImageUrl(e.target.value)}
                  className="w-full bg-[#161824] border border-[#222638] rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none"
                />
              </div>

              <button
                onClick={handleChatTest}
                disabled={chatLoading}
                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-50"
              >
                {chatLoading ? '⚡ Processing in FIFO Queue...' : '🚀 Send Prompt to Nexus AI Engine'}
              </button>

              {chatResponse && (
                <div className="bg-[#141622] border border-[#222638] rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-center text-[11px] text-gray-400 border-b border-[#222638] pb-2">
                    <span className="text-brand-300 font-bold">Persona: {chatResponse.persona || 'nexus-homie'}</span>
                    <span>Tokens: {chatResponse.tokens || '~'}</span>
                    {chatResponse.telemetry && (
                      <span className="text-emerald-400 font-mono">
                        Queue: {chatResponse.telemetry.waitedInQueueMs}ms | Exec: {chatResponse.telemetry.executionTimeMs}ms
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-sans text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {chatResponse.response || chatResponse.text || JSON.stringify(chatResponse, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MULTIMODAL VISION */}
          {activeTab === 'vision' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-300">Image Source (URL or Base64)</label>
                <input
                  type="text"
                  value={visionImage}
                  onChange={e => setVisionImage(e.target.value)}
                  className="w-full bg-[#161824] border border-[#222638] rounded-lg px-3 py-2 text-xs text-brand-300 font-mono focus:outline-none"
                />
                {visionImage && (
                  <div className="h-32 bg-[#0c0e14] border border-[#222638] rounded-lg overflow-hidden flex items-center justify-center p-2">
                    <img src={visionImage} alt="Preview" className="max-h-full object-contain rounded" onError={() => {}} />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-gray-300">Vision Prompt / OCR Directive</label>
                  <label className="flex items-center gap-2 text-xs text-red-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visionSecurityScan}
                      onChange={e => setVisionSecurityScan(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-red-600 focus:ring-0"
                    />
                    <span>Security Threat / Fake Nitro Scan Mode</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={visionPrompt}
                  onChange={e => setVisionPrompt(e.target.value)}
                  className="w-full bg-[#161824] border border-[#222638] rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <button
                onClick={handleVisionTest}
                disabled={visionLoading}
                className="w-full py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-50"
              >
                {visionLoading ? '👁️ Inspecting Image Optical Features...' : '🔍 Analyze Multimodal Image'}
              </button>

              {visionResponse && (
                <div className="bg-[#141622] border border-[#222638] rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center text-[11px] text-gray-400 border-b border-[#222638] pb-2">
                    <span className="text-teal-300 font-bold">Model: {visionResponse.modelUsed || 'Flash Vision'}</span>
                    <span className={`font-semibold ${visionResponse.safety === 'threat_detected' ? 'text-red-400' : 'text-emerald-400'}`}>
                      Status: {visionResponse.safety}
                    </span>
                  </div>
                  <div className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {visionResponse.analysis || JSON.stringify(visionResponse, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: RAIDSHIELD 21-RULES */}
          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleSecurityTest('FREE NITRO: http://dlscord.gift/drop @everyone @here')}
                  className="px-2.5 py-1 bg-red-950/40 border border-red-800/50 hover:bg-red-900/50 text-red-300 text-xs rounded-lg transition-colors"
                >
                  🚨 Test Fake Nitro Scam
                </button>
                <button
                  onClick={() => handleSecurityTest('token="MTA5NDAwMTY0MTg5OTk1NDM2OA.Gc8x9Y.aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5z"')}
                  className="px-2.5 py-1 bg-amber-950/40 border border-amber-800/50 hover:bg-amber-900/50 text-amber-300 text-xs rounded-lg transition-colors"
                >
                  🔑 Test Token Stealer
                </button>
                <button
                  onClick={() => handleSecurityTest('Hey homies, check out this sweet new React tutorial I made for the server!')}
                  className="px-2.5 py-1 bg-emerald-950/40 border border-emerald-800/50 hover:bg-emerald-900/50 text-emerald-300 text-xs rounded-lg transition-colors"
                >
                  ✅ Test Safe Chat
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-300">Message Text for Security Scan</label>
                <textarea
                  value={secText}
                  onChange={e => setSecText(e.target.value)}
                  rows={3}
                  className="w-full bg-[#161824] border border-[#222638] rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <button
                onClick={() => handleSecurityTest()}
                disabled={secLoading}
                className="w-full py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-50"
              >
                {secLoading ? '🛡️ Running 21 Hard Rules Scanner...' : '🛡️ Scan with RaidShield Engine'}
              </button>

              {secResponse && (
                <div className="bg-[#141622] border border-[#222638] rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-center text-xs border-b border-[#222638] pb-2">
                    <span className="font-bold uppercase tracking-wider text-gray-300">
                      Classification:{' '}
                      <span className={secResponse.classification === 'safe' ? 'text-emerald-400' : 'text-red-400'}>
                        {secResponse.classification}
                      </span>
                    </span>
                    <span className="font-mono text-gray-400">
                      Confidence: {Math.round((secResponse.confidence || 0) * 100)}%
                    </span>
                  </div>
                  <div className="text-xs text-gray-300">
                    <span className="font-semibold text-gray-400">Action Recommended: </span>
                    <span className="font-mono text-amber-300">{secResponse.actionRecommended || 'NONE'}</span>
                  </div>
                  <div className="text-xs text-gray-300">
                    <span className="font-semibold text-gray-400">Reason: </span>
                    {secResponse.reason}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: QUEUE & BURST SIMULATOR */}
          {activeTab === 'queue' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#161824] p-3 rounded-xl border border-[#222638]">
                  <p className="text-[11px] text-gray-400">Queue Length</p>
                  <p className="text-xl font-bold text-brand-300 font-mono">{queueStats?.queue?.queueLength || 0}</p>
                </div>
                <div className="bg-[#161824] p-3 rounded-xl border border-[#222638]">
                  <p className="text-[11px] text-gray-400">Active Workers</p>
                  <p className="text-xl font-bold text-emerald-400 font-mono">{queueStats?.queue?.activeRequests || 0}</p>
                </div>
                <div className="bg-[#161824] p-3 rounded-xl border border-[#222638]">
                  <p className="text-[11px] text-gray-400">Total Processed</p>
                  <p className="text-xl font-bold text-white font-mono">{queueStats?.queue?.totalProcessed || 0}</p>
                </div>
                <div className="bg-[#161824] p-3 rounded-xl border border-[#222638]">
                  <p className="text-[11px] text-gray-400">Guard Timeout</p>
                  <p className="text-xl font-bold text-gray-300 font-mono">45s</p>
                </div>
              </div>

              <div className="bg-[#161824] p-4 rounded-xl border border-[#222638] space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider">Multi-Server Burst Simulator</h3>
                    <p className="text-[11px] text-gray-400">Dispatches 8 concurrent requests to verify FIFO ordering and crash immunity</p>
                  </div>
                  <button
                    onClick={runBurstStressTest}
                    disabled={burstRunning}
                    className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {burstRunning ? 'Simulating Burst...' : '⚡ Run 8-Request Burst'}
                  </button>
                </div>

                {burstResults.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pt-2 border-t border-[#222638]">
                    {burstResults.map(res => (
                      <div key={res.id} className="flex justify-between items-center bg-[#0d0e14] px-3 py-1.5 rounded text-xs font-mono">
                        <span className="text-brand-300 font-bold">Query #{res.id}</span>
                        {res.telemetry && (
                          <span className="text-gray-400">
                            Wait: {res.telemetry.waitedInQueueMs}ms | Exec: {res.telemetry.executionTimeMs}ms
                          </span>
                        )}
                        <span className="text-emerald-400 font-semibold">✓ Completed</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-[#1e2233] bg-[#0c0e14] flex justify-between items-center text-xs text-gray-400">
          <span>Nexus Autonomous Engine v1.0 • Railway & Discord.js v14 Ready</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
