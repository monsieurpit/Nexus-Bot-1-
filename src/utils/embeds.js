import { EmbedBuilder } from 'discord.js';
import { getColor } from '../config/bot.js';

export function createEmbed({
  title = '',
  description = '',
  color = 'primary',
  fields = [],
  author = null,
  footer = null,
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
    const embedColor = getColor(color) || '#000000';
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

  
  if (footer) {
    try {
      if (typeof footer === 'string' && footer.length > 0) {
        embed.setFooter({ text: footer.substring(0, 2048) });
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

function buildStatusEmbed(first, second, { defaultTitle, color }) {
  if (typeof first === 'string' && typeof second === 'string' && second.length > 0) {
    const { title, message } = resolveTitleAndMessage(first, second);
    return createEmbed({ title, description: message, color, timestamp: true });
  }
  return createEmbed({ title: defaultTitle, description: first, color, timestamp: true });
}

export function errorEmbed(message, error = null, options = {}) {
  // errorEmbed('Title', 'What went wrong') — two strings: a title and a user-facing message.
  if (typeof message === 'string' && typeof error === 'string' && error.length > 0) {
    return buildStatusEmbed(message, error, { defaultTitle: '❌ Error', color: 'error' });
  }

  // errorEmbed('What went wrong', errorObject) — the error's own text is debug detail, shown
  // outside production only.
  const { showDetails = process.env.NODE_ENV !== 'production' } = options;
  let description = message;

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
  const progress = Math.min(Math.max(0, current / max), 1);
  const filled = Math.round(size * progress);
  const empty = size - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${Math.round(progress * 100)}%`;
}



