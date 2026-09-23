// The dashboard server and the Discord bot run in the SAME Node process in production
// (`npm start` → dashboard/server/index.js imports src/app.js). The bot registers itself here so
// the dashboard can reach the live client directly (guild names, instant presence changes) instead
// of POSTing to an internal HTTP server that is intentionally disabled in that unified mode.

let botClient = null;

export function registerBotClient(client) {
  botClient = client;
}

/** The live bot client, or null when the bot isn't running in this process (or isn't ready). */
export function getReadyBotClient() {
  return botClient && typeof botClient.isReady === 'function' && botClient.isReady() ? botClient : null;
}
