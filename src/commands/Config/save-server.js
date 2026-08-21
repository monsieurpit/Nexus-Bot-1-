import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
    MessageFlags
} from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
    saveServerSnapshot,
    captureServerLayout,
    getServerSaves,
    MAX_SAVES_PER_GUILD
} from '../../services/serverBackupService.js';
import { getAutoSaveConfig, setAutoSaveConfig } from '../../services/autoSaveService.js';
import { getColor } from '../../config/bot.js';

export default {
    data: new SlashCommandBuilder()
        .setName('save-server')
        .setDescription('Server backup operations / Operaciones de copia de seguridad del servidor')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub
                .setName('snapshot')
                .setDescription('Take a snapshot of current server layout / Tomar una instantánea del diseño del servidor')
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List all saved server snapshots / Listar todas las copias de seguridad del servidor')
        )
        .addSubcommandGroup(group =>
            group
                .setName('notify')
                .setDescription('Manage auto-save notifications / Gestionar notificaciones de respaldo automático')
                .addSubcommand(sub =>
                    sub
                        .setName('set')
                        .setDescription('Set the channel for auto-save notifications / Establecer canal de notificaciones')
                        .addChannelOption(opt =>
                            opt
                                .setName('channel')
                                .setDescription('The channel to send backup notifications to')
                                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                                .setRequired(true)
                        )
                )
                .addSubcommand(sub =>
                    sub
                        .setName('clear')
                        .setDescription('Disable auto-save notifications / Desactivar notificaciones de respaldo automático')
                )
                .addSubcommand(sub =>
                    sub
                        .setName('status')
                        .setDescription('View current auto-save notification settings / Ver configuración actual de notificaciones')
                )
        ),

    async execute(interaction, guildConfig, client) {
        await InteractionHelper.safeDefer(interaction);

        const guild = interaction.guild;
        const userId = interaction.user.id;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            const errEmbed = createEmbed({
                title: 'Permission Denied / Permiso Denegado',
                description: 'You need Administrator permission to use this command. / Necesitas permiso de Administrador para usar este comando.',
                color: 'error'
            });
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        if (group === 'notify') {
            return handleNotify(interaction, sub, client);
        }

        if (sub === 'list') {
            return handleList(interaction);
        }

        return handleSnapshot(interaction, guild, userId);
    },
};

async function handleSnapshot(interaction, guild, userId) {
    try {
        const existingSaves = await getServerSaves(guild.id);
        const snapshot = captureServerLayout(guild, userId);
        const result = await saveServerSnapshot(guild.id, snapshot);

        const totalChannels = snapshot.categories.reduce((acc, cat) => acc + cat.channels.length, 0);
        const totalCategories = snapshot.categories.filter(c => c.id !== null).length;
        const totalRoles = snapshot.roles ? snapshot.roles.length : 0;

        let description = `Successfully saved server layout! / ¡Diseño del servidor guardado exitosamente!\n\n`;
        description += `**Save ID / ID de Guardado:** \`${result.saveId}\`\n`;
        description += `**Roles Captured / Roles Capturados:** ${totalRoles}\n`;
        description += `**Channels Captured / Canales Capturados:** ${totalChannels}\n`;
        description += `**Categories Captured / Categorias Capturadas:** ${totalCategories}\n`;
        description += `**Server Settings:** ✅ Captured\n`;
        description += `**Saves Remaining / Guardados Restantes:** ${MAX_SAVES_PER_GUILD - existingSaves.length}/${MAX_SAVES_PER_GUILD}`;

        if (result.overwritten) {
            description += `\n\n⚠️ **Oldest save overwritten / Guardado mas antiguo sobrescrito:** \`${result.overwritten}\``;
        }

        const sEmbed = createEmbed({
            title: 'Server Backup Created / Copia de Seguridad Creada',
            description,
            color: 'success'
        });

        sEmbed.setFooter({
            text: `Created by ${interaction.user.tag} / Creado por ${interaction.user.tag}`
        });
        sEmbed.setTimestamp();

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [sEmbed]
        });

        logger.info(`Server backup created by ${userId} for guild ${guild.id}: ${result.saveId}`);
    } catch (error) {
        logger.error('Error in save-server command:', error);
        const errEmbed = createEmbed({
            title: 'Error / Error',
            description: 'An error occurred while saving the server layout.',
            color: 'error'
        });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errEmbed],
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleList(interaction) {
    try {
        const saves = await getServerSaves(interaction.guild.id);

        if (saves.length === 0) {
            const noSavesEmbed = createEmbed({
                title: 'No Saves Found / No se encontraron copias de seguridad',
                description: 'No server snapshots have been saved for this server. Use `/save-server snapshot` to create one.',
                color: 'info'
            });
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [noSavesEmbed]
            });
        }

        saves.sort((a, b) => b.createdAt - a.createdAt);

        const embed = new EmbedBuilder()
            .setColor(getColor('primary'))
            .setTitle('Server Backups / Copias de Seguridad del Servidor')
            .setDescription(`Found **${saves.length}** saved snapshot(s) for this server.`)
            .setTimestamp()
            .setFooter({ text: `Server: ${interaction.guild.name}` });

        for (const save of saves) {
            const date = new Date(save.createdAt);
            const formattedDate = `<t:${Math.floor(date.getTime() / 1000)}:f>`;
            const relativeDate = `<t:${Math.floor(date.getTime() / 1000)}:R>`;

            embed.addFields({
                name: `Save ID: \`${save.saveId}\``,
                value: `**Created:** ${formattedDate} (${relativeDate})\n` +
                       `**Roles:** ${save.roleCount || 0}\n` +
                       `**Channels:** ${save.channelCount}\n` +
                       `**Creator:** <@${save.creatorId}>`,
                inline: false
            });
        }

        embed.addFields({
            name: 'How to Restore / Como Restaurar',
            value: 'Use `/restore <save_id>` to restore channels from a backup.',
            inline: false
        });

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed]
        });
    } catch (error) {
        logger.error('Error in save-server list:', error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Error', 'An error occurred while fetching backup list.')],
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleNotify(interaction, sub, client) {
    const { guild } = interaction;
    if (sub === 'set') {
        const channel = interaction.options.getChannel('channel');
        let me = guild.members.me;
        if (!me) {
            me = await guild.members.fetchMe().catch(() => null);
        }
        const perms = me ? channel.permissionsFor(me) : channel.permissionsFor(client.user.id);
        
        if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Missing Permissions / Permisos Insuficientes',
                    `I need **View Channel**, **Send Messages**, and **Embed Links** permissions in ${channel}.`
                )],
            });
        }

        const ok = await setAutoSaveConfig(client, guild.id, { channelId: channel.id });
        if (!ok) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Save Failed', 'Could not save the configuration.')],
            });
        }

        const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('✅ Auto-Save Notifications Configured')
            .setDescription(`Automatic backup notifications will now be sent to ${channel}.\nThe server is automatically backed up every **3 days**.`)
            .setTimestamp();

        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    if (sub === 'clear') {
        await setAutoSaveConfig(client, guild.id, { channelId: null });
        const embed = new EmbedBuilder()
            .setColor(getColor('warning'))
            .setTitle('🔕 Notifications Disabled')
            .setDescription('Auto-save notifications have been disabled. The server will still be backed up every 3 days.')
            .setTimestamp();
        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }

    if (sub === 'status') {
        const cfg = await getAutoSaveConfig(client, guild.id);
        const channelMention = cfg.channelId ? `<#${cfg.channelId}>` : 'Not set';
        const lastSave = cfg.lastSaveAt ? `<t:${Math.floor(cfg.lastSaveAt / 1000)}:F> (<t:${Math.floor(cfg.lastSaveAt / 1000)}:R>)` : 'Never';
        const nextSave = cfg.lastSaveAt ? `<t:${Math.floor((cfg.lastSaveAt + 3 * 24 * 60 * 60 * 1000) / 1000)}:R>` : 'Within 24 hours';

        const embed = new EmbedBuilder()
            .setColor(getColor('info'))
            .setTitle('🔒 Auto-Save Status')
            .addFields(
                { name: '📢 Notification Channel', value: channelMention, inline: false },
                { name: '🕐 Last Auto-Save', value: lastSave, inline: true },
                { name: '⏭️ Next Auto-Save', value: nextSave, inline: true },
            )
            .setFooter({ text: 'Auto-saves run every 3 days' })
            .setTimestamp();

        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }
}
