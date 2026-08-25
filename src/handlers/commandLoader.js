import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);






function getSubcommandInfo(commandData) {
    const subcommands = [];
    
    if (commandData.options) {
        for (const option of commandData.options) {
if (option.type === 1) {
                subcommands.push(option.name);
} else if (option.type === 2) {
                if (option.options) {
                    for (const subOption of option.options) {
if (subOption.type === 1) {
                            subcommands.push(`${option.name}/${subOption.name}`);
                        }
                    }
                }
            }
        }
    }
    
    return subcommands;
}







async function getAllFiles(directory, fileList = []) {
    const files = await fs.readdir(directory, { withFileTypes: true });
    
    for (const file of files) {
        const filePath = path.join(directory, file.name);
        
        if (file.isDirectory()) {
            if (file.name === 'modules') {
                continue;
            }
            await getAllFiles(filePath, fileList);
        } else if (file.name.endsWith('.js')) {
            fileList.push(filePath);
        }
    }
    
    return fileList;
}






export async function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = await getAllFiles(commandsPath);
    
    logger.info(`Found ${commandFiles.length} command files to load`);
    
    const uniqueCommandNames = new Set();
    
    for (const filePath of commandFiles) {
        try {
            const normalizedPath = filePath.replace(/\\/g, '/');
            
            const commandName = path.basename(filePath, '.js');
            const commandDir = path.dirname(filePath);
            const category = path.basename(commandDir);
            
            const commandModule = await import(`file://${filePath}`);
            const command = commandModule.default || commandModule;
            
            if (!command.data || !command.execute) {
                logger.warn(`Command at ${filePath} is missing required "data" or "execute" property.`);
                continue;
            }
            
            command.category = category;
            command.filePath = normalizedPath;
            
            const primaryCommandName = command.data.name;
            
            if (!uniqueCommandNames.has(primaryCommandName)) {
                uniqueCommandNames.add(primaryCommandName);
                
                client.commands.set(primaryCommandName, command);
            }
            
            const subcommands = getSubcommandInfo(command.data.toJSON());
            
            logger.info(`Loaded command: ${primaryCommandName} from ${normalizedPath} (category: ${category})`);
            
            if (subcommands.length > 0) {
                logger.info(`  - Subcommands: ${subcommands.join(', ')}`);
            }
            
        } catch (error) {
            logger.error(`Error loading command from ${filePath}:`, error);
        }
    }
    
    const commandsWithSubcommands = Array.from(client.commands.values()).filter(cmd => {
        const subcommands = getSubcommandInfo(cmd.data.toJSON());
        return subcommands.length > 0;
    });
    
    const totalSubcommands = commandsWithSubcommands.reduce((total, cmd) => {
        return total + getSubcommandInfo(cmd.data.toJSON()).length;
    }, 0);
    
    const uniqueCommands = new Set();
    for (const [name, command] of client.commands.entries()) {
        if (command.data && command.data.name) {
            uniqueCommands.add(command.data.name);
        }
    }
    
    logger.info(`Loaded ${uniqueCommands.size} commands`);
    return client.commands;
}







export async function registerCommands(client, clientId, guildId) {
    try {
        const commands = [];
        // Commands exporting `guildOnly: true` (e.g. /benchmark, /announce — internal test-server
        // tooling) skip the global PUT entirely below and only ever go out via the dev-guild instant
        // sync, so they never appear as a command in any other server this bot is in. Every existing
        // command is unaffected — this array only fills when a command file opts in explicitly.
        const guildOnlyCommands = [];
        let totalSubcommands = 0;
        const registeredNames = new Set();

        for (const command of client.commands.values()) {
            if (command.data && typeof command.data.toJSON === 'function') {
                const commandName = command.data.name;

                logger.debug(`Processing command for registration: ${commandName}`);

                if (!registeredNames.has(commandName)) {
                    registeredNames.add(commandName);
                    const commandJson = command.data.toJSON();
                    if (command.guildOnly) {
                        guildOnlyCommands.push(commandJson);
                    } else {
                        commands.push(commandJson);
                    }

                    const subcommands = getSubcommandInfo(commandJson);
                    totalSubcommands += subcommands.length;

                    if (process.env.NODE_ENV !== 'production') {
                        logger.debug(`Registering command: ${commandName}`);
                    }
                } else {
                    logger.debug(`Skipping duplicate command: ${commandName}`);
                }
            } else {
                logger.warn(`Command missing data or toJSON method: ${command}`);
            }
        }
        
        const totalCommandsWithSubs = commands.length + totalSubcommands;
        
        // Validate commands first (common for both global and guild registration)
        logger.info('Validating commands before registration...');

        let validationErrors = [];
        [...commands, ...guildOnlyCommands].forEach((cmd, index) => {
            if (cmd.name && cmd.name.length > 32) {
                validationErrors.push(`Command ${cmd.name} has name longer than 32 chars: "${cmd.name}" (${cmd.name.length} chars)`);
            }
            if (cmd.description && cmd.description.length > 100) {
                validationErrors.push(`Command ${cmd.name} has description longer than 100 chars: "${cmd.description}" (${cmd.description.length} chars)`);
            }

            if (cmd.options) {
                cmd.options.forEach((option, optIndex) => {
                    if (option.name && option.name.length > 32) {
                        validationErrors.push(`Command ${cmd.name} option ${option.name} has name longer than 32 chars: "${option.name}" (${option.name.length} chars)`);
                    }
                    if (option.description && option.description.length > 100) {
                        validationErrors.push(`Command ${cmd.name} option ${option.name} has description longer than 100 chars: "${option.description}" (${option.description.length} chars)`);
                    }

                    if (option.choices) {
                        option.choices.forEach((choice, choiceIndex) => {
                            if (choice.name && choice.name.length > 100) {
                                validationErrors.push(`Command ${cmd.name} option ${option.name} choice ${choice.name} has name longer than 100 chars: "${choice.name}" (${choice.name.length} chars)`);
                            }
                            if (choice.value && choice.value.length > 100) {
                                validationErrors.push(`Command ${cmd.name} option ${option.name} choice ${choice.name} has value longer than 100 chars: "${choice.value}" (${choice.value.length} chars)`);
                            }
                        });
                    }

                    if (option.options) {
                        option.options.forEach((subOption, subOptIndex) => {
                            if (subOption.name && subOption.name.length > 32) {
                                validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} has name longer than 32 chars: "${subOption.name}" (${subOption.name.length} chars)`);
                            }
                            if (subOption.description && subOption.description.length > 100) {
                                validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} has description longer than 100 chars: "${subOption.description}" (${subOption.description.length} chars)`);
                            }

                            if (subOption.choices) {
                                subOption.choices.forEach((choice, choiceIndex) => {
                                    if (choice.name && choice.name.length > 100) {
                                        validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} choice ${choice.name} has name longer than 100 chars: "${choice.name}" (${choice.name.length} chars)`);
                                    }
                                    if (choice.value && choice.value.length > 100) {
                                        validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} choice ${choice.name} has value longer than 100 chars: "${choice.value}" (${choice.value.length} chars)`);
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });

        if (validationErrors.length > 0) {
            logger.error('Command validation failed. Errors:');
            validationErrors.forEach(error => logger.error(`  - ${error}`));
            throw new Error(`Command validation failed with ${validationErrors.length} errors`);
        }

        logger.info('Command validation passed');

        const MAX_COMMANDS = 100;
        let commandsToRegister = commands;

        if (commands.length > MAX_COMMANDS) {
            logger.warn(`Command count (${commands.length}) exceeds Discord limit (${MAX_COMMANDS}), truncating...`);
            commandsToRegister = commands.slice(0, MAX_COMMANDS);
            logger.info(`Truncated to ${commandsToRegister.length} commands for registration`);
        }

        const targetClientId = clientId || client.user?.id || client.application?.id;
        if (!targetClientId) {
            logger.warn('Could not register commands: No clientId or client.user.id available yet.');
            return;
        }

        // ─── GLOBAL REGISTRATION ───────────────────────────────────────────────
        // Always register commands globally so they are available in every guild.
        // ───────────────────────────────────────────────────────────────────────
        try {
            logger.info(`Registering ${commandsToRegister.length} commands globally for application ${targetClientId}...`);
            const data = await client.rest.put(
                `/applications/${targetClientId}/commands`,
                { body: commandsToRegister }
            );
            logger.info(`Successfully registered ${data.length} global commands`);
        } catch (error) {
            logger.error('Failed to register global commands:', error);
            throw error;
        }

        // ─── GUILD-LEVEL REGISTRATION FOR INSTANT VISIBILITY (dev guild only) ──
        // Discord's guild-scoped command limit is ALSO 100 — a completely separate quota from the
        // global one, not shared with it. This used to send every global-eligible command PLUS the
        // guild-only ones to the guild endpoint (103 total once guildOnly commands existed),
        // silently exceeding that separate 100-command guild cap: the bulk PUT is all-or-nothing,
        // so the whole call failed and NONE of the guild-only commands (/benchmark, /announce,
        // /set-ai-telemetry) ever reached Discord — while looking like it succeeded, since the
        // failure was only ever logged at `debug` level. Global commands don't need to be
        // re-sent here at all: Discord already shows them in every guild (including this one) once
        // they propagate, so this only ever needs to carry the guild-only commands — comfortably
        // under the 100 cap on their own, and no longer competing with the global set for it.
        // ───────────────────────────────────────────────────────────────────────
        if (guildId) {
            try {
                const guild = await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    logger.info(`Registering ${guildOnlyCommands.length} guild-only commands in dev guild ${guild.name} (${guild.id})...`);
                    await guild.commands.set(guildOnlyCommands);
                    logger.info(`Guild-only commands synced for ${guild.name}`);
                }
            } catch (err) {
                logger.error(`Could not sync guild-only commands for dev guild ${guildId}: ${err.message}`);
            }
        }

        // Clear any stray guild-scoped commands left over from a previous version of
        // this function that registered to every connected guild - those are what
        // caused every command to visibly appear twice in production servers.
        if (client.guilds?.cache) {
            for (const [gId, guild] of client.guilds.cache) {
                if (gId === guildId) continue;
                try {
                    const existing = await guild.commands.fetch();
                    if (existing.size > 0) {
                        logger.info(`Clearing ${existing.size} stray guild-scoped command(s) in ${guild.name} (${guild.id}) to fix duplicate command entries...`);
                        await guild.commands.set([]);
                    }
                } catch (err) {
                    logger.debug(`Could not clear stray guild commands for ${gId}: ${err.message}`);
                }
            }
        }
    } catch (error) {
        logger.error('Error registering commands:', error);
        throw error;
    }
}

export async function reloadCommand(client, commandName) {
    const command = client.commands.get(commandName);
    
    if (!command) {
        return { success: false, message: `Command "${commandName}" not found` };
    }
    
    try {
        const commandPath = path.resolve(command.filePath);
        const moduleUrl = pathToFileURL(commandPath);
        moduleUrl.searchParams.set('t', Date.now().toString());

        const newCommand = (await import(moduleUrl.href)).default;
        
        client.commands.set(commandName, newCommand);
        
        logger.info(`Reloaded command: ${commandName}`);
        return { success: true, message: `Successfully reloaded command "${commandName}"` };
    } catch (error) {
        logger.error(`Error reloading command "${commandName}":`, error);
        return { success: false, message: `Error reloading command: ${error.message}` };
    }
}


