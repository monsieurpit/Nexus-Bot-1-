import { EmbedBuilder } from 'discord.js';
import { getColor, BotConfig } from '../config/bot.js';
import { getBotClient } from './botRegistry.js';

// ─── Nexus embed theme ──────────────────────────────────────────────────────────
// Every bot-authored embed gets the same signature: theme colour, a branded footer with the
// bot's avatar ("Nexus"), and a timestamp. Pass `footer: false` for content written by server
// staff (embed builder, sticky notes, welcome templates, /say) so it isn't branded as the bot's.
export function brandFooter(extra = null) {
  const name = BotConfig?.embeds?.footer?.text || 'Nexus';
  const text = extra ? `${name} • ${extra}` : name;
  const iconURL = BotConfig?.embeds?.footer?.icon || getBotClient()?.user?.displayAvatarURL?.({ size: 64 }) || undefined;
  return iconURL ? { text: text.substring(0, 2048), iconURL } : { text: text.substring(0, 2048) };
}

export function createEmbed({
  title = '',
  description = '',
  color = 'primary',
  fields = [],
  author = null,
  footer = 'auto',
  thumbnail = null,
  image = null,
  timestamp = true,
  url = null
} = {}) {
  const embed = new EmbedBuilder();
  
  
  if (title && typeof title === 'string' && title.length > 0) {
    embed.setTitle(title.substring(0, 256));
  }
  
  
  if (description && typeof description === 'string' && description.length > 0) {
    embed.setDescription(description.substring(0, 4096));
  }
  
  
  try {
    // Accepts a theme name ('primary', 'economy', 'ticket.open'), a hex string or a number.
    const embedColor = typeof color === 'number' ? color : (getColor(color) || '#000000');
    embed.setColor(embedColor);
  } catch (error) {
    embed.setColor('#000000');
  }

  
  if (Array.isArray(fields) && fields.length > 0) {
    // Clamped to Discord's limits (name 256 / value 1024) — a single over-long field value (a long
    // reason, a role list, a message excerpt) used to make addFields() throw and the whole reply fail.
    const validFields = fields
      .filter(f => f && f.name && f.value !== undefined && f.value !== null && String(f.value).length > 0)
      .map(f => ({
        name: String(f.name).substring(0, 256),
        value: String(f.value).length > 1024 ? `${String(f.value).substring(0, 1023)}…` : String(f.value),
        inline: Boolean(f.inline)
      }));
    if (validFields.length > 0) {
      embed.addFields(validFields.slice(0, 25)); 
    }
  }

  
  if (author) {
    try {
      if (typeof author === 'string' && author.length > 0) {
        embed.setAuthor({ name: author.substring(0, 256) });
      } else if (author && typeof author.name === 'string') {
        embed.setAuthor(author);
      }
    } catch (error) {
      
    }
  }

  
  if (footer === null || footer === undefined) footer = 'auto';
  if (footer) {
    try {
      if (footer === 'auto') {
        embed.setFooter(brandFooter());
      } else if (typeof footer === 'string' && footer.length > 0) {
        // A plain footer string keeps the Nexus signature in front of it.
        embed.setFooter(brandFooter(footer));
      } else if (footer && typeof footer.text === 'string') {
        embed.setFooter(footer);
      }
    } catch (error) {
      
    }
  }

  
  if (thumbnail) {
    try {
      if (typeof thumbnail === 'string' && thumbnail.length > 0) {
        embed.setThumbnail(thumbnail);
      } else if (thumbnail && typeof thumbnail.url === 'string') {
        embed.setThumbnail(thumbnail.url);
      }
    } catch (error) {
      
    }
  }

  
  if (image) {
    try {
      if (typeof image === 'string' && image.length > 0) {
        embed.setImage(image);
      } else if (image && typeof image.url === 'string') {
        embed.setImage(image.url);
      }
    } catch (error) {
      
    }
  }

  
  if (timestamp === true) {
    embed.setTimestamp();
  } else if (timestamp instanceof Date) {
    embed.setTimestamp(timestamp);
  }

  
  if (url && typeof url === 'string' && url.length > 0) {
    try {
      embed.setURL(url);
    } catch (error) {
      
    }
  }

  return embed;
}

// These helpers are declared as (message, title), but most of the codebase calls them as
// (title, message) — e.g. errorEmbed('Permission Denied', 'You need …') or
// successEmbed('Task Added', `Added "x" to the list.`). With the literal signature that showed the
// sentence as a (256-char-truncated) title, and errorEmbed silently DROPPED the explanation in
// production (it was treated as debug detail). The order is now inferred from the text itself.
const EMOJI_START = /^\p{Extended_Pictographic}/u;

function looksLikeTitle(text) {
  return typeof text === 'string' && text.length > 0 && text.length <= 100 && !text.includes('\n');
}

function looksLikeSentence(text) {
  return typeof text === 'string' && (/[.!?:)]$/.test(text.trim()) || /[\n`*<]/.test(text));
}

/** Returns { title, message } for two string arguments given in either order. */
export function resolveTitleAndMessage(first, second) {
  const firstTitle = looksLikeTitle(first);
  const secondTitle = looksLikeTitle(second);
  if (firstTitle && !secondTitle) return { title: first, message: second };
  if (secondTitle && !firstTitle) return { title: second, message: first };
  if (firstTitle && secondTitle) {
    const firstEmoji = EMOJI_START.test(first);
    const secondEmoji = EMOJI_START.test(second);
    if (secondEmoji && !firstEmoji) return { title: second, message: first };
    if (firstEmoji && !secondEmoji) return { title: first, message: second };
    const firstSentence = looksLikeSentence(first);
    const secondSentence = looksLikeSentence(second);
    if (firstSentence && !secondSentence) return { title: second, message: first };
    if (secondSentence && !firstSentence) return { title: first, message: second };
    return first.length <= second.length ? { title: first, message: second } : { title: second, message: first };
  }
  // Neither is title-shaped: keep the declared (message, title) order.
  return { title: second, message: first };
}

const STATUS_ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

/** Every status title carries its status icon, unless it already starts with an emoji. */
export function withStatusIcon(title, color) {
  const icon = STATUS_ICONS[color];
  if (!icon || typeof title !== 'string' || !title.trim()) return title;
  return EMOJI_START.test(title.trim()) ? title : `${icon} ${title.trim()}`;
}

function buildStatusEmbed(first, second, { defaultTitle, color }) {
  if (typeof first === 'string' && typeof second === 'string' && second.length > 0) {
    const { title, message } = resolveTitleAndMessage(first, second);
    return createEmbed({ title: withStatusIcon(title, color), description: message, color, timestamp: true });
  }
  return createEmbed({ title: defaultTitle, description: stripLeadingIcon(first, color), color, timestamp: true });
}

// "❌ Error" title over "❌ You can't…" showed the icon twice; the title already carries it.
function stripLeadingIcon(text, color) {
  const icon = STATUS_ICONS[color];
  if (typeof text !== 'string' || !icon) return text;
  const trimmed = text.trimStart();
  return trimmed.startsWith(icon) ? trimmed.slice(icon.length).trimStart() : text;
}

export function errorEmbed(message, error = null, options = {}) {
  // errorEmbed('Title', 'What went wrong') — two strings: a title and a user-facing message.
  if (typeof message === 'string' && typeof error === 'string' && error.length > 0) {
    return buildStatusEmbed(message, error, { defaultTitle: '❌ Error', color: 'error' });
  }

  // errorEmbed('What went wrong', errorObject) — the error's own text is debug detail, shown
  // outside production only.
  const { showDetails = process.env.NODE_ENV !== 'production' } = options;
  let description = stripLeadingIcon(message, 'error');

  if (error && showDetails) {
    const detailText = typeof error === 'string' ? error : (error.message || String(error));
    description = `${message}\n${formatCodeBlock(detailText)}`;
  }

  return createEmbed({
    title: '❌ Error',
    description,
    color: 'error',
    timestamp: true
  });
}

export function successEmbed(message, title = '✅ Success') {
  return buildStatusEmbed(message, title, { defaultTitle: '✅ Success', color: 'success' });
}

export function infoEmbed(message, title = 'ℹ️ Information') {
  return buildStatusEmbed(message, title, { defaultTitle: 'ℹ️ Information', color: 'info' });
}

export function warningEmbed(message, title = '⚠️ Warning') {
  return buildStatusEmbed(message, title, { defaultTitle: '⚠️ Warning', color: 'warning' });
}

export function formatUser(user) {
  return `${user} (${user.tag} | ${user.id})`;
}

export function formatDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

export function formatRelativeTime(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

export function formatCodeBlock(content, language = '') {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

export function formatInlineCode(content) {
  return `\`${content}\``;
}

export function formatBold(content) {
  return `**${content}**`;
}

export function formatItalic(content) {
  return `*${content}*`;
}

export function formatUnderline(content) {
  return `__${content}__`;
}

export function formatStrikethrough(content) {
  return `~~${content}~~`;
}

export function formatSpoiler(content) {
  return `||${content}||`;
}

export function formatQuote(content) {
  return `> ${content}`;
}

export function formatList(items, ordered = false) {
  return items
    .map((item, index) => (ordered ? `${index + 1}.` : '•') + ` ${item}`)
    .join('\n');
}

export function formatProgressBar(current, max, size = 10) {
  const progress = max > 0 ? Math.min(Math.max(0, current / max), 1) : 0;
  const filled = Math.round(size * progress);
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} **${Math.round(progress * 100)}%**`;
}

/** 12345 → "12,345". */
export function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value ?? '0');
}

/** Field helper: field('Name', value, true). Empty values render as an em dash. */
export function field(name, value, inline = false) {
  const text = value === undefined || value === null || String(value).length === 0 ? '—' : String(value);
  return { name: String(name), value: text, inline };
}

/** "• a\n• b" with an optional cap ("…and 3 more"). */
export function bulletList(items, max = 15) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return '—';
  const shown = list.slice(0, max).map((i) => `• ${i}`);
  if (list.length > max) shown.push(`*…and ${list.length - max} more*`);
  return shown.join('\n');
}

/**
 * The standard "action result" layout used by moderation/admin replies:
 * a coloured embed with the target, the moderator, the reason and an optional case number.
 */
export function actionEmbed({ title, color = 'moderation', target = null, moderator = null, reason = null, caseId = null, extra = [], thumbnail = null, description = null }) {
  const fields = [];
  if (target) fields.push(field('Member', target, true));
  if (moderator) fields.push(field('Moderator', moderator, true));
  if (caseId !== null && caseId !== undefined) fields.push(field('Case', `\`#${caseId}\``, true));
  if (reason) fields.push(field('Reason', `> ${String(reason).slice(0, 1000)}`, false));
  fields.push(...extra);
  return createEmbed({ title, description, color, fields, thumbnail });
}




// ─── Settings dashboards ──────────────────────────────────────────────────────
// One layout for every in-Discord settings panel (/ticket dashboard, /verification dashboard,
// /level dashboard, …): server header, feature accent colour, a status line, grouped sections.

export const NOT_SET = '*Not set*';
export const channelOr = (id) => (id ? `<#${id}>` : NOT_SET);
export const roleOr = (id) => (id ? `<@&${id}>` : NOT_SET);
export const rolesOr = (ids) => (Array.isArray(ids) && ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : NOT_SET);
export const onOff = (value) => (value ? '🟢 On' : '🔴 Off');

/**
 * @param {object} o
 * @param {import('discord.js').Guild} [o.guild]
 * @param {string} o.feature      e.g. 'Tickets'
 * @param {string} o.icon         e.g. '🎫'
 * @param {string} [o.color]      theme colour name
 * @param {boolean|null} [o.enabled]  null = no status line
 * @param {string} [o.summary]    one or two lines under the status
 * @param {Array<{name:string,value:string,inline?:boolean}>} [o.fields]
 * @param {string} [o.hint]       footer hint (defaults to how to use the panel)
 */
export function dashboardEmbed({ guild = null, feature, icon = '⚙️', color = 'primary', enabled = null, summary = '', fields = [], hint = null }) {
  const status = enabled === null || enabled === undefined ? '' : enabled ? '🟢 **Enabled**' : '🔴 **Disabled**';
  return createEmbed({
    author: guild ? { name: `${guild.name} · Settings`, iconURL: guild.iconURL?.({ size: 64 }) || undefined } : null,
    title: `${icon} ${feature}`,
    description: [status, summary].filter(Boolean).join('\n') || null,
    color,
    fields,
    thumbnail: guild?.iconURL?.({ size: 128 }) || null,
    footer: hint || 'Use the controls below to change a setting',
  });
}
