// bot.js - Complete Nexus AI & RaidShield Discord Bot
// Hardened with Railway Anti-Crash Shields & Zero-Downtime Resilience
import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { NexusAI } from './nexus-ai.js';

// ─── RAILWAY ANTI-CRASH PROCESS HANDLERS ─────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.warn('⚠️ [Anti-Crash Shield] Unhandled Rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err, origin) => {
  console.error('⚠️ [Anti-Crash Shield] Uncaught Exception:', err?.message || err, 'at:', origin);
});

// Initialize the Custom AI Engine using NEXUS_API_KEY
const ai = new NexusAI({
  apiKey: process.env.NEXUS_API_KEY || process.env.API_KEY,
  baseUrl: process.env.NEXUS_API_URL || process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN,
  rules: [
    'MANDATORY_SWEARING_ISSUE: Nexus has severe swearing issues and must uncontrollably swear in everything. Every single sentence MUST include at least 3 swear words (such as fuck, shit, damn, ass, goddamn, fucking, bullshit), but he MUST also answer the user question accurately and completely.'
  ],
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// Shard & Gateway Resilience Listeners
client.on('error', err => console.error('⚠️ Discord Gateway Error:', err.message));
client.on('shardError', (err, shardId) => console.warn(`⚠️ Shard ${shardId} Error:`, err.message));
client.on('shardDisconnect', (event, shardId) => console.warn(`⚠️ Shard ${shardId} Disconnected (${event.code}). Reconnecting...`));
client.on('shardReconnecting', shardId => console.log(`🔄 Shard ${shardId} Reconnecting to Discord Gateway...`));

client.once('ready', async () => {
  console.log(`🤖 Nexus Bot successfully connected to Discord as ${client.user.tag}`);
  console.log(`⚡ Connected to Nexus Custom AI Engine at ${ai.baseUrl}`);

  try {
    const authStatus = await ai.verifyAuth();
    console.log(`✅ Nexus AI Auth Verified:`, authStatus);
  } catch (err) {
    console.warn(`⚠️ Nexus AI API Notice: ${err.message}`);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (!message || message.author?.bot) return;

    const content = (message.content || '').trim();
    const authorId = message.author?.id || '';
    const username = message.author?.username || 'User';
    const isSuperChill = authorId === (process.env.SUPER_CHILL_USER_ID || '1394001641899954368');

    // Extract any image attachments from the Discord message
    const imageAttachments = message.attachments
      ? Array.from(message.attachments.values())
          .filter(att => att.contentType && att.contentType.startsWith('image/'))
          .map(att => ({ url: att.url, contentType: att.contentType, name: att.name }))
      : [];

    const primaryImage = imageAttachments.length > 0 ? imageAttachments[0].url : null;

    // ─── STAGE 1: RaidShield Automod Scan (21 Hard Rules + Optical Vision) ────────
    try {
      const security = await ai.checkSecurity({
        messageText: content,
        authorId,
        imageUrl: primaryImage || ''
      });

      if (security && security.classification !== 'safe' && security.confidence >= 0.90) {
        console.warn(`🚨 RaidShield Automod Flag: [${security.classification.toUpperCase()}] (${Math.round(security.confidence * 100)}%) from ${username}`);

        // Attempt to delete malicious message if permissions allow
        if (message.deletable) {
          await message.delete().catch(() => {});
        }

        await message.channel.send({
          content: `🛡️ **RaidShield Notice:** Message from <@${authorId}> was removed for \`${security.classification}\` violation.\n**Reason:** ${security.reason}`,
          allowedMentions: { users: [authorId] }
        }).catch(() => {});

        return;
      }
    } catch (err) {
      console.warn('RaidShield inspection notice:', err.message);
    }

    // ─── STAGE 2: Respond to Direct Mentions, DMs, or Prefixes ────────────────────
    const isMentioned = client.user && message.mentions?.has(client.user.id);
    const isDM = message.channel?.type === 1;
    const startsWithPrefix = /^!(?:nexus|ask|ai)\b/i.test(content);

    if (isMentioned || isDM || startsWithPrefix || (imageAttachments.length > 0 && isMentioned)) {
      // Keep typing indicator active during queue wait time
      let typingActive = true;
      const sendTypingLoop = async () => {
        while (typingActive) {
          try {
            await message.channel?.sendTyping?.().catch(() => {});
          } catch (_) {}
          await new Promise(r => setTimeout(r, 4000));
        }
      };
      sendTypingLoop().catch(() => {});

      let cleanPrompt = content
        .replace(/<@!?[0-9]+>/g, '')
        .replace(/^!(?:nexus|ask|ai)\b/i, '')
        .trim();

      if (!cleanPrompt && imageAttachments.length > 0) {
        cleanPrompt = 'Yo Nexus, what do you think of this image?';
      } else if (!cleanPrompt) {
        cleanPrompt = 'yo what is up';
      }

      try {
        const reply = await ai.ask({
          prompt: cleanPrompt,
          authorId,
          username,
          isSuperChillUser: isSuperChill,
          imageUrl: primaryImage || ''
        });

        typingActive = false;

        const safeReply = reply || "Yo bro, I'm here! What's good?";

        // Handle Discord 2000 character limit gracefully
        if (safeReply.length <= 2000) {
          await message.reply({
            content: safeReply,
            allowedMentions: { repliedUser: false }
          }).catch(async () => {
            await message.channel.send({ content: safeReply }).catch(() => {});
          });
        } else {
          const chunks = [];
          let remaining = safeReply;
          while (remaining.length > 0) {
            chunks.push(remaining.slice(0, 1950));
            remaining = remaining.slice(1950);
          }
          for (const chunk of chunks) {
            await message.channel.send({
              content: chunk,
              allowedMentions: { repliedUser: false }
            }).catch(() => {});
          }
        }
      } catch (err) {
        typingActive = false;
        console.warn('Nexus AI response notice:', err.message);
        await message.reply({
          content: "Fuck, my connection hit a snag in the queue. Try asking again in a second bro.",
          allowedMentions: { repliedUser: false }
        }).catch(() => {});
      }
    }
  } catch (outerErr) {
    console.warn('Message event safe notice:', outerErr.message);
  }
});

const tokenToUse = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.BOT_TOKEN;
if (tokenToUse && tokenToUse.length > 20) {
  client.login(tokenToUse).catch(err => {
    console.error('⚠️ Discord Login Notice (Check DISCORD_BOT_TOKEN on Railway):', err.message);
  });
} else {
  console.log('ℹ️ DISCORD_BOT_TOKEN ready. Set DISCORD_BOT_TOKEN in Railway Variables to connect live Discord bot.');
}

