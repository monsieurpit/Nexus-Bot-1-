import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../services/guildConfig.js';
import { postWeeklySummary, getWeeklyStats, buildWeeklySummaryEmbed } from '../../services/weeklySummaryService.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('weekly-summary')
    .setDescription('Configure and view weekly server activity summaries')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Configure the automated weekly summary channel and schedule')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('The text channel where weekly summaries will be posted')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('day')
            .setDescription('Day of the week to post the summary (UTC)')
            .setRequired(false)
            .addChoices(
              { name: 'Sunday', value: 'Sunday' },
              { name: 'Monday', value: 'Monday' },
              { name: 'Tuesday', value: 'Tuesday' },
              { name: 'Wednesday', value: 'Wednesday' },
              { name: 'Thursday', value: 'Thursday' },
              { name: 'Friday', value: 'Friday' },
              { name: 'Saturday', value: 'Saturday' }
            )
        )
        .addStringOption(opt =>
          opt
            .setName('time')
            .setDescription('Time of day (UTC) to post the summary')
            .setRequired(false)
            .addChoices(
              { name: '00:00 UTC', value: '00:00' },
              { name: '06:00 UTC', value: '06:00' },
              { name: '12:00 UTC', value: '12:00' },
              { name: '18:00 UTC', value: '18:00' },
              { name: '21:00 UTC', value: '21:00' }
            )
        )
        .addRoleOption(opt =>
          opt
            .setName('role')
            .setDescription('Optional role to mention when the summary is posted')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('send-now')
        .setDescription('Instantly generate and post a weekly summary')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Target channel (defaults to configured summary channel or current channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('View current weekly summary configuration and live tracked metrics')
    )
    .addSubcommand(sub =>
      sub
        .setName('history')
        .setDescription('View the last 3 archived weekly summaries')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable automated weekly server summaries')
    ),

  async execute(interaction, guildConfig, client) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    try {
      const config = await getGuildConfig(client, guildId);
      const currentWeekly = config?.weeklySummary || {};

      if (subcommand === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const day = interaction.options.getString('day') || currentWeekly.day || 'Sunday';
        const time = interaction.options.getString('time') || currentWeekly.time || '18:00';
        const role = interaction.options.getRole('role');

        const updatedWeekly = {
          ...currentWeekly,
          enabled: true,
          channelId: channel.id,
          day,
          time,
          roleId: role ? role.id : (currentWeekly.roleId || null)
        };

        await setGuildConfig(client, guildId, {
          weeklySummary: updatedWeekly
        });

        const embed = new EmbedBuilder()
          .setColor(getColor('success'))
          .setTitle('✅ Weekly Server Summary Configured')
          .setDescription(`Automated weekly summaries have been enabled!`)
          .addFields(
            { name: '📢 Post Channel', value: `${channel}`, inline: true },
            { name: '📅 Schedule', value: `Every **${day}** at **${time} UTC**`, inline: true },
            { name: '🔔 Mention Role', value: role ? `${role}` : (updatedWeekly.roleId ? `<@&${updatedWeekly.roleId}>` : 'None'), inline: true }
          )
          .setFooter({ text: 'Use /weekly-summary send-now to test posting immediately.' })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embed] });
      }

      if (subcommand === 'send-now') {
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;

        const sentMsg = await postWeeklySummary(client, guildId, targetChannel, true);

        if (sentMsg) {
          const embed = new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('🚀 Weekly Summary Sent!')
            .setDescription(`Successfully generated and posted the weekly summary in ${targetChannel}.`);

          return await interaction.editReply({ embeds: [embed] });
        } else {
          const embed = new EmbedBuilder()
            .setColor(getColor('error'))
            .setTitle('❌ Post Failed')
            .setDescription(`Could not post the weekly summary to ${targetChannel}. Please verify bot permissions (Send Messages & Embed Links).`);

          return await interaction.editReply({ embeds: [embed] });
        }
      }

      if (subcommand === 'status') {
        const isEnabled = currentWeekly.enabled ?? false;
        const channelMention = currentWeekly.channelId ? `<#${currentWeekly.channelId}>` : 'Not set';
        const scheduleStr = `Every ${currentWeekly.day || 'Sunday'} at ${currentWeekly.time || '18:00'} UTC`;
        const roleMention = currentWeekly.roleId ? `<@&${currentWeekly.roleId}>` : 'None';

        const stats = await getWeeklyStats(client, guildId);
        const liveEmbed = await buildWeeklySummaryEmbed(client, interaction.guild, stats);

        const statusEmbed = new EmbedBuilder()
          .setColor(getColor('info'))
          .setTitle('📊 Weekly Summary Configuration & Status')
          .addFields(
            { name: 'Status', value: isEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
            { name: 'Channel', value: channelMention, inline: true },
            { name: 'Schedule', value: scheduleStr, inline: true },
            { name: 'Role Ping', value: roleMention, inline: true }
          )
          .setFooter({ text: 'Preview of current week live metrics below:' });

        return await interaction.editReply({ embeds: [statusEmbed, liveEmbed] });
      }

      if (subcommand === 'history') {
        const { history } = await getWeeklyStats(client, guildId);
        if (!history || history.length === 0) {
          const embed = new EmbedBuilder()
            .setColor(getColor('info'))
            .setTitle('📜 Weekly Summary History')
            .setDescription('No previous weekly summaries have been archived yet.');
          return await interaction.editReply({ embeds: [embed] });
        }

        const embeds = [];
        const overviewEmbed = new EmbedBuilder()
          .setColor(getColor('info'))
          .setTitle('📜 Archived Weekly Summaries (Last 3 Weeks)')
          .setDescription(`Showing the **${history.length}** most recent archived weekly summaries for **${interaction.guild.name}**.`);
        embeds.push(overviewEmbed);

        for (let i = 0; i < history.length; i++) {
          const item = history[i];
          const dateStr = item.archivedAt ? new Date(item.archivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `Summary #${i + 1}`;
          const summaryEmbed = new EmbedBuilder()
            .setColor(getColor('bot'))
            .setTitle(`🗓️ Weekly Summary #${i + 1} (${dateStr})`)
            .addFields(
              { name: '👥 Member Activity', value: `Joins: **${item.joins || 0}** | Leaves: **${item.leaves || 0}**`, inline: true },
              { name: '💬 Chat & Moderation', value: `Messages: **${item.messagesSent || 0}** | Actions: **${item.moderations || 0}**`, inline: true },
              { name: '🎫 Tickets', value: `Opened: **${item.ticketsOpened || 0}** | Closed: **${item.ticketsClosed || 0}**`, inline: true }
            );
          embeds.push(summaryEmbed);
        }

        return await interaction.editReply({ embeds });
      }

      if (subcommand === 'disable') {
        await setGuildConfig(client, guildId, {
          weeklySummary: {
            ...currentWeekly,
            enabled: false
          }
        });

        const embed = new EmbedBuilder()
          .setColor(getColor('warning'))
          .setTitle('⏸️ Weekly Summaries Disabled')
          .setDescription('Automated weekly server summaries have been disabled.');

        return await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error('Error handling /weekly-summary command:', error);
      const embed = new EmbedBuilder()
        .setColor(getColor('error'))
        .setTitle('❌ Command Error')
        .setDescription('An error occurred while managing weekly summary settings.');

      return await interaction.editReply({ embeds: [embed] });
    }
  }
};
