import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { getTicketPermissionContext } from '../../utils/ticketPermissions.js';
import {
    claimTicket,
    closeTicket,
    addTicketNote,
    removeTicketNote,
    getTicketNotes,
    updateTicketPriority,
    reopenTicket,
    addTicketTag,
    removeTicketTag,
    getTicketTags,
    unclaimTicket,
    watchTicket,
    unwatchTicket,
    getTicketWatchers,
    getTicketStats,
    getTicketsByUser,
} from '../../services/ticket.js';

import ticketConfig from './modules/ticket_dashboard.js';

const PRIORITY_EMOJI = {
    none: '⚪', low: '🟢', medium: '🟡', high: '🔴', urgent: '🚨',
};

// Several subcommand groups below (note, tag, watch, tinfo) used to be their own
// top-level commands restricted via `.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)`.
// Discord only allows ONE default-member-permissions value per top-level command, and this merged
// /ticket command also carries subcommands that must stay open to non-ManageChannels members
// (e.g. /ticket close must remain usable by the ticket creator, /ticket claim|priority|reopen|unclaim
// must remain usable by anyone holding the configured ticket staff role even without ManageChannels).
// So the merged command intentionally does NOT set a top-level default member permission, and this
// helper reproduces the exact restriction those subcommands relied on Discord to enforce for them.
async function requireManageChannels(interaction, commandNameForLog) {
    if (interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return true;
    }
    logger.warn('Ticket command permission denied', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: commandNameForLog,
    });
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [
            errorEmbed(
                "Permission Denied",
                "You need the `Manage Channels` permission for this action.",
            ),
        ],
    });
    return false;
}

async function handleSetupOrDashboard(interaction, config, client, subcommand) {
    try {
        if (!(await requireManageChannels(interaction, 'ticket'))) {
            return;
        }

        if (subcommand === "dashboard") {
            return ticketConfig.execute(interaction, config, client);
        }

        if (subcommand === "setup") {
            const existingConfig = await getGuildConfig(client, interaction.guildId);
            if (existingConfig?.ticketPanelChannelId) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            'Ticket System Already Active',
                            `This server already has a ticket system set up (panel in <#${existingConfig.ticketPanelChannelId}>).\n\nOnly one ticket system is supported per server. Use \`/ticket dashboard\` to edit or update the existing setup, or select **Delete System** from the dashboard to remove it and start fresh.`,
                        ),
                    ],
                });
            }

            const panelChannel =
                interaction.options.getChannel("panel_channel");
            const categoryChannel = interaction.options.getChannel("category");
            const closedCategoryChannel = interaction.options.getChannel("closed_category");
            const staffRole = interaction.options.getRole("staff_role");
            const panelMessage = interaction.options.getString("panel_message") || "Click the button below to create a support ticket.";
            const buttonLabel =
                interaction.options.getString("button_label") ||
                "Create Ticket";
            const maxTicketsPerUser = interaction.options.getInteger("max_tickets_per_user") || 3;
            const dmOnClose = interaction.options.getBoolean("dm_on_close") !== false;

            const setupEmbed = createEmbed({
                title: "🎫 Support Tickets",
                description: panelMessage,
                color: getColor('info')
            });

            const ticketButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("create_ticket")
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("📩"),
            );

            try {
                await panelChannel.send({
                    embeds: [setupEmbed],
                    components: [ticketButton],
                });

                if (client.db && interaction.guildId) {
                    const currentConfig = existingConfig;
                    currentConfig.ticketCategoryId = categoryChannel ? categoryChannel.id : null;
                    currentConfig.ticketClosedCategoryId = closedCategoryChannel ? closedCategoryChannel.id : null;
                    currentConfig.ticketStaffRoleId = staffRole ? staffRole.id : null;
                    currentConfig.ticketPanelChannelId = panelChannel.id;
                    currentConfig.ticketPanelMessage = panelMessage;
                    currentConfig.ticketButtonLabel = buttonLabel;
                    currentConfig.maxTicketsPerUser = maxTicketsPerUser;
                    currentConfig.dmOnClose = dmOnClose;

                    const { getGuildConfigKey } = await import('../../utils/database.js');
                    const configKey = getGuildConfigKey(interaction.guildId);
                    await client.db.set(configKey, currentConfig);
                    logger.info('Ticket configuration saved', {
                        guildId: interaction.guildId,
                        categoryId: categoryChannel?.id,
                        closedCategoryId: closedCategoryChannel?.id,
                        staffRoleId: staffRole?.id,
                        maxTickets: maxTicketsPerUser,
                        dmOnClose: dmOnClose
                    });
                }

                let successMessage = `The ticket creation panel has been sent to ${panelChannel}. `;

                if (categoryChannel) {
                    successMessage += `New tickets will be created in the **${categoryChannel.name}** category. `;
                } else {
                    successMessage += 'New tickets will be created in a new "Tickets" category. ';
                }

                if (closedCategoryChannel) {
                    successMessage += `Closed tickets will be moved to **${closedCategoryChannel.name}**. `;
                }

                if (staffRole) {
                    successMessage += `**${staffRole.name}** role will have access to tickets. `;
                }

                successMessage += `\n\n**Max Tickets Per User:** ${maxTicketsPerUser}\n**DM on Close:** ${dmOnClose ? 'Enabled' : 'Disabled'}`;

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Ticket Panel Set Up",
                            successMessage,
                        ),
                    ],
                });

                logger.info('Ticket panel setup completed', {
                    userId: interaction.user.id,
                    userTag: interaction.user.tag,
                    guildId: interaction.guildId,
                    panelChannelId: panelChannel.id,
                    categoryId: categoryChannel?.id,
                    closedCategoryId: closedCategoryChannel?.id,
                    staffRoleId: staffRole?.id,
                    maxTickets: maxTicketsPerUser,
                    dmOnClose: dmOnClose,
                    commandName: 'ticket_setup'
                });

                const logEmbed = createEmbed({
                    title: "🔧 Ticket System Setup (Configuration Log)",
                    description: `The ticket panel was set up in ${panelChannel} by ${interaction.user}.`,
                    color: getColor('warning')
                })
                    .addFields(
                        {
                            name: "Panel Channel",
                            value: panelChannel.toString(),
                            inline: true,
                        },
                        {
                            name: "Ticket Category",
                            value: categoryChannel
                                ? categoryChannel.toString()
                                : "None specified.",
                            inline: true,
                        },
                        {
                            name: "Closed Category",
                            value: closedCategoryChannel
                                ? closedCategoryChannel.toString()
                                : "None specified.",
                            inline: true,
                        },
                        {
                            name: "Staff Role",
                            value: staffRole
                                ? staffRole.toString()
                                : "None specified.",
                            inline: true,
                        },
                        {
                            name: "Max Tickets Per User",
                            value: maxTicketsPerUser.toString(),
                            inline: true,
                        },
                        {
                            name: "DM on Close",
                            value: dmOnClose ? 'Enabled' : 'Disabled',
                            inline: true,
                        },
                        {
                            name: "Moderator",
                            value: `${interaction.user.tag} (${interaction.user.id})`,
                            inline: false,
                        },
                    );


            } catch (error) {
                logger.error('Ticket setup error', {
                    error: error.message,
                    stack: error.stack,
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'ticket_setup'
                });
                if (interaction.deferred || interaction.replied) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                "Setup Failed",
                                "Could not send the ticket panel or save configuration. Check the bot's permissions (especially the ability to send messages in the target channel) and database connection.",
                            ),
                        ],
                    }).catch(err => {
                        logger.error('Failed to send error reply', {
                            error: err.message,
                            guildId: interaction.guildId
                        });
                    });
                } else {
                    await handleInteractionError(interaction, error, {
                        commandName: 'ticket_setup',
                        source: 'ticket_setup_command'
                    });
                }
            }
        }
    } catch (error) {
        logger.error('Error executing ticket command', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            commandName: 'ticket'
        });
        await handleInteractionError(interaction, error, {
            commandName: 'ticket',
            source: 'ticket_command_main'
        });
    }
}

async function handleClaim(interaction, client) {
    try {
        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Not a Ticket Channel",
                        "This command can only be used in a valid ticket channel.",
                    ),
                ],
            });
        }

        if (!permissionContext.canManageTicket) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Permission Denied",
                        "You need the `Manage Channels` permission or the configured `Ticket Staff Role` to claim tickets.",
                    ),
                ],
            });
        }

        const channel = interaction.channel;
        const result = await claimTicket(channel, interaction.user);

        if (!result.success) {
            logger.warn('Ticket claim failed - not a valid ticket channel', {
                userId: interaction.user.id,
                channelId: channel.id,
                guildId: interaction.guildId,
                error: result.error
            });
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Not a Ticket Channel",
                        result.error || "This command can only be used in a valid ticket channel.",
                    ),
                ],
            });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    "Ticket Claimed!",
                    "You have successfully claimed this ticket.",
                ),
            ],
        });

        logger.info('Ticket claimed successfully', {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            channelId: channel.id,
            channelName: channel.name,
            guildId: interaction.guildId,
            commandName: 'claim'
        });

    } catch (error) {
        logger.error('Error executing claim command', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
            commandName: 'claim'
        });
        await handleInteractionError(interaction, error, {
            commandName: 'claim',
            source: 'ticket_claim_command'
        });
    }
}

async function handleClose(interaction, client) {
    try {
        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Not a Ticket Channel",
                        "This command can only be used in a valid ticket channel.",
                    ),
                ],
            });
        }

        if (!permissionContext.canCloseTicket) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Permission Denied",
                        "You need the `Manage Channels` permission, the configured `Ticket Staff Role`, or be the ticket creator to close this ticket.",
                    ),
                ],
            });
        }

        const channel = interaction.channel;
        const reason =
            interaction.options?.getString("reason") ||
            "Closed via command without a specific reason.";

        const result = await closeTicket(channel, interaction.user, reason);

        if (!result.success) {
            logger.warn('Ticket close failed - not a valid ticket channel', {
                userId: interaction.user.id,
                channelId: channel.id,
                guildId: interaction.guildId,
                error: result.error
            });
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Not a Ticket Channel",
                        result.error || "This command can only be used in a valid ticket channel.",
                    ),
                ],
            });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    "Ticket Closed!",
                    "This ticket has been closed successfully.",
                ),
            ],
        });

        logger.info('Ticket closed successfully', {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            channelId: channel.id,
            channelName: channel.name,
            guildId: interaction.guildId,
            reason: reason,
            commandName: 'close'
        });

    } catch (error) {
        logger.error('Error executing close command', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
            commandName: 'close'
        });
        await handleInteractionError(interaction, error, {
            commandName: 'close',
            source: 'ticket_close_command'
        });
    }
}

async function handlePriority(interaction, client) {
    try {
        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Not a Ticket Channel",
                        "This command can only be used in a valid ticket channel.",
                    ),
                ],
            });
        }

        if (!permissionContext.canManageTicket) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Permission Denied",
                        "You need the `Manage Channels` permission or the configured `Ticket Staff Role` to change ticket priority.",
                    ),
                ],
            });
        }

        const priorityLevel = interaction.options.getString("level");
        const result = await updateTicketPriority(interaction.channel, priorityLevel, interaction.user);

        if (!result.success) {
            logger.warn('Priority update failed - not a valid ticket channel', {
                userId: interaction.user.id,
                channelId: interaction.channel.id,
                guildId: interaction.guildId,
                error: result.error
            });
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Not a Ticket Channel",
                        result.error || "This command can only be used in a valid ticket channel.",
                    ),
                ],
            });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    "Priority Updated",
                    `Ticket priority set to **${priorityLevel.toUpperCase()}**.`,
                ),
            ],
        });

        logger.info('Ticket priority updated successfully', {
            userId: interaction.user.id,
            userTag: interaction.user.tag,
            channelId: interaction.channel.id,
            channelName: interaction.channel.name,
            guildId: interaction.guildId,
            priority: priorityLevel,
            commandName: 'priority'
        });

    } catch (error) {
        logger.error('Error executing priority command', {
            error: error.message,
            stack: error.stack,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
            commandName: 'priority'
        });
        await handleInteractionError(interaction, error, {
            commandName: 'priority',
            source: 'ticket_priority_command'
        });
    }
}

async function handleReopen(interaction, client) {
    try {
        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Not a Ticket Channel', 'This command can only be used in a valid ticket channel.')],
            });
        }

        if (!permissionContext.canManageTicket) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Permission Denied', 'You need `Manage Channels` or the configured Ticket Staff Role to reopen tickets.')],
            });
        }

        const result = await reopenTicket(interaction.channel, interaction.user);

        if (!result.success) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Could Not Reopen', result.error || 'This ticket is not currently closed.')],
            });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('Ticket Reopened', 'The ticket has been reopened and the user has regained access.')],
        });

        logger.info('Ticket reopened', {
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            guildId: interaction.guildId,
        });
    } catch (error) {
        logger.error('Error executing reopen command', {
            error: error.message,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
        });
        await handleInteractionError(interaction, error, { commandName: 'reopen', source: 'ticket_reopen_command' });
    }
}

async function handleUnclaim(interaction, client) {
    try {
        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Not a Ticket Channel', 'This command can only be used in a valid ticket channel.')],
            });
        }

        if (!permissionContext.canManageTicket) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Permission Denied', 'You need `Manage Channels` or the configured Ticket Staff Role to unclaim tickets.')],
            });
        }

        const result = await unclaimTicket(interaction.channel, interaction.user);

        if (!result.success) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Could Not Unclaim', result.error || 'This ticket is not currently claimed.')],
            });
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('Ticket Unclaimed', 'The ticket is now available for other staff to claim.')],
        });

        logger.info('Ticket unclaimed', {
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            guildId: interaction.guildId,
        });
    } catch (error) {
        logger.error('Error executing unclaim command', {
            error: error.message,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
        });
        await handleInteractionError(interaction, error, { commandName: 'unclaim', source: 'ticket_unclaim_command' });
    }
}

async function handleNote(interaction, client, sub) {
    try {
        if (!(await requireManageChannels(interaction, 'ticket_note'))) {
            return;
        }

        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Not a Ticket Channel', 'This command can only be used in a valid ticket channel.')],
            });
        }

        if (sub === 'add') {
            const content  = interaction.options.getString('content');
            const internal = interaction.options.getBoolean('internal') ?? true;

            const result = await addTicketNote(interaction.channel, interaction.user, content, internal);
            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Could Not Add Note', result.error || 'Failed to add the note.')],
                });
            }
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Note Added', `The note has been added to the ticket.\nNote ID: \`${result.note.id}\``)],
            });
        }

        if (sub === 'remove') {
            const noteId = interaction.options.getString('id');
            const result = await removeTicketNote(interaction.channel, noteId, interaction.user);
            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Could Not Remove Note', result.error || 'Failed to remove the note.')],
                });
            }
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Note Removed', 'The note has been removed from the ticket.')],
            });
        }

        // sub === 'list'
        const includeInternal = permissionContext.canManageTicket;
        const notes = await getTicketNotes(interaction.guildId, interaction.channel.id, includeInternal);

        if (notes.length === 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('No Notes', 'There are no notes on this ticket yet.')],
            });
        }

        const fields = notes.slice(0, 25).map(n => ({
            name: `${n.isInternal ? '🔒' : '📝'} \`${n.id}\``,
            value: `${n.content.length > 200 ? n.content.slice(0, 197) + '...' : n.content}\n— <@${n.authorId}> • <t:${Math.floor(new Date(n.createdAt).getTime() / 1000)}:R>`,
            inline: false,
        }));

        const embed = createEmbed({
            title: '📝 Ticket Notes',
            description: `Showing ${notes.length} note(s) on this ticket.`,
            fields,
        });

        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error('Error executing note command', {
            error: error.message,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
        });
        await handleInteractionError(interaction, error, { commandName: 'note', source: 'ticket_note_command' });
    }
}

async function handleTag(interaction, client, sub) {
    try {
        if (!(await requireManageChannels(interaction, 'ticket_tag'))) {
            return;
        }

        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Not a Ticket Channel', 'This command can only be used in a valid ticket channel.')],
            });
        }

        if (sub === 'add') {
            const tag = interaction.options.getString('name');
            const result = await addTicketTag(interaction.channel, tag, interaction.user);
            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Could Not Add Tag', result.error || 'Failed to add the tag.')],
                });
            }
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Tag Added', `Tag \`${result.tag}\` has been added to the ticket.`)],
            });
        }

        if (sub === 'remove') {
            const tag = interaction.options.getString('name');
            const result = await removeTicketTag(interaction.channel, tag, interaction.user);
            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Could Not Remove Tag', result.error || 'Failed to remove the tag.')],
                });
            }
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Tag Removed', `Tag \`${tag}\` has been removed from the ticket.`)],
            });
        }

        // sub === 'list'
        const tags = await getTicketTags(interaction.guildId, interaction.channel.id);
        if (tags.length === 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('No Tags', 'This ticket has no tags yet. Use `/ticket tag add` to add one.')],
            });
        }

        const embed = createEmbed({
            title: '🏷️ Ticket Tags',
            description: tags.map(t => `\`${t}\``).join(', '),
        });

        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error('Error executing tag command', {
            error: error.message,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
        });
        await handleInteractionError(interaction, error, { commandName: 'tag', source: 'ticket_tag_command' });
    }
}

async function handleWatch(interaction, client, sub) {
    try {
        if (!(await requireManageChannels(interaction, 'ticket_watch'))) {
            return;
        }

        const permissionContext = await getTicketPermissionContext({ client, interaction });
        if (!permissionContext.ticketData) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Not a Ticket Channel', 'This command can only be used in a valid ticket channel.')],
            });
        }

        if (sub === 'start') {
            const result = await watchTicket(interaction.channel, interaction.user.id);
            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Already Watching', result.error || 'You are already watching this ticket.')],
                });
            }
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Now Watching', 'You will receive DM notifications for activity on this ticket.')],
            });
        }

        if (sub === 'stop') {
            const result = await unwatchTicket(interaction.channel, interaction.user.id);
            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Not Watching', result.error || 'You are not currently watching this ticket.')],
                });
            }
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed('Stopped Watching', 'You will no longer receive notifications for this ticket.')],
            });
        }

        // sub === 'list'
        const watchers = await getTicketWatchers(interaction.guildId, interaction.channel.id);
        if (watchers.length === 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('No Watchers', 'Nobody is currently watching this ticket.')],
            });
        }

        const fields = watchers.slice(0, 25).map(w => ({
            name: `<@${w.userId}>`,
            value: `Since <t:${Math.floor(new Date(w.addedAt).getTime() / 1000)}:R>`,
            inline: true,
        }));

        const embed = createEmbed({
            title: '👁️ Ticket Watchers',
            description: `${watchers.length} user(s) watching this ticket.`,
            fields,
        });

        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error('Error executing watch command', {
            error: error.message,
            userId: interaction.user.id,
            channelId: interaction.channel?.id,
            guildId: interaction.guildId,
        });
        await handleInteractionError(interaction, error, { commandName: 'watch', source: 'ticket_watch_command' });
    }
}

async function handleTinfo(interaction, client, sub) {
    try {
        if (!(await requireManageChannels(interaction, 'ticket_tinfo'))) {
            return;
        }

        if (sub === 'stats') {
            const stats = await getTicketStats(client, interaction.guildId);
            const byPriority = Object.entries(stats.byPriority)
                .map(([k, v]) => `${PRIORITY_EMOJI[k] || '⚪'} ${k}: **${v}**`)
                .join('\n') || 'None';

            const embed = createEmbed({
                title: '📊 Ticket Statistics',
                fields: [
                    { name: 'Total Tickets', value: stats.total.toString(), inline: true },
                    { name: '🟢 Open', value: stats.open.toString(), inline: true },
                    { name: '🔴 Closed', value: stats.closed.toString(), inline: true },
                    { name: '✅ Claimed', value: stats.claimed.toString(), inline: true },
                    { name: '⏳ Unclaimed', value: stats.unclaimed.toString(), inline: true },
                    { name: '​', value: '​', inline: true },
                    { name: 'Last 24h', value: stats.ticketsLast24h.toString(), inline: true },
                    { name: 'Last 7d', value: stats.ticketsLast7d.toString(), inline: true },
                    { name: 'Last 30d', value: stats.ticketsLast30d.toString(), inline: true },
                    { name: 'Avg Resolution', value: stats.averageResolutionTime !== null ? `${stats.averageResolutionTime} min` : 'N/A', inline: true },
                    { name: 'Avg Response', value: stats.averageResponseTime !== null ? `${stats.averageResponseTime} min` : 'N/A', inline: true },
                    { name: '​', value: '​', inline: true },
                    { name: 'By Priority', value: byPriority, inline: false },
                ],
            });

            return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        }

        // sub === 'user'
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const tickets = await getTicketsByUser(interaction.guildId, targetUser.id);

        if (tickets.length === 0) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('No Tickets', `${targetUser} has no tickets on record.`)],
            });
        }

        const fields = tickets.slice(0, 25).map(t => {
            const priority = PRIORITY_EMOJI[t.priority || 'none'] || '⚪';
            const status = t.status === 'closed' ? '🔴 Closed' : '🟢 Open';
            const claimed = t.claimedBy ? `<@${t.claimedBy}>` : 'Unclaimed';
            return {
                name: `${priority} Ticket #${t.id}`,
                value: `${status} • Claimed: ${claimed} • Created <t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`,
                inline: false,
            };
        });

        const embed = createEmbed({
            title: `🎫 Tickets for ${targetUser.tag}`,
            description: `${tickets.length} ticket(s) on record.`,
            fields,
            thumbnail: { url: targetUser.displayAvatarURL({ size: 64 }) },
        });

        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
        logger.error('Error executing tinfo command', {
            error: error.message,
            userId: interaction.user.id,
            guildId: interaction.guildId,
        });
        await handleInteractionError(interaction, error, { commandName: 'tinfo', source: 'ticket_info_command' });
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Manages the server's ticket system.")
        .setDMPermission(false)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription(
                    "Sets up the ticket creation panel in a specified channel.",
                )
                .addChannelOption((option) =>
                    option
                        .setName("panel_channel")
                        .setDescription(
                            "The channel where the ticket panel will be sent.",
                        )
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )

                .addStringOption((option) =>
                    option
                        .setName("panel_message")
                        .setDescription(
                            "The main message/description for the ticket panel.",
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("button_label")
                        .setDescription(
                            "The label for the ticket creation button (default: Create Ticket)",
                        )
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("category")
                        .setDescription(
                            "The category where new tickets will be created (optional).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("closed_category")
                        .setDescription(
                            "The category where closed tickets will be moved (optional).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addRoleOption((option) =>
                    option
                        .setName("staff_role")
                        .setDescription(
                            "The role that can access tickets (optional).",
                        )
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("max_tickets_per_user")
                        .setDescription("Maximum number of tickets a user can create (default: 3)")
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName("dm_on_close")
                        .setDescription("Send DM to user when their ticket is closed (default: true)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Open the interactive ticket system dashboard"),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("claim")
                .setDescription("Claims an open ticket, assigning it to you."),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("close")
                .setDescription("Closes the current ticket.")
                .addStringOption((option) =>
                    option
                        .setName("reason")
                        .setDescription("The reason for closing the ticket.")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("priority")
                .setDescription("Sets the priority level for the current support ticket.")
                .addStringOption((option) =>
                    option
                        .setName("level")
                        .setDescription("The priority level for the ticket.")
                        .setRequired(true)
                        .addChoices(
                            { name: "🔴 Urgent", value: "urgent" },
                            { name: "🟠 High", value: "high" },
                            { name: "🟡 Medium", value: "medium" },
                            { name: "🟢 Low", value: "low" },
                            { name: "⚪ None", value: "none" },
                        ),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("reopen")
                .setDescription("Reopens a closed ticket channel."),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("unclaim")
                .setDescription("Releases your claim on a ticket so other staff can take it."),
        )
        .addSubcommandGroup((group) =>
            group
                .setName("note")
                .setDescription("Manage staff notes on a ticket.")
                .addSubcommand((sub) =>
                    sub.setName('add')
                        .setDescription('Add a note to the current ticket.')
                        .addStringOption((opt) =>
                            opt.setName('content')
                                .setDescription('The note content.')
                                .setRequired(true)
                                .setMaxLength(1000))
                        .addBooleanOption((opt) =>
                            opt.setName('internal')
                                .setDescription('If true, only staff can see the note (default: true).')
                                .setRequired(false)))
                .addSubcommand((sub) =>
                    sub.setName('remove')
                        .setDescription('Remove a note by its ID.')
                        .addStringOption((opt) =>
                            opt.setName('id')
                                .setDescription('The note ID to remove.')
                                .setRequired(true)))
                .addSubcommand((sub) =>
                    sub.setName('list')
                        .setDescription('List all notes on the current ticket.')),
        )
        .addSubcommandGroup((group) =>
            group
                .setName("tag")
                .setDescription("Manage tags on a ticket.")
                .addSubcommand((sub) =>
                    sub.setName('add')
                        .setDescription('Add a tag to the current ticket.')
                        .addStringOption((opt) =>
                            opt.setName('name')
                                .setDescription('The tag name (e.g. bug, billing, urgent).')
                                .setRequired(true)
                                .setMaxLength(30)))
                .addSubcommand((sub) =>
                    sub.setName('remove')
                        .setDescription('Remove a tag from the current ticket.')
                        .addStringOption((opt) =>
                            opt.setName('name')
                                .setDescription('The tag to remove.')
                                .setRequired(true)
                                .setAutocomplete(true)))
                .addSubcommand((sub) =>
                    sub.setName('list')
                        .setDescription('List all tags on the current ticket.')),
        )
        .addSubcommandGroup((group) =>
            group
                .setName("watch")
                .setDescription("Get notified about activity on a ticket.")
                .addSubcommand((sub) =>
                    sub.setName('start')
                        .setDescription('Start watching this ticket for activity.'))
                .addSubcommand((sub) =>
                    sub.setName('stop')
                        .setDescription('Stop watching this ticket.'))
                .addSubcommand((sub) =>
                    sub.setName('list')
                        .setDescription('List all watchers on this ticket.')),
        )
        .addSubcommandGroup((group) =>
            group
                .setName("tinfo")
                .setDescription("View ticket statistics or a user's ticket history.")
                .addSubcommand((sub) =>
                    sub.setName('stats')
                        .setDescription('Show server-wide ticket statistics.'))
                .addSubcommand((sub) =>
                    sub.setName('user')
                        .setDescription('Show tickets for a specific user.')
                        .addUserOption((opt) =>
                            opt.setName('user')
                                .setDescription('The user to look up.')
                                .setRequired(false))),
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) {
                return;
            }

            const group = interaction.options.getSubcommandGroup(false);
            const sub = interaction.options.getSubcommand(false);

            if (!group) {
                switch (sub) {
                    case "setup":
                    case "dashboard":
                        return await handleSetupOrDashboard(interaction, config, client, sub);
                    case "claim":
                        return await handleClaim(interaction, client);
                    case "close":
                        return await handleClose(interaction, client);
                    case "priority":
                        return await handlePriority(interaction, client);
                    case "reopen":
                        return await handleReopen(interaction, client);
                    case "unclaim":
                        return await handleUnclaim(interaction, client);
                    default:
                        return;
                }
            }

            switch (group) {
                case "note":
                    return await handleNote(interaction, client, sub);
                case "tag":
                    return await handleTag(interaction, client, sub);
                case "watch":
                    return await handleWatch(interaction, client, sub);
                case "tinfo":
                    return await handleTinfo(interaction, client, sub);
                default:
                    return;
            }
        } catch (error) {
            logger.error('Error executing ticket command', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ticket'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'ticket',
                source: 'ticket_command_main'
            });
        }
    },

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused().toLowerCase();
            const tags = await getTicketTags(interaction.guildId, interaction.channel.id);
            const filtered = tags
                .filter(t => t.includes(focused))
                .slice(0, 25)
                .map(t => ({ name: t, value: t }));
            await interaction.respond(filtered);
        } catch {
            await interaction.respond([]);
        }
    },
};
