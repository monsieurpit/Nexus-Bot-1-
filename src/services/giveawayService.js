import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logger } from '../utils/logger.js';
import { NexusBotError, ErrorTypes } from '../utils/errorHandler.js';
import { getColor } from '../config/bot.js';
import { getEndedGiveaways, markGiveawayEnded } from '../utils/database.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

// ─── Rate-limit cache ─────────────────────────────────────────────────────────

const userGiveawayInteractions = new Map();
const GIVEAWAY_INTERACTION_COOLDOWN = 1500;
const GIVEAWAY_INTERACTION_TTL = 5 * 60 * 1000;
const GIVEAWAY_INTERACTION_MAX_ENTRIES = 5000;
const GIVEAWAY_INTERACTION_CLEANUP_INTERVAL = 60 * 1000;
let lastInteractionCleanupAt = 0;

function cleanupInteractionCache(force = false) {
    const now = Date.now();
    if (!force && (now - lastInteractionCleanupAt) < GIVEAWAY_INTERACTION_CLEANUP_INTERVAL) {
        return;
    }
    lastInteractionCleanupAt = now;
    const cutoff = now - GIVEAWAY_INTERACTION_TTL;
    for (const [key, timestamp] of userGiveawayInteractions.entries()) {
        if (timestamp < cutoff) userGiveawayInteractions.delete(key);
    }
    while (userGiveawayInteractions.size > GIVEAWAY_INTERACTION_MAX_ENTRIES) {
        const oldest = userGiveawayInteractions.keys().next().value;
        if (!oldest) break;
        userGiveawayInteractions.delete(oldest);
    }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export function parseDuration(durationString) {
    if (!durationString || typeof durationString !== 'string') {
        throw new NexusBotError(
            'Invalid duration format provided',
            ErrorTypes.VALIDATION,
            'Please provide a valid duration (e.g., 1h, 30m, 5d, 10s).',
            { durationString }
        );
    }

    const match = durationString.trim().match(/^(\d+)([hmds])$/i);
    if (!match) {
        throw new NexusBotError(
            `Invalid duration format: ${durationString}`,
            ErrorTypes.VALIDATION,
            'Invalid duration format. Use: 1h, 30m, 5d, 10s (min: 10s, max: 30d)',
            { input: durationString }
        );
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (amount <= 0 || amount > 999) {
        throw new NexusBotError(
            `Duration amount out of range: ${amount}`,
            ErrorTypes.VALIDATION,
            'Duration amount must be between 1 and 999.',
            { amount, unit }
        );
    }

    const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    const ms = amount * multipliers[unit];

    if (ms > 30 * 86_400_000) {
        throw new NexusBotError(`Duration exceeds maximum`, ErrorTypes.VALIDATION, 'Maximum duration is 30 days.');
    }
    if (ms < 10_000) {
        throw new NexusBotError(`Duration below minimum`, ErrorTypes.VALIDATION, 'Minimum duration is 10 seconds.');
    }
    return ms;
}

export function validatePrize(prize) {
    if (!prize || typeof prize !== 'string') {
        throw new NexusBotError('Prize must be a non-empty string', ErrorTypes.VALIDATION, 'Please provide a valid prize description.');
    }
    const trimmed = prize.trim();
    if (trimmed.length === 0 || trimmed.length > 256) {
        throw new NexusBotError(`Prize length out of range`, ErrorTypes.VALIDATION, 'Prize must be between 1 and 256 characters.');
    }
    return trimmed;
}

export function validateWinnerCount(winnerCount) {
    if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 20) {
        throw new NexusBotError(`Invalid winner count: ${winnerCount}`, ErrorTypes.VALIDATION, 'Winner count must be between 1 and 20.');
    }
}

// ─── Embed builder ────────────────────────────────────────────────────────────

/**
 * Builds a rich giveaway embed.
 * Supports: image banner, description, role requirement, bonus entry role, entry progress bar.
 *
 * @param {Object} giveaway - The giveaway data object
 * @param {'active'|'ended'|'reroll'} status
 * @param {string[]} [winners=[]] - Array of winner user IDs (only used when ended/reroll)
 */
export function createGiveawayEmbed(giveaway, status, winners = []) {
    try {
        const isEnded = status === 'ended' || status === 'reroll';
        const isReroll = status === 'reroll';

        const titleEmoji = isReroll ? '🔄' : isEnded ? '🎊' : '🎉';
        const statusLabel = isReroll ? 'REROLLED' : isEnded ? 'ENDED' : 'ACTIVE';

        const accentColor = isEnded
            ? getColor('error')
            : getColor('success');

        const embed = new EmbedBuilder()
            .setTitle(`${titleEmoji}  ${giveaway.prize}`)
            .setColor(accentColor);

        // Optional image banner
        // /giveaway stores the banner as `image`; older records used `imageUrl`.
        const imageUrl = giveaway.imageUrl || giveaway.image;
        if (typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
            embed.setImage(imageUrl);
        }

        // Description / flavour text
        const descLines = [];
        if (giveaway.description) {
            descLines.push(giveaway.description, '');
        }

        if (isEnded) {
            const winnerDisplay = winners.length > 0
                ? winners.map(id => `<@${id}>`).join(' ')
                : '`No valid entries`';
            descLines.push(`**${isReroll ? '🔄 New Winner(s)' : '🏆 Winner(s)'}:** ${winnerDisplay}`);
        } else {
            const rawEnd = giveaway.endsAt ?? giveaway.endTime;
            const endMs = typeof rawEnd === 'number' ? rawEnd : new Date(rawEnd).getTime();
            if (Number.isFinite(endMs)) {
                const endUnix = Math.floor(endMs / 1000);
                descLines.push(`⏰ **Ends:** <t:${endUnix}:R>  ·  <t:${endUnix}:f>`);
            }
        }

        embed.setDescription(descLines.join('\n'));

        // Core fields
        const entryCount = (giveaway.participants?.length ?? 0);
        const fields = [
            { name: '👤 Hosted by', value: `<@${giveaway.hostId}>`, inline: true },
            { name: '🏆 Winners', value: `**${giveaway.winnerCount}**`, inline: true },
            { name: '🎟️ Entries', value: `**${entryCount}**`, inline: true },
        ];

        // Role requirement
        if (giveaway.requiredRoleId) {
            fields.push({
                name: '🔒 Required Role',
                value: `<@&${giveaway.requiredRoleId}>`,
                inline: true,
            });
        }

        // Bonus entry role
        if (giveaway.bonusRoleId) {
            const bonusMult = giveaway.bonusEntries ?? 2;
            fields.push({
                name: '⭐ Bonus Entries',
                value: `<@&${giveaway.bonusRoleId}> → **${bonusMult}x**`,
                inline: true,
            });
        }

        embed.addFields(fields);

        // Entry progress bar (only while active, when a maxEntries cap is set)
        if (!isEnded && giveaway.maxEntries && giveaway.maxEntries > 0) {
            const pct = Math.min(1, entryCount / giveaway.maxEntries);
            const filled = Math.round(pct * 12);
            const bar = '█'.repeat(filled) + '░'.repeat(12 - filled);
            embed.addFields({
                name: `📊 Entry Cap  (${entryCount}/${giveaway.maxEntries})`,
                value: `\`${bar}\` ${Math.round(pct * 100)}%`,
                inline: false,
            });
        }

        embed
            .setTimestamp()
            .setFooter({ text: `Status: ${statusLabel}  •  ID: ${giveaway.messageId ?? 'pending'}` });

        return embed;
    } catch (error) {
        logger.error('Error creating giveaway embed:', error);
        throw new NexusBotError('Failed to create giveaway embed', ErrorTypes.UNKNOWN, 'An internal error occurred while formatting the giveaway.');
    }
}

// ─── Button builder ───────────────────────────────────────────────────────────

export function createGiveawayButtons(ended = false) {
    try {
        const row = new ActionRowBuilder();
        if (ended) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_reroll')
                    .setLabel('Reroll')
                    .setEmoji('🎲')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('giveaway_view')
                    .setLabel('View Winners')
                    .setEmoji('👁️')
                    .setStyle(ButtonStyle.Primary),
            );
        } else {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_join')
                    .setLabel('Enter Giveaway')
                    .setEmoji('🎉')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('giveaway_end')
                    .setLabel('End Now')
                    .setEmoji('🛑')
                    .setStyle(ButtonStyle.Danger),
            );
        }
        return row;
    } catch (error) {
        logger.error('Error creating giveaway buttons:', error);
        throw new NexusBotError('Failed to create giveaway buttons', ErrorTypes.UNKNOWN, 'An internal error occurred while creating interactive buttons.');
    }
}

// ─── Winner selection ─────────────────────────────────────────────────────────

/**
 * Selects winners, honouring bonus-entry weights.
 *
 * A participant in `bonusRoleId` gets `bonusEntries` (default 2) tickets in
 * the pool, giving them proportionally higher odds.
 *
 * @param {string[]} participants - Array of participant user IDs (may contain duplicates from bonus)
 * @param {number} winnerCount
 */
export function selectWinners(participants, winnerCount) {
    if (!Array.isArray(participants) || participants.length === 0) return [];

    const uniqueParticipants = [...new Set(participants)];

    if (!Number.isInteger(winnerCount) || winnerCount < 1) {
        throw new NexusBotError('Invalid winner count for selection', ErrorTypes.VALIDATION, 'Winner count must be at least 1.');
    }

    const pool = [...participants]; // may have duplicates for weighted draws
    const winners = [];

    const requested = Math.min(winnerCount, uniqueParticipants.length);

    for (let i = 0; i < requested; i++) {
        if (pool.length === 0) break;
        const idx = Math.floor(Math.random() * pool.length);
        const winner = pool[idx];
        winners.push(winner);
        // Remove ALL tickets for this winner so they can't win again
        for (let j = pool.length - 1; j >= 0; j--) {
            if (pool[j] === winner) pool.splice(j, 1);
        }
    }

    return winners;
}

// ─── Rate-limiting helpers ────────────────────────────────────────────────────

export function isUserRateLimited(userId, giveawayId) {
    cleanupInteractionCache();
    const key = `${userId}:${giveawayId}`;
    const last = userGiveawayInteractions.get(key);
    if (!last) return false;
    return Date.now() - last < GIVEAWAY_INTERACTION_COOLDOWN;
}

export function recordUserInteraction(userId, giveawayId) {
    cleanupInteractionCache();
    userGiveawayInteractions.set(`${userId}:${giveawayId}`, Date.now());
    cleanupInteractionCache(true);
}

// ─── Eligibility check ────────────────────────────────────────────────────────

/**
 * Checks whether a guild member is eligible to enter a giveaway.
 * Returns { eligible: boolean, reason?: string }
 */
export async function checkEntryEligibility(member, giveaway) {
    // Role requirement
    if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
        return {
            eligible: false,
            reason: `You need the <@&${giveaway.requiredRoleId}> role to enter this giveaway.`,
        };
    }

    // Max entries cap
    const currentEntries = (giveaway.participants ?? []).filter(id => id === member.id).length;
    if (currentEntries > 0) {
        return { eligible: false, reason: 'You have already entered this giveaway!' };
    }

    if (giveaway.maxEntries && giveaway.maxEntries > 0) {
        const uniqueCount = new Set(giveaway.participants ?? []).size;
        if (uniqueCount >= giveaway.maxEntries) {
            return { eligible: false, reason: 'This giveaway has reached its maximum number of entries.' };
        }
    }

    return { eligible: true };
}

/**
 * Builds the participant pool for a member, applying bonus entries if applicable.
 * Returns an array of IDs to push (1 or bonusEntries copies).
 */
export function buildEntryTickets(userId, giveaway) {
    if (giveaway.bonusRoleId && giveaway._memberHasBonusRole) {
        const mult = Math.max(1, giveaway.bonusEntries ?? 2);
        return Array(mult).fill(userId);
    }
    return [userId];
}

// ─── End giveaway ─────────────────────────────────────────────────────────────

export async function endGiveaway(client, giveaway, guildId, endedBy) {
    try {
        if (!giveaway) {
            throw new NexusBotError('Giveaway object is null or undefined', ErrorTypes.VALIDATION, 'Cannot end a non-existent giveaway.');
        }
        if (giveaway.ended === true || giveaway.isEnded === true) {
            throw new NexusBotError(`Giveaway ${giveaway.messageId} is already ended`, ErrorTypes.VALIDATION, 'This giveaway has already ended.');
        }

        const participants = giveaway.participants || [];
        const winners = selectWinners(participants, giveaway.winnerCount || 1);

        const updatedGiveaway = {
            ...giveaway,
            ended: true,
            isEnded: true,
            winnerIds: winners,
            endedAt: new Date().toISOString(),
            endedBy,
            participantCount: new Set(participants).size,
        };

        logger.info(`Ending giveaway ${giveaway.messageId}: ${winners.length} winners from ${new Set(participants).size} unique entrants`);

        return {
            success: true,
            giveaway: updatedGiveaway,
            winners,
            participantCount: new Set(participants).size,
        };
    } catch (error) {
        if (error instanceof NexusBotError) throw error;
        logger.error('Error ending giveaway:', error);
        throw new NexusBotError('Failed to end giveaway', ErrorTypes.UNKNOWN, 'An error occurred while ending the giveaway.');
    }
}

// ─── Cron tick: process expired giveaways ────────────────────────────────────

export async function checkGiveaways(client) {
    try {
        if (!client.db) {
            logger.warn('Database not available for giveaway check');
            return;
        }

        const { getGuildGiveaways, saveGiveaway, getGiveawayEndMs } = await import('../utils/giveaways.js');
        const now = Date.now();
        const due = [];

        // PostgreSQL has an indexed giveaways table; every other backend (Firestore — the bot's
        // primary store — and in-memory) keeps each guild's giveaways in one key-value map. This
        // used to ONLY query the PostgreSQL table, so on Firestore no giveaway ever ended.
        const isPostgres = client.db.getConnectionType?.() === 'postgresql';
        if (isPostgres) {
            for (const record of await getEndedGiveaways(client)) {
                const giveaway = typeof record.data === 'string' ? JSON.parse(record.data) : record.data;
                due.push({
                    guildId: record.guild_id,
                    messageId: record.message_id,
                    giveaway,
                    persist: (updated) => markGiveawayEnded(client, record.id, updated),
                });
            }
        } else {
            for (const guildId of client.guilds.cache.keys()) {
                const giveaways = await getGuildGiveaways(client, guildId);
                for (const giveaway of giveaways) {
                    if (!giveaway?.messageId || giveaway.ended || giveaway.isEnded) continue;
                    const endMs = getGiveawayEndMs(giveaway);
                    if (endMs === null || endMs > now) continue;
                    due.push({
                        guildId,
                        messageId: giveaway.messageId,
                        giveaway,
                        persist: (updated) => saveGiveaway(client, guildId, updated),
                    });
                }
            }
        }

        if (due.length === 0) return;
        logger.info(`Processing ${due.length} ended giveaway(s)`);

        for (const { guildId, messageId, giveaway, persist } of due) {
            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const participants = giveaway.participants || [];
                const winners = selectWinners(participants, giveaway.winnerCount || 1);

                giveaway.ended = true;
                giveaway.isEnded = true;
                giveaway.winnerIds = winners;
                giveaway.endedAt = new Date().toISOString();

                const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
                const message = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;

                // Marked ended first — if the channel/message is gone, this used to `continue`
                // without saving, so the same dead giveaway was re-processed every minute forever.
                await persist(giveaway);

                if (!channel || !message) {
                    logger.info(`Giveaway ${messageId} in guild ${guildId} ended, but its message no longer exists`);
                    continue;
                }

                await message.edit({
                    content: '🎊 **GIVEAWAY ENDED**',
                    embeds: [createGiveawayEmbed(giveaway, 'ended', winners)],
                    components: [createGiveawayButtons(true)],
                }).catch(err => logger.warn(`Could not edit ended giveaway message ${messageId}:`, err.message));

                if (winners.length > 0) {
                    const mentions = winners.map(id => `<@${id}>`).join(', ');
                    const pingMsg = await channel.send({
                        content: `🎉 Congratulations ${mentions}! You won **${giveaway.prize}**! Contact <@${giveaway.hostId}> to claim your prize.`,
                        allowedMentions: { users: winners },
                    }).catch(() => null);
                    if (pingMsg) {
                        giveaway.winnerPingMessageId = pingMsg.id;
                        await persist(giveaway);
                    }
                } else {
                    await channel.send({ content: `The giveaway for **${giveaway.prize}** ended with no valid entries.` }).catch(() => null);
                }

                try {
                    await logEvent({
                        client,
                        guildId,
                        eventType: EVENT_TYPES.GIVEAWAY_WINNER,
                        data: {
                            description: `Giveaway ended: ${giveaway.prize}`,
                            channelId: channel.id,
                            fields: [
                                { name: '🎁 Prize', value: giveaway.prize || 'Unknown', inline: true },
                                { name: '🏆 Winners', value: winners.length > 0 ? winners.map(id => `<@${id}>`).join(', ') : 'None', inline: false },
                                { name: '👥 Entries', value: new Set(participants).size.toString(), inline: true },
                            ],
                        },
                    });
                } catch (logErr) {
                    logger.debug('Error logging giveaway winner:', logErr);
                }

                logger.info(`Ended giveaway ${messageId} in guild ${guildId}`);
            } catch (err) {
                logger.error('Error processing giveaway:', err);
            }
        }
    } catch (error) {
        logger.error('Error checking giveaways:', error);
    }
}
