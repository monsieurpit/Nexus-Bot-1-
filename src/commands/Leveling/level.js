import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, EmbedBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import {
    getLevelingConfig,
    saveLevelingConfig,
    addLevels,
    removeLevels,
    setUserLevel
} from '../../services/leveling.js';
import { botHasPermission } from '../../utils/permissionGuard.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import levelDashboard from './modules/level_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Manage the leveling system and user levels')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setup')
                .setDescription('Set up the leveling system — this also enables it')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send level-up notifications in')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_min')
                        .setDescription('Minimum XP awarded per message (default: 15)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_max')
                        .setDescription('Maximum XP awarded per message (default: 25)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false),
                )
                .addStringOption((option) =>
                    option
                        .setName('message')
                        .setDescription(
                            'Level-up message. Use {user} and {level} as placeholders (default provided)',
                        )
                        .setMaxLength(500)
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('xp_cooldown')
                        .setDescription('Seconds between XP grants per user (default: 60)')
                        .setMinValue(0)
                        .setMaxValue(3600)
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Open the interactive leveling configuration dashboard'),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('add')
                .setDescription('Add levels to a user')
                .addUserOption((opt) =>
                    opt.setName('user').setDescription('The user to add levels to').setRequired(true)
                )
                .addIntegerOption((opt) =>
                    opt.setName('levels').setDescription('Number of levels to add').setRequired(true).setMinValue(1)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('remove')
                .setDescription('Remove levels from a user')
                .addUserOption((opt) =>
                    opt.setName('user').setDescription('The user to remove levels from').setRequired(true)
                )
                .addIntegerOption((opt) =>
                    opt.setName('levels').setDescription('Number of levels to remove').setRequired(true).setMinValue(1)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('set')
                .setDescription("Set a user's level to a specific value")
                .addUserOption((opt) =>
                    opt.setName('user').setDescription('The user to set the level for').setRequired(true)
                )
                .addIntegerOption((opt) =>
                    opt.setName('level').setDescription('The level to set').setRequired(true).setMinValue(0)
                )
        ),
    category: 'Leveling',

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral,
            });
            if (!deferred) return;

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            'Missing Permissions',
                            'You need the **Manage Server** permission to use this command.',
                        ),
                    ],
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'dashboard') {
                return levelDashboard.execute(interaction, config, client);
            }

            if (subcommand === 'setup') {
                const channel = interaction.options.getChannel('channel');
                const xpMin = interaction.options.getInteger('xp_min') ?? 15;
                const xpMax = interaction.options.getInteger('xp_max') ?? 25;
                const message =
                    interaction.options.getString('message') ??
                    '{user} has leveled up to level {level}!';
                const xpCooldown = interaction.options.getInteger('xp_cooldown') ?? 60;

                if (xpMin > xpMax) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                'Invalid XP Range',
                                `Minimum XP (**${xpMin}**) cannot be greater than maximum XP (**${xpMax}**).`,
                            ),
                        ],
                    });
                }

                if (!botHasPermission(channel, ['SendMessages', 'EmbedLinks'])) {
                    throw new TitanBotError(
                        'Bot missing permissions in the specified channel',
                        ErrorTypes.PERMISSION,
                        `I need **SendMessages** and **EmbedLinks** permissions in ${channel} to send level-up notifications.`,
                    );
                }

                const existingConfig = await getLevelingConfig(client, interaction.guildId);

                if (existingConfig.configured) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                'Leveling System Already Active',
                                `The leveling system is already set up on this server (level-up notifications go to <#${existingConfig.levelUpChannel}>).\n\nUse \`/level dashboard\` to adjust any settings.`,
                            ),
                        ],
                    });
                }

                const newConfig = {
                    ...existingConfig,
                    configured: true,
                    enabled: true,
                    levelUpChannel: channel.id,
                    xpRange: { min: xpMin, max: xpMax },
                    xpCooldown: xpCooldown,
                    levelUpMessage: message,
                    announceLevelUp: true,
                };

                await saveLevelingConfig(client, interaction.guildId, newConfig);

                logger.info(`Leveling system set up in guild ${interaction.guildId}`, {
                    channelId: channel.id,
                    xpMin,
                    xpMax,
                    xpCooldown,
                    userId: interaction.user.id,
                });

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({
                            title: '✅ Leveling System Set Up',
                            description:
                                `The leveling system is now **enabled** and ready to go.\n\n` +
                                `**Level-up Channel:** ${channel}\n` +
                                `**XP per Message:** ${xpMin} – ${xpMax}\n` +
                                `**XP Cooldown:** ${xpCooldown}s\n` +
                                `**Level-up Message:** \`${message}\`\n\n` +
                                `Use \`/level dashboard\` to adjust any of these settings at any time.`,
                            color: 'success',
                        }),
                    ],
                });
            }

            if (subcommand === 'add') {
                const targetUser = interaction.options.getUser('user');
                const levelsToAdd = interaction.options.getInteger('levels');

                const levelingConfig = await getLevelingConfig(client, interaction.guildId);
                if (!levelingConfig?.enabled) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#f1c40f')
                                .setDescription('The leveling system is currently disabled on this server.')
                        ]
                    });
                }

                const updated = await addLevels(client, interaction.guildId, targetUser.id, levelsToAdd);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({
                            title: 'Levels Added',
                            description: `Added **${levelsToAdd}** level(s) to ${targetUser}.\nNew Level: **${updated.level}** (XP: **${updated.xp}**)`,
                            color: 'success'
                        })
                    ]
                });
            }

            if (subcommand === 'remove') {
                const targetUser = interaction.options.getUser('user');
                const levelsToRemove = interaction.options.getInteger('levels');

                const levelingConfig = await getLevelingConfig(client, interaction.guildId);
                if (!levelingConfig?.enabled) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#f1c40f')
                                .setDescription('The leveling system is currently disabled on this server.')
                        ]
                    });
                }

                const updated = await removeLevels(client, interaction.guildId, targetUser.id, levelsToRemove);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({
                            title: 'Levels Removed',
                            description: `Removed **${levelsToRemove}** level(s) from ${targetUser}.\nNew Level: **${updated.level}** (XP: **${updated.xp}**)`,
                            color: 'success'
                        })
                    ]
                });
            }

            if (subcommand === 'set') {
                const targetUser = interaction.options.getUser('user');
                const newLevel = interaction.options.getInteger('level');

                const levelingConfig = await getLevelingConfig(client, interaction.guildId);
                if (!levelingConfig?.enabled) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#f1c40f')
                                .setDescription('The leveling system is currently disabled on this server.')
                        ]
                    });
                }

                const updated = await setUserLevel(client, interaction.guildId, targetUser.id, newLevel);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({
                            title: 'Level Set',
                            description: `Set level for ${targetUser} to **${newLevel}**.\nNew Level: **${updated.level}** (XP: **${updated.xp}**)`,
                            color: 'success'
                        })
                    ]
                });
            }

        } catch (error) {
            logger.error('Level command error:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'level',
            });
        }
    },
};
