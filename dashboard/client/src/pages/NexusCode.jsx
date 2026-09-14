import { useState } from 'react'
import { SectionCard, Field, TextInput } from '../components/SectionCard.jsx'
import { ToolCallBlock } from '../components/codeedit/ToolCallBlock.jsx'
import { DiffView } from '../components/codeedit/DiffView.jsx'
import { Disclaimer } from '../components/codeedit/Disclaimer.jsx'

// "Nexus Code" — a permanent page in the dashboard, same as every other section (no session
// link, no Discord step required — you just come here directly, like the "Code" tab on
// claude.ai). The real gatekeeper is your own GitHub token, entered fresh every time and never
// stored: you can only ever push to repos that token actually has write access to.
const STEPS = { FORM: 'form', SUBMITTING: 'submitting', DIFF: 'diff', APPLYING: 'applying', DONE: 'done' }

export default function NexusCode() {
  const [step, setStep] = useState(STEPS.FORM)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ repoUrl: '', filePath: '', instruction: '', githubToken: '' })
  const [proposal, setProposal] = useState(null) // { requestId, filePath, lineDiff }
  const [result, setResult] = useState(null) // { commitUrl }

  async function handlePropose(e) {
    e.preventDefault()
    setError('')
    setStep(STEPS.SUBMITTING)
    try {
      const res = await fetch('/api/codeedit/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setProposal(body)
      setStep(STEPS.DIFF)
    } catch (err) {
      setError(err.message)
      setStep(STEPS.FORM)
    }
  }

  async function handleApprove() {
    setError('')
    setStep(STEPS.APPLYING)
    try {
      const res = await fetch('/api/codeedit/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: proposal.requestId, githubToken: form.githubToken }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setResult(body)
      setStep(STEPS.DONE)
    } catch (err) {
      setError(err.message)
      setStep(STEPS.DIFF)
    }
  }

  function handleReject() {
    setError('')
    fetch('/api/codeedit/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: proposal?.requestId }),
    }).catch(() => {})
    setProposal(null)
    setResult(null)
    setStep(STEPS.FORM)
  }

  function handleStartOver() {
    setProposal(null)
    setResult(null)
    setError('')
    setForm(f => ({ ...f, instruction: '' }))
    setStep(STEPS.FORM)
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-white text-xl font-semibold flex items-center gap-2">🧑‍💻 Nexus Code</h1>
        <p className="text-gray-500 text-sm mt-1">Nexus proposes a code change to your own GitHub repo — you review the diff before anything is pushed.</p>
      </div>

      {(step === STEPS.FORM || step === STEPS.SUBMITTING) && (
        <SectionCard title="Repo & change" description="Only your own repo — a token for a repo you don't own can't push anywhere useful.">
          <form onSubmit={handlePropose} className="space-y-5">
            <Field label="Repo URL" hint="https://github.com/<owner>/<repo>">
              <TextInput
                value={form.repoUrl}
                onChange={v => setForm(f => ({ ...f, repoUrl: v }))}
                placeholder="https://github.com/yourname/yourrepo"
              />
            </Field>
            <Field label="File path" hint="One file only, relative to the repo root">
              <TextInput
                value={form.filePath}
                onChange={v => setForm(f => ({ ...f, filePath: v }))}
                placeholder="src/index.js"
              />
            </Field>
            <Field label="Instruction" hint="Describe the change you want, as specifically as you can">
              <textarea
                value={form.instruction}
                onChange={e => setForm(f => ({ ...f, instruction: e.target.value }))}
                placeholder="Add a null check before using user.email"
                rows={4}
                className="w-full bg-[#0f1117] border border-[#2a2d3e] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder-gray-600"
              />
            </Field>
            <Field label="GitHub token" hint="A personal access token with write access to this repo only — never stored, used once per request">
              <TextInput
                type="password"
                value={form.githubToken}
                onChange={v => setForm(f => ({ ...f, githubToken: v }))}
                placeholder="ghp_…"
              />
            </Field>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={step === STEPS.SUBMITTING}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              {step === STEPS.SUBMITTING ? 'Nexus is working on it…' : 'Propose change'}
            </button>
          </form>
        </SectionCard>
      )}

      {(step === STEPS.DIFF || step === STEPS.APPLYING) && proposal && (
        <div className="space-y-4">
          <ToolCallBlock filePath={proposal.filePath}>
            <DiffView lineDiff={proposal.lineDiff} />
          </ToolCallBlock>

          <Disclaimer />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              disabled={step === STEPS.APPLYING}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              {step === STEPS.APPLYING ? 'Pushing…' : '✅ Approve & push'}
            </button>
            <button
              onClick={handleReject}
              disabled={step === STEPS.APPLYING}
              className="bg-[#2a2d3e] hover:bg-[#343747] disabled:opacity-50 text-gray-200 text-sm font-medium rounded-lg px-4 py-2 transition-colors"
            >
              ❌ Reject
            </button>
          </div>
        </div>
      )}

      {step === STEPS.DONE && result && (
        <SectionCard title="Pushed">
          <p className="text-gray-300 text-sm mb-4">
            Change pushed successfully.{' '}
            {result.commitUrl && (
              <a href={result.commitUrl} target="_blank" rel="noreferrer" className="text-brand-400 hover:underline">
                View the commit on GitHub →
              </a>
            )}
          </p>
          <button
            onClick={handleStartOver}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            Propose another change
          </button>
        </SectionCard>
      )}
    </div>
  )
}
