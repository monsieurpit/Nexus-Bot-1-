import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { logger } from './logger.js';
import { successEmbed, warningEmbed, createEmbed } from './embeds.js';
import { InteractionHelper } from './interactionHelper.js';

/**
 * Parses a string of user IDs/mentions into an array of snowflake IDs.
 * Strips mention formatting, splits on whitespace/commas, limits to 20.
 * @param {string} input - Raw user input string
 * @returns {string[]} Array of valid Discord snowflake IDs
 */
export function parseUserIds(input) {
    return input
        .replace(/<@!?(\d+)>/g, '$1')
        .split(/[\s,]+/)
        .filter(id => id && /^\d+$/.test(id))
        .slice(0, 20);
}

/**
 * Creates a fresh results tracker for mass actions.
 * @returns {{ successful: Array, failed: Array, skipped: Array }}
 */
export function createMassActionResults() {
    return {
        successful: [],
        failed: [],
        skipped: []
    };
}

/**
 * Checks whether a target can be acted upon by the invoking member,
 * considering role hierarchy and guild ownership.
 * @param {import('discord.js').GuildMember} targetMember
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkMassActionHierarchy(targetMember, interaction) {
    if (targetMember.id === interaction.guild.ownerId) {
        return { allowed: false, reason: 'Cannot act on the server owner' };
    }
    const me = interaction.guild.members?.me;
    if (me && targetMember.roles.highest.position >= me.roles.highest.position) {
        return { allowed: false, reason: 'User has a role equal to or above mine' };
    }
    if (
        targetMember.roles.highest.position >= interaction.member.roles.highest.position &&
        interaction.guild.ownerId !== interaction.user.id
    ) {
        return {
            allowed: false,
            reason: `Cannot act on user with equal or higher role`
        };
    }
    return { allowed: true };
}

/**
 * Formats the results of a mass action into a Discord-ready description string.
 * @param {{ successful: Array, failed: Array, skipped: Array }} results
 * @param {string} actionVerb - Past-tense verb, e.g. "Banned", "Kicked"
 * @returns {string}
 */
export function formatMassActionResults(results, actionVerb) {
    let description = `**Mass ${actionVerb} Results:**\n\n`;

    if (results.successful.length > 0) {
        description += `\u2705 **Successfully ${actionVerb} (${results.successful.length}):**\n`;
        for (const result of results.successful) {
            description += `\u2022 ${result.user} (${result.userId})\n`;
        }
        description += '\n';
    }

    if (results.skipped.length > 0) {
        description += `\u26a0\ufe0f **Skipped (${results.skipped.length}):**\n`;
        for (const result of results.skipped) {
            description += `\u2022 ${result.user} - ${result.reason}\n`;
        }
        description += '\n';
    }

    if (results.failed.length > 0) {
        description += `\u274c **Failed (${results.failed.length}):**\n`;
        for (const result of results.failed) {
            description += `\u2022 ${result.userId} - ${result.reason}\n`;
        }
    }

    return description;
}

/**
 * Selects the appropriate embed function based on whether any actions succeeded.
 * @param {{ successful: Array }} results
 * @returns {Function} successEmbed or warningEmbed
 */
export function getMassActionEmbed(results) {
    return results.successful.length > 0 ? successEmbed : warningEmbed;
}


/**
 * Shows a preview of a destructive mass action and waits for the invoking moderator to confirm.
 * Mass ban / mass kick used to execute immediately — a mistyped or pasted list of 20 IDs was
 * applied with no chance to review it. Returns true only on an explicit confirmation; a cancel or
 * a 60-second timeout returns false and edits the reply to say nothing was done.
 *
 * Button IDs carry no ':' so the global button router ignores them (see interactionCreate.js).
 */
export async function confirmMassAction(interaction, { verb, userIds = [], reason, extra = '', summary = null, count = null }) {
    const total = count ?? userIds.length;
    const confirmId = `massaction_confirm_${interaction.id}`;
    const cancelId = `massaction_cancel_${interaction.id}`;
    const list = userIds.map((id) => `<@${id}> (\`${id}\`)`).join('\n');
    const embed = createEmbed({
        title: `⚠️ Confirm mass ${verb.toLowerCase()} (${total})`,
        description:
            (summary || `You are about to **${verb.toLowerCase()} ${total} user(s)**:\n${list}`) + '\n\n' +
            `**Reason:** ${String(reason).slice(0, 300)}${extra ? `\n${extra}` : ''}\n\n` +
            'Members you are not allowed to act on are skipped automatically. Confirm within 60 seconds.',
        color: 'warning',
    });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(`${verb} ${total}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [row] });

    let press;
    try {
        const msg = await interaction.fetchReply();
        press = await msg.awaitMessageComponent({
            componentType: ComponentType.Button,
            time: 60_000,
            filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
        });
    } catch {
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [warningEmbed('No confirmation within 60 seconds — nobody was affected.', '⌛ Timed out')],
            components: [],
        });
        return false;
    }

    if (press.customId === cancelId) {
        await press.update({ embeds: [warningEmbed('Cancelled — nobody was affected.', '✖️ Cancelled')], components: [] }).catch(() => null);
        return false;
    }

    await press.update({
        embeds: [createEmbed({ title: `⏳ Mass ${verb.toLowerCase()} in progress…`, description: `Processing ${total} member(s).`, color: 'info' })],
        components: [],
    }).catch((err) => logger.debug('mass action confirm update failed:', err.message));
    return true;
}
