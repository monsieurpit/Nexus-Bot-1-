// "Nexus Code" — API routes for the repo-editing feature. Reached directly from the dashboard's
// permanent "Nexus Code" nav entry (no Discord step, no session link) — the real gatekeeper is
// the GitHub token the user pastes in on every request, which is never stored server-side and is
// the only thing that actually determines what repo can be pushed to.
import express from 'express';
import { nexusClient } from '../../../src/services/nexusAiService.js';
import { proposeEdit, applyEdit, rejectEdit, getPendingRequest } from '../services/repoEditService.js';

const router = express.Router();

/**
 * Asks the real Nexus AI engine to rewrite one file. Uses askCodeEdit (code-architect persona +
 * nexus-12b via the codeEditRequest flag — see server.ts) rather than askJSON/askNexusAi, since
 * this needs the raw modified file content back, not a conversational answer.
 */
async function generateEdit(oldContent, filePath, instruction) {
  const prompt =
    `Given this file's exact current content (path: ${filePath}), apply the following instruction ` +
    `and output ONLY the complete modified file content — no markdown fences, no explanation, ` +
    `nothing before or after the file content.\n\n` +
    `Instruction: ${instruction}\n\n` +
    `--- Current file content ---\n${oldContent}\n--- End of file ---`;
  const result = await nexusClient.askCodeEdit({ prompt });
  // askCodeEdit resolves to the plain response string (see nexus-ai.js) — strip accidental
  // markdown fences defensively in case the model wraps the file anyway.
  const text = typeof result === 'string' ? result : (result?.response || result?.text || '');
  return text.replace(/^```[\w-]*\n?/, '').replace(/```\s*$/, '').trim() + '\n';
}

router.post('/propose', async (req, res) => {
  const { repoUrl, filePath, instruction, githubToken } = req.body || {};
  if (!githubToken || typeof githubToken !== 'string') {
    return res.status(400).json({ error: 'A GitHub token is required.' });
  }

  try {
    const result = await proposeEdit({ repoUrl, filePath, instruction, githubToken, generateEdit });
    res.json(result);
  } catch (err) {
    if (err.code === 'BUSY') {
      return res.status(409).json({ error: err.message });
    }
    res.status(400).json({ error: err.message || 'Something went wrong proposing this edit.' });
  }
});

router.post('/apply', async (req, res) => {
  const { requestId, githubToken } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'Missing requestId.' });
  if (!githubToken || typeof githubToken !== 'string') {
    return res.status(400).json({ error: 'A GitHub token is required to push.' });
  }
  if (!getPendingRequest(requestId)) {
    return res.status(410).json({ error: 'This proposed change has expired or was already resolved — propose it again.' });
  }

  try {
    const result = await applyEdit({ requestId, githubToken });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Something went wrong applying this edit.' });
  }
});

router.post('/cancel', async (req, res) => {
  const { requestId } = req.body || {};
  if (requestId) await rejectEdit(requestId);
  res.json({ ok: true });
});

export default router;
