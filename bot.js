// bot.js
// Complete Discord.js v14 Bot with Nexus AI, RaidShield & Vision Scanning!
import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { NexusAI } from './nexus-ai.js';

const ai = new NexusAI({
  apiKey: process.env.NEXUS_API_KEY,
  baseUrl: process.env.NEXUS_API_URL,
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

client.once('ready', () => {
  console.log(`✅ Nexus Bot is online as ${client.user.tag}!`);
  console.log(`🔗 Connected to AI Engine at: ${ai.baseUrl}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const authorId = message.author.id;
  const username = message.author.username;
  const isSuperChillUser = authorId === process.env.SUPER_CHILL_USER_ID;

  // Extract any attached image URLs
  const imageAttachment = message.attachments.find((att) =>
    att.contentType?.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(att.name || '')
  );
  const imageUrl = imageAttachment ? imageAttachment.url : '';

  // ---------------------------------------------------------
  // STEP 1: RaidShield AI Automod (Text + Image Inspection)
  // ---------------------------------------------------------
  try {
    const security = await ai.checkSecurity({
      messageText: content,
      authorId: authorId,
      imageUrl: imageUrl,
    });

    if (security.classification !== 'safe' && security.confidence >= 0.90) {
      console.warn(`🚨 [RaidShield] Threat detected: ${security.classification} from ${username} (${authorId})`);
      
      if (message.deletable) {
        await message.delete().catch(() => {});
      }

      await message.channel.send({
        content: `🛡️ **RaidShield Automod**: Removed **${security.classification.toUpperCase()}** from <@${authorId}>.\n> *Reason*: ${security.reason}`,
      });

      return;
    }
  } catch (err) {
    console.error('RaidShield check error:', err.message);
  }

  // ---------------------------------------------------------
  // STEP 2: Nexus AI Chat, Commands & Vision Inquiries
  // ---------------------------------------------------------
  const isMentioned = message.mentions.has(client.user);
  const isPrefixCommand = content.startsWith('!nexus') || content.startsWith('!ask') || content.startsWith('!vision');

  if (isMentioned || isPrefixCommand) {
    let cleanPrompt = content
      .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
      .replace(/^!(nexus|ask|vision)\s*/i, '')
      .trim();

    if (!cleanPrompt && imageUrl) {
      cleanPrompt = 'What is in this image? Explain it to me.';
    } else if (!cleanPrompt) {
      cleanPrompt = 'Yo what is good?';
    }

    try {
      await message.channel.sendTyping();

      const reply = await ai.ask({
        prompt: cleanPrompt,
        authorId: authorId,
        username: username,
        isSuperChillUser: isSuperChillUser,
        imageUrl: imageUrl,
      });

      await message.reply({
        content: reply,
        allowedMentions: { repliedUser: false },
      });
    } catch (error) {
      console.error('Nexus reply error:', error);
      await message.reply('Damn bro, my neural engine had a hiccup reaching the server! Try again in a sec.');
    }
  }
});

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
if (token) {
  client.login(token);
} else {
  console.log('ℹ️ Set DISCORD_BOT_TOKEN in .env to launch Discord connection.');
}
