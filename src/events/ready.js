import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";
import { nexusClient } from "../services/nexusAiService.js";

const PRESENCE_INTERVAL_MS = 10 * 60 * 1000;

const presences = [
  {
    status: "online",
    activities: [{ name: "your server", type: 2 }],
  },
  {
    status: "online",
    activities: [{ name: "My fellow users!", type: 2 }],
  },
];

// Artificial "feelings" (moodEngine.ts, server-side) made visible — the bot's own Discord presence
// now reflects its current mood instead of only cycling two fixed lines. A live GET to
// nexusClient.getMood() on every rotation tick (cheap: no auth, no LLM call, just the server's
// in-memory mood) rather than baking mood text into the static `presences` list above, since mood
// changes continuously and a stale cached value would defeat the entire point of showing it.
// Discord's online/idle/dnd status dot is mapped to the mood's general energy so the color itself
// carries a hint even before anyone reads the actual text — angry reads as "do not disturb" red,
// low-energy moods (bored/sad/depressed) read as idle yellow, everything else stays online green.
function statusForMood(label) {
  if (label === "angry") return "dnd";
  if (label === "bored" || label === "sad" || label === "depressed") return "idle";
  return "online";
}

async function buildMoodPresence() {
  try {
    const mood = await nexusClient.getMood();
    if (!mood || !mood.label) return null;
    const text = `Feeling ${mood.emoji} ${mood.name}`;
    return {
      status: statusForMood(mood.label),
      // Custom Status (type 4) is the only activity type that shows arbitrary free text as-is —
      // the Watching/Listening types used by the two static presences above always prefix with
      // their own verb ("Watching your server"), which reads wrong for "Feeling Angry". discord.js
      // still requires a non-empty `name` even for a custom activity, so it's set to the same text
      // as `state` (the field Discord actually renders for type 4).
      activities: [{ name: text, type: 4, state: text }],
    };
  } catch (error) {
    // Nexus-AI's server being briefly unreachable shouldn't break presence rotation or spam the
    // logs on every 10-minute tick — this is best-effort cosmetic telemetry, not a real error.
    logger.warn("Mood presence fetch failed, skipping this rotation:", error?.message || error);
    return null;
  }
}

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(presences[0]);

      // 3-slot rotation: the two original static lines, plus a freshly-fetched mood presence as
      // the third slot. If the mood fetch fails on a given tick, that slot is silently skipped for
      // this rotation (falls through to whatever presence was already showing) rather than setting
      // a broken/empty presence.
      let presenceIndex = 0;
      setInterval(async () => {
        presenceIndex = (presenceIndex + 1) % 3;
        const nextPresence = presenceIndex < presences.length ? { ...presences[presenceIndex] } : await buildMoodPresence();
        if (!nextPresence) return;
        if (client.customStatus) {
          nextPresence.status = client.customStatus;
        }
        client.user.setPresence(nextPresence);
      }, PRESENCE_INTERVAL_MS);

      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands.size} commands`);

      const reconciliationSummary = await reconcileReactionRoleMessages(client);
      startupLog(
        `Reaction role reconciliation: scanned ${reconciliationSummary.scannedMessages}, removed ${reconciliationSummary.removedMessages}, errors ${reconciliationSummary.errors}`
      );
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
