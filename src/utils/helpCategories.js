// Single source of truth for how command categories are presented in /help. Keys are the real
// folder names under src/commands — the help menu used to carry two copies of a hand-written
// icon map listing categories that don't exist (Counter, Search) and missing real ones.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const COMMANDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../commands');

export const HELP_CATEGORIES = {
  Core:           { icon: '🧭', name: 'Core',           es: 'General',        color: 'primary',    blurb: 'Help, stats, ping and bot info' },
  Moderation:     { icon: '🛡️', name: 'Moderation',     es: 'Moderación',     color: 'moderation', blurb: 'Bans, timeouts, warnings, cases, RaidShield' },
  Economy:        { icon: '🪙', name: 'Economy',        es: 'Economía',       color: 'economy',    blurb: 'Coins, bank, shop, packs and games' },
  Leveling:       { icon: '📈', name: 'Leveling',       es: 'Niveles',        color: 'leveling',   blurb: 'XP, ranks, leaderboards and rewards' },
  Ticket:         { icon: '🎫', name: 'Tickets',        es: 'Tickets',        color: 'info',       blurb: 'Private support tickets' },
  Giveaway:       { icon: '🎉', name: 'Giveaways',      es: 'Sorteos',        color: 'community',  blurb: 'Run and manage giveaways' },
  Welcome:        { icon: '👋', name: 'Welcome',        es: 'Bienvenida',     color: 'community',  blurb: 'Welcome/goodbye messages, auto-roles' },
  Verification:   { icon: '✅', name: 'Verification',   es: 'Verificación',   color: 'success',    blurb: 'Member verification and gating' },
  Reaction_roles: { icon: '🎭', name: 'Reaction Roles', es: 'Roles',          color: 'community',  blurb: 'Self-assignable role panels' },
  Community:      { icon: '👥', name: 'Community',      es: 'Comunidad',      color: 'community',  blurb: 'Staff applications and community tools' },
  JoinToCreate:   { icon: '🎙️', name: 'Join to Create', es: 'Voz dinámica',   color: 'utility',    blurb: 'Temporary voice channels' },
  ServerStats:    { icon: '📊', name: 'Server Stats',   es: 'Estadísticas',   color: 'utility',    blurb: 'Live counters and weekly summaries' },
  Logging:        { icon: '📜', name: 'Logging',        es: 'Registros',      color: 'gray',       blurb: 'Audit logs for your server' },
  Fun:            { icon: '🎲', name: 'Fun',            es: 'Diversión',      color: 'community',  blurb: 'Games, debates and questions' },
  Tools:          { icon: '🛠️', name: 'Tools',          es: 'Herramientas',   color: 'utility',    blurb: 'Embeds, polls, announcements, sticky notes' },
  Utility:        { icon: '🔧', name: 'Utility',        es: 'Utilidades',     color: 'utility',    blurb: 'AFK, user/server info, reports, voice' },
  Config:         { icon: '⚙️', name: 'Config',         es: 'Configuración',  color: 'gray',       blurb: 'Server setup, football, backups' },
};

// Display order on the home page (most-used first). Unknown folders are appended.
const ORDER = ['Core', 'Moderation', 'Economy', 'Leveling', 'Ticket', 'Giveaway', 'Welcome', 'Verification', 'Reaction_roles',
  'Community', 'JoinToCreate', 'ServerStats', 'Logging', 'Fun', 'Tools', 'Utility', 'Config'];

export function categoryMeta(folder) {
  return HELP_CATEGORIES[folder] || { icon: '📁', name: folder.replace(/_/g, ' '), es: folder, color: 'primary', blurb: '' };
}

/** [{ folder, count, ...meta }] for every real category folder, in display order. */
export async function listHelpCategories() {
  const dirs = (await fs.readdir(COMMANDS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const sorted = [...ORDER.filter((c) => dirs.includes(c)), ...dirs.filter((d) => !ORDER.includes(d)).sort()];
  const result = [];
  for (const folder of sorted) {
    const files = (await fs.readdir(path.join(COMMANDS_DIR, folder))).filter((f) => f.endsWith('.js'));
    result.push({ folder, count: files.length, ...categoryMeta(folder) });
  }
  return result;
}
