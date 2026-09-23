import { logger } from '../utils/logger.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { db } from '../utils/database.js';

export const COUNTER_TYPE_CONFIG = {
  members: {
    label: 'Members + Bots',
    baseName: 'Members & Bots',
    emoji: '👥'
  },
  members_only: {
    label: 'Members Only',
    baseName: 'Members',
    emoji: '👤'
  },
  bots: {
    label: 'Bots Only',
    baseName: 'Bots',
    emoji: '🤖'
  }
};

function getCounterConfig(type) {
  return COUNTER_TYPE_CONFIG[type] || {
    label: 'Unknown',
    baseName: 'Counter',
    emoji: '❓'
  };
}

export function getCounterTypeLabel(type) {
  return getCounterConfig(type).label;
}

export function getCounterBaseName(type) {
  return getCounterConfig(type).baseName;
}

export function getCounterEmoji(type) {
  return getCounterConfig(type).emoji;
}

export async function getGuildCounterStats(guild) {
  let memberCollection = guild.members.cache;

  try {
    memberCollection = await guild.members.fetch();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Failed to fetch all guild members for ${guild.id}, using cache only`, error);
    }
  }

  const botCount = memberCollection.filter((member) => member.user.bot).size;
  const totalCount = typeof guild.memberCount === 'number' ? guild.memberCount : memberCollection.size;
  const humanCount = Math.max(totalCount - botCount, 0);

  return {
    totalCount,
    botCount,
    humanCount
  };
}

export async function getCounterCount(guild, type) {
  const stats = await getGuildCounterStats(guild);

  switch (type) {
    case 'members':
      return stats.totalCount;
    case 'bots':
      return stats.botCount;
    case 'members_only':
      return stats.humanCount;
    default:
      return null;
  }
}


function isValidCounterShape(counter) {
  return Boolean(
    counter &&
    typeof counter === 'object' &&
    (typeof counter.id === 'string' || typeof counter.id === 'number') &&
    String(counter.id).length > 0 &&
    typeof counter.type === 'string' &&
    (typeof counter.channelId === 'string' || typeof counter.channelId === 'number' || typeof counter.channelId === 'bigint') &&
    String(counter.channelId).length > 0
  );
}

function normalizeCounter(counter, guildId) {
  const normalized = {
    id: String(counter.id),
    type: String(counter.type),
    channelId: String(counter.channelId),
    guildId: String(counter.guildId || guildId),
    createdAt: counter.createdAt || new Date().toISOString(),
    enabled: typeof counter.enabled === 'boolean' ? counter.enabled : true
  };

  if (counter.updatedAt) {
    normalized.updatedAt = counter.updatedAt;
  }

  return normalized;
}

function sanitizeCounters(counters, guildId) {
  if (!Array.isArray(counters)) {
    return [];
  }

  return counters
    .filter(isValidCounterShape)
    .map(counter => normalizeCounter(counter, guildId));
}

export async function updateCounter(client, guild, counter) {
  try {
    if (!counter || !counter.type || !counter.channelId) {
      logger.warn('Skipping invalid counter in updateCounter:', counter);
      return false;
    }
    
    const { type, channelId } = counter;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      logger.error('Channel not found for counter:', channelId);
      return false;
    }

    const count = await getCounterCount(guild, type);
    if (count === null) {
      logger.error('Unknown counter type:', type);
      return false;
    }

    const baseName = getCounterBaseName(type);
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Base name: "${baseName}", Current name: "${channel.name}"`);
    }
    
    const newName = `${baseName}: ${count}`;
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`New name would be: "${newName}"`);
    }
    
    if (channel.name !== newName) {
      try {
        await channel.setName(newName);
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(`Updated channel name to: "${newName}"`);
        }

        try {
          await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.COUNTER_UPDATE,
            data: {
              description: `Counter updated: ${baseName}`,
              channelId: channel.id,
              fields: [
                {
                  name: '📊 Counter Type',
                  value: getCounterTypeLabel(type),
                  inline: true
                },
                {
                  name: '🔢 New Count',
                  value: count.toString(),
                  inline: true
                },
                {
                  name: '📍 Channel',
                  value: channel.toString(),
                  inline: true
                }
              ]
            }
          });
        } catch (error) {
          logger.debug('Error logging counter update:', error);
        }

      } catch (error) {
        logger.error(`Failed to update channel name for ${channel.id}:`, error);
        return false;
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('Channel name already correct, no update needed');
      }
    }
    return true;
  } catch (error) {
    logger.error("Error updating counter:", error);
    return false;
  }
}

export async function getServerCounters(client, guildId) {
  try {
    const database = client?.db || db;
    if (!database) {
      logger.warn('Database not available for getServerCounters');
      return [];
    }
    
    let data = await database.get(`counters:${guildId}`);
    // A config-shaped object ({ enabled, counters: [...] }) may have been stored under the list
    // key by an older build — unwrap it instead of treating the counters as missing.
    if (data && !Array.isArray(data) && typeof data === 'object' && Array.isArray(data.counters)) {
      data = data.counters;
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      data = await database.get(`guild:${guildId}:serverstats:counters`);
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      const statsCfg = await database.get(`guild:${guildId}:serverstats:config`);
      if (statsCfg?.counters && Array.isArray(statsCfg.counters)) {
        data = statsCfg.counters;
      }
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      const gConfig = await database.get(`guild:${guildId}:config`);
      if (gConfig?.counters || gConfig?.serverStats) {
        data = gConfig.counters || gConfig.serverStats;
      }
    }
    
    let counters = [];
    
    if (data && typeof data === 'object' && data.ok && Array.isArray(data.value)) {
      counters = data.value;
    } else if (Array.isArray(data)) {
      counters = data;
    } else if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        counters = Array.isArray(parsed) ? parsed : [];
      } catch {
        counters = [];
      }
    } else if (data && typeof data === 'object' && !data.ok && isValidCounterShape(data)) {
      counters = [data];
    } else {
      return [];
    }

    return sanitizeCounters(counters, guildId);
  } catch (error) {
    logger.error("Error getting server counters:", error);
    return [];
  }
}

export async function saveServerCounters(client, guildId, counters) {
  try {
    const database = client?.db || db;
    if (!database) {
      logger.warn('Database not available for saveServerCounters');
      return false;
    }
    
    const sanitizedCounters = sanitizeCounters(counters, guildId);

    // Save across primary and guild-scoped keys
    await database.set(`counters:${guildId}`, sanitizedCounters);
    await database.set(`guild:${guildId}:serverstats:counters`, sanitizedCounters);
    await database.set(`guild:${guildId}:serverstats:config`, {
      enabled: sanitizedCounters.length > 0,
      counters: sanitizedCounters,
      updatedAt: new Date().toISOString()
    });

    return true;
  } catch (error) {
    logger.error("Error saving server counters:", error);
    return false;
  }
}


