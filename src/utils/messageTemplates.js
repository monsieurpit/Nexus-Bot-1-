import { EmbedBuilder } from 'discord.js';
import { getColor } from '../config/bot.js';
import { createEmbed } from './embeds.js';





export const MessageTemplates = {
    SUCCESS: {
        DATA_UPDATED: (action, description) => createEmbed({ timestamp: false })
            .setColor(getColor('success'))
            .setTitle(`✅ ${action.charAt(0).toUpperCase() + action.slice(1)} Successful`)
            .setDescription(description)
            .setTimestamp(),
        
        COMMAND_EXECUTED: (command) => createEmbed({ timestamp: false })
            .setColor(getColor('success'))
            .setTitle('✅ Command Executed')
            .setDescription(`Successfully executed \`${command}\``)
            .setTimestamp()
    },

    ERRORS: {
        DATABASE_ERROR: (operation) => createEmbed({ timestamp: false })
            .setColor(getColor('error'))
            .setTitle('🗄️ Database Error')
            .setDescription(`I'm having trouble with my database while ${operation}. Please try again later.`)
            .setTimestamp(),
        
        INSUFFICIENT_FUNDS: (currency, description) => createEmbed({ timestamp: false })
            .setColor(getColor('warning'))
            .setTitle('💰 Insufficient Funds')
            .setDescription(description || `You don't have enough ${currency} for this operation.`)
            .setTimestamp(),
        
        PERMISSION_DENIED: (permission) => createEmbed({ timestamp: false })
            .setColor(getColor('error'))
            .setTitle('🚫 Permission Denied')
            .setDescription(`You need the \`${permission}\` permission to use this command.`)
            .setTimestamp(),
        
        INVALID_INPUT: (field) => createEmbed({ timestamp: false })
            .setColor(getColor('warning'))
            .setTitle('❌ Invalid Input')
            .setDescription(`The ${field || 'input'} you provided is invalid. Please check and try again.`)
            .setTimestamp()
    },

    INFO: {
        LOADING: (description) => createEmbed({ timestamp: false })
            .setColor(getColor('warning'))
            .setTitle('⏳ Loading...')
            .setDescription(description || 'Please wait while I process your request.')
            .setTimestamp(),
        
        PROCESSING: (description) => createEmbed({ timestamp: false })
            .setColor(getColor('info'))
            .setTitle('⚙️ Processing')
            .setDescription(description || 'Processing your request...')
            .setTimestamp()
    }
};

export const ContextualMessages = {
    configUpdated: (title, configLines) => createEmbed({ timestamp: false })
        .setColor(getColor('success'))
        .setTitle(`✅ ${title} Updated`)
        .setDescription(configLines.join('\n'))
        .setTimestamp()
};

export default MessageTemplates;



