import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getServerSave, restoreServerFromSnapshot, validateSnapshot } from '../../services/serverBackupService.js';
import { confirmMassAction } from '../../utils/massActionHelper.js';
import { getColor } from '../../config/bot.js';

export default {
    data: new SlashCommandBuilder()
        .setName("restore")
        .setDescription("Restore server channels from backup / Restaurar canales desde copia de seguridad")
        .addStringOption(option =>
            option
                .setName('id')
                .setDescription('The Save ID to restore from / El ID de la copia de seguridad a restaurar')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const guild = interaction.guild;
        const saveId = interaction.options.getString('id').toUpperCase();

        // Check for admin permission (double-check)
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            const errorEmbed = createEmbed({
                title: 'Permission Denied / Permiso Denegado',
                description: 'You need Administrator permission to use this command. / Necesitas permiso de Administrador para usar este comando.',
                color: 'error'
            });
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            // Get the save
            const snapshot = await getServerSave(guild.id, saveId);

            if (!snapshot) {
                const notFoundEmbed = createEmbed({
                    title: 'Save Not Found / Copia de Seguridad No Encontrada',
                    description: `No backup found with ID \`${saveId}\`. Use \`/save-server-list\` to see available saves.\n\nNo se encontro copia de seguridad con ID \`${saveId}\`. Usa \`/save-server-list\` para ver los guardados disponibles.`,
                    color: 'error'
                });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [notFoundEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Validate the whole snapshot before touching the server.
            const check = validateSnapshot(snapshot);
            if (!check.ok) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [createEmbed({
                        title: 'Backup Cannot Be Restored / Copia No Restaurable',
                        description: `Save \`${saveId}\` is incomplete or corrupted, so nothing was changed:\n• ${check.errors.join('\n• ')}\n\n` +
                            `La copia \`${saveId}\` está incompleta o dañada; no se cambió nada.`,
                        color: 'error'
                    })]
                });
            }

            // Preview + confirmation: a restore edits role permissions and channel overwrites
            // server-wide, and used to start the moment the command was sent.
            const confirmed = await confirmMassAction(interaction, {
                verb: 'Restore',
                count: check.summary.roles + check.summary.categories + check.summary.channels,
                reason: `/restore ${saveId} by ${interaction.user.tag}`,
                summary: `Restore save \`${saveId}\` from <t:${Math.floor((snapshot.createdAt || Date.now()) / 1000)}:f>?\n` +
                    `• **${check.summary.roles}** role(s) — existing roles with the same name get the saved permissions back\n` +
                    `• **${check.summary.categories}** categor(ies) and **${check.summary.channels}** channel(s) — missing ones are recreated, permissions reset to the save\n` +
                    (check.summary.hasSettings ? '• Server settings (AFK/system channels, verification level…)\n' : '') +
                    'Nothing is deleted. / No se elimina nada.',
            });
            if (!confirmed) return;

            // Start restoration
            const startEmbed = createEmbed({
                title: 'Restoration Started / Restauracion Iniciada',
                description: `Restoring channels from backup \`${saveId}\`...\n\nRestaurando canales desde la copia de seguridad \`${saveId}\`...`,
                color: 'warning'
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [startEmbed]
            });

            // Perform the restoration
            const results = await restoreServerFromSnapshot(guild, snapshot);

            // Build the results embed
            const nothingCreated = results.rolesCreated === 0 &&
                                   results.categoriesCreated === 0 &&
                                   results.channelsCreated === 0;

            const embed = createEmbed({ timestamp: false })
                .setColor(getColor('success'))
                .setTitle('Restoration Complete / Restauracion Completa')
                .setDescription(
                    nothingCreated
                        ? `Everything already existed — settings and permissions updated.\n\nTodo ya existía — configuración y permisos actualizados.`
                        : `Successfully restored from backup \`${saveId}\`.\n\nSe restauro exitosamente desde la copia de seguridad \`${saveId}\`.`
                )
                .addFields(
                    {
                        name: 'Roles',
                        value: `Created: **${results.rolesCreated}**\nUpdated: **${results.rolesUpdated}**`,
                        inline: true
                    },
                    {
                        name: 'Categories',
                        value: `Created: **${results.categoriesCreated}**\nUpdated: **${results.categoriesUpdated}**`,
                        inline: true
                    },
                    {
                        name: 'Channels',
                        value: `Created: **${results.channelsCreated}**\nUpdated: **${results.channelsUpdated}**`,
                        inline: true
                    },
                    {
                        name: 'Server Settings',
                        value: results.settingsRestored ? '✅ Restored' : '⚠️ Skipped (no change or no permission)',
                        inline: true
                    },
                    {
                        name: 'Backup Date / Fecha de la Copia',
                        value: `<t:${Math.floor(snapshot.createdAt / 1000)}:f>`,
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({
                    text: `Restored by ${interaction.user.tag} / Restaurado por ${interaction.user.tag}`
                });

            // Add errors if any
            if (results.errors.length > 0) {
                let errorText = results.errors.map(e => `• ${e}`).join('\n');
                if (errorText.length > 1000) {
                    errorText = errorText.substring(0, 990) + '\n... (truncated)';
                }
                embed.addFields({
                    name: 'Errors / Errores',
                    value: errorText,
                    inline: false
                });
                embed.setColor(getColor('warning'));
            }

            await interaction.editReply({
                embeds: [embed]
            });

            logger.info(`Server restoration completed for guild ${guild.id} from save ${saveId}`, results);

        } catch (error) {
            logger.error('Error in restore command:', error);

            const errorEmbed = createEmbed({
                title: 'Restoration Failed / Restauracion Fallida',
                description: `An error occurred during restoration: ${error.message}\n\nOcurrio un error durante la restauracion: ${error.message}`,
                color: 'error'
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }
    },
};
