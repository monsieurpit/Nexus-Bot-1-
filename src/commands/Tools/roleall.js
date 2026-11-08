import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { guardDefer, guardPermission } from '../../utils/commandGuards.js';
import { confirmMassAction } from '../../utils/massActionHelper.js';

// How many members to process per batch before pausing
const BATCH_SIZE = 5;
// Delay between batches in ms — keeps us well under Discord's rate limit
const BATCH_DELAY_MS = 1000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
    data: new SlashCommandBuilder()
        .setName('roleall')
        .setDescription('Give a role to every member in the server')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The role to assign to all members')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('skip_bots')
                .setDescription('Skip bot accounts (default: true)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'tools',

    async execute(interaction, config, client) {
        if (!await guardDefer(interaction, 'roleall')) return;

        try {
            guardPermission(interaction, PermissionFlagsBits.Administrator, 'Administrator');

            const role = interaction.options.getRole('role');
            const skipBots = interaction.options.getBoolean('skip_bots') ?? true;
            const { guild } = interaction;

            // Safety: role must be below the bot's highest role
            if (role.position >= guild.members.me.roles.highest.position) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Role Too High / Rol Demasiado Alto',
                        "I can't assign a role that is at or above my highest role.\n" +
                        'No puedo asignar un rol que esté igual o por encima de mi rol más alto.'
                    )],
                });
            }

            // Safety: the bot bypasses Discord's own rule that you can't hand out a role at or above
            // your highest role — enforce it here (the server owner is exempt).
            const isOwner = guild.ownerId === interaction.user.id;
            if (!isOwner && role.position >= interaction.member.roles.highest.position) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Role Above Yours / Rol Superior al Tuyo',
                        'You can only mass-assign roles below your own highest role.\n' +
                        'Solo puedes asignar en masa roles por debajo de tu rol más alto.'
                    )],
                });
            }

            // Safety: giving EVERY member a role with staff powers is a one-command server takeover
            // risk (or a typo away from one). Only the owner may do it.
            const DANGEROUS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ManageWebhooks', 'MentionEveryone', 'ModerateMembers'];
            const dangerous = DANGEROUS.filter((perm) => role.permissions.has(PermissionFlagsBits[perm]));
            if (dangerous.length && !isOwner) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Dangerous Role / Rol Peligroso',
                        `${role} grants staff permissions (${dangerous.join(', ')}). Only the server owner can give it to every member.\n` +
                        `${role} otorga permisos de staff. Solo el propietario puede asignarlo a todos.`
                    )],
                });
            }

            // Safety: can't assign @everyone or a managed/integration role
            if (role.id === guild.id) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Invalid Role / Rol Inválido',
                        'You cannot assign the @everyone role.\n' +
                        'No puedes asignar el rol @everyone.'
                    )],
                });
            }

            if (role.managed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Managed Role / Rol Gestionado',
                        'That role is managed by an integration and cannot be assigned manually.\n' +
                        'Ese rol está gestionado por una integración y no se puede asignar manualmente.'
                    )],
                });
            }

            // Fetch all members (handles large servers via pagination automatically)
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    createEmbed({ timestamp: false })
                        .setColor(getColor('primary'))
                        .setTitle('⏳ Fetching members... / Obteniendo miembros...')
                        .setDescription(
                            `Preparing to assign ${role} to all ${skipBots ? 'non-bot ' : ''}members.\n` +
                            `Preparando para asignar ${role} a todos los miembros${skipBots ? ' (sin bots)' : ''}.`
                        )
                ],
            });

            const allMembers = await guild.members.fetch();
            const targets = allMembers.filter(m => {
                if (skipBots && m.user.bot) return false;
                if (m.roles.cache.has(role.id)) return false; // already has the role
                return true;
            });

            const total = targets.size;

            if (total === 0) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({ timestamp: false })
                            .setColor(getColor('success'))
                            .setTitle('✅ Nothing to do / Nada que hacer')
                            .setDescription(
                                `All ${skipBots ? 'non-bot ' : ''}members already have ${role}.\n` +
                                `Todos los miembros${skipBots ? ' (sin bots)' : ''} ya tienen ${role}.`
                            )
                    ],
                });
            }

            const confirmed = await confirmMassAction(interaction, {
                verb: 'Assign role',
                count: total,
                reason: `/roleall by ${interaction.user.tag}`,
                summary: `You are about to give ${role} to **${total}** ${skipBots ? 'non-bot ' : ''}member(s).` +
                    (dangerous.length ? `\n⚠️ This role grants: **${dangerous.join(', ')}**` : '') +
                    `\nEstimated time: ~${Math.ceil(total / BATCH_SIZE * BATCH_DELAY_MS / 60000)} min.`,
            });
            if (!confirmed) return;
            const startedAt = Date.now();

            logger.info(`[Roleall] Starting role assignment: role=${role.name} (${role.id}), targets=${total}, guild=${guild.name} (${guild.id}), executor=${interaction.user.tag}`);

            let succeeded = 0;
            let failed = 0;
            const memberArray = [...targets.values()];

            // Process in batches to stay within Discord rate limits without blocking the bot
            for (let i = 0; i < memberArray.length; i += BATCH_SIZE) {
                const batch = memberArray.slice(i, i + BATCH_SIZE);

                await Promise.allSettled(
                    batch.map(async member => {
                        try {
                            await member.roles.add(role, `roleall by ${interaction.user.tag}`);
                            succeeded++;
                        } catch (err) {
                            failed++;
                            logger.warn(`[Roleall] Failed to add role to ${member.user.tag} (${member.id}): ${err.message}`);
                        }
                    })
                );

                // Update progress every 10 batches (every 50 members) to avoid hitting edit rate limits
                if (i > 0 && (i / BATCH_SIZE) % 10 === 0) {
                    const done = Math.min(i + BATCH_SIZE, total);
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            createEmbed({ timestamp: false })
                                .setColor(getColor('primary'))
                                .setTitle('⏳ In progress... / En progreso...')
                                .setDescription(
                                    `Assigning ${role} to all members...\n` +
                                    `Asignando ${role} a todos los miembros...\n\n` +
                                    `**${done} / ${total}** processed`
                                )
                        ],
                    }).catch(() => {}); // ignore edit failures during progress updates
                }

                // Wait between batches to respect rate limits
                if (i + BATCH_SIZE < memberArray.length) {
                    await sleep(BATCH_DELAY_MS);
                }
            }

            logger.info(`[Roleall] Completed: role=${role.name}, succeeded=${succeeded}, failed=${failed}, guild=${guild.name}`);

            const embed = createEmbed({ timestamp: false })
                .setColor(failed === 0 ? getColor('success') : getColor('warning'))
                .setTitle('✅ Role Assignment Complete / Asignación de Rol Completa')
                .addFields(
                    { name: '🎭 Role / Rol', value: `${role}`, inline: true },
                    { name: '✅ Succeeded / Éxito', value: `${succeeded}`, inline: true },
                    { name: '❌ Failed / Fallido', value: `${failed}`, inline: true },
                )
                .setFooter({ text: `Executed by ${interaction.user.tag} / Ejecutado por ${interaction.user.tag}` })
                .setTimestamp();

            if (failed > 0) {
                embed.setDescription(
                    `Some assignments failed — the bot may lack permission to assign that role to certain members (e.g. members with higher roles).\n` +
                    `Algunas asignaciones fallaron — puede que el bot no tenga permiso para asignar ese rol a ciertos miembros.`
                );
            }

            // Interaction tokens expire after 15 minutes; on large servers the run outlives it and the
            // final summary used to vanish. Post it in the channel instead when that's the case.
            if (Date.now() - startedAt > 14 * 60 * 1000) {
                await interaction.channel?.send({ content: `${interaction.user}`, embeds: [embed], allowedMentions: { users: [interaction.user.id] } })
                    .catch((err) => logger.warn('[Roleall] Could not post the final summary:', err.message));
            } else {
                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            }

        } catch (error) {
            logger.error('[Roleall] Error in roleall command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'roleall'
            });
        }
    },
};
