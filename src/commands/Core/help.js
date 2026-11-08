import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from "../../utils/embeds.js";
import { listHelpCategories } from "../../utils/helpCategories.js";
import {
    createSelectMenu,
} from "../../utils/components.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";
const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;







export async function createInitialHelpMenu(client) {
    const categories = await listHelpCategories();
    const totalCommands = categories.reduce((n, c) => n + c.count, 0);

    const options = [
        {
            label: "All commands / Todos los comandos",
            description: `Every command on one page (${totalCommands})`,
            value: ALL_COMMANDS_ID,
            emoji: "📋",
        },
        ...categories.map((c) => ({
            label: `${c.name} / ${c.es}`.slice(0, 100),
            description: `${c.count} command${c.count === 1 ? "" : "s"} · ${c.blurb}`.slice(0, 100),
            value: c.folder,
            emoji: c.icon,
        })),
    ];

    const botName = client?.user?.username || "Nexus";
    const servers = client?.guilds?.cache?.size;
    const embed = createEmbed({
        author: { name: `${botName} Help Center`, iconURL: client?.user?.displayAvatarURL?.({ size: 64 }) },
        title: "What can I help you with?",
        description:
            "Moderation, RaidShield protection, economy, leveling, tickets and more — all in one bot.\n" +
            "*Moderación, protección RaidShield, economía, niveles, tickets y más.*\n\n" +
            `**${totalCommands}** commands across **${categories.length}** categories` +
            (servers ? ` · serving **${servers}** server${servers === 1 ? "" : "s"}` : "") +
            "\n\nPick a category in the menu below 👇",
        color: "primary",
        thumbnail: client?.user?.displayAvatarURL?.({ size: 256 }),
        fields: categories.map((c) => ({
            name: `${c.icon} ${c.name}`,
            value: `${c.blurb}\n\`${c.count} command${c.count === 1 ? "" : "s"}\``,
            inline: true,
        })),
        footer: "Tip: type / in chat to browse commands with autocomplete",
    });

    const bugReportButton = new ButtonBuilder()
        .setCustomId(BUG_REPORT_BUTTON_ID)
        .setLabel("Report a bug")
        .setEmoji("🐞")
        .setStyle(ButtonStyle.Danger);

    const supportButton = new ButtonBuilder()
        .setLabel("Support server")
        .setEmoji("💬")
        .setURL("https://discord.gg/YCkwJk4HaC")
        .setStyle(ButtonStyle.Link);

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        "Select to view commands / Selecciona para ver comandos",
        options,
    );

    const buttonRow = new ActionRowBuilder().addComponents([
        bugReportButton,
        supportButton,
    ]);

    return {
        embeds: [embed],
        components: [buttonRow, selectRow],
    };
}

export default {
    allowDM: true,
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Displays the help menu with all available commands"),

    async execute(interaction, guildConfig, client) {
        
        const { MessageFlags } = await import('discord.js');
        await InteractionHelper.safeDefer(interaction);
        
        const { embeds, components } = await createInitialHelpMenu(client);

        await InteractionHelper.safeEditReply(interaction, {
            embeds,
            components,
        });

        setTimeout(async () => {
            try {
                const closedEmbed = createEmbed({
                    title: "💤 Help menu closed",
                    description: "This menu timed out — run `/help` again whenever you need it.\n*El menú se cerró; usa `/help` de nuevo.*",
                    color: "gray",
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [closedEmbed],
                    components: [],
                });
            } catch (error) {

            }
        }, HELP_MENU_TIMEOUT_MS);
    },
};


