import { PermissionFlagsBits as P, ChannelType } from 'discord.js';
import { logger } from '../utils/logger.js';

/**
 * serverBuilderService — scaffolds an entire Discord server (roles, categories,
 * channels, permission overwrites, base guild settings) to match this bot's
 * feature set, in one pass.
 *
 * Unlike serverBackupService (which replays a snapshot you already captured),
 * this builds a server from a fixed blueprint defined below. It is purely
 * additive: anything already present with the same name is reused, never
 * deleted or overwritten.
 *
 * Used by the /build-server command. Kept as a service so the command file
 * stays thin, matching the rest of the codebase.
 */

// ── SCOPES ───────────────────────────────────────────────────────────────────
export const BUILD_SCOPES = {
  core: 'Community, moderation/logging, tickets, giveaways, verification, welcome, leveling, join-to-create.',
  'core-ai': 'Everything in "core" plus economy and the Nexus AI Lab (RaidShield + AI-telemetry channels).',
  full: 'Everything in "core-ai" plus the FC Barcelona / LaLiga football section.',
};

// ── ROLE BLUEPRINT — highest first ───────────────────────────────────────────
const ROLES = [
  { key: 'owner',      name: '👑 Owner',         color: 0xE91E63, hoist: true,  scopes: '*', perms: [P.Administrator] },
  { key: 'admin',      name: '🛡️ Admin',         color: 0xED4245, hoist: true,  scopes: '*', perms: [P.Administrator] },
  { key: 'mod',        name: '⚖️ Moderator',     color: 0x5865F2, hoist: true,  scopes: '*', perms: [
      P.KickMembers, P.BanMembers, P.ModerateMembers, P.ManageMessages, P.ManageNicknames,
      P.ManageThreads, P.MuteMembers, P.MoveMembers, P.DeafenMembers, P.ViewAuditLog,
      P.ManageChannels, P.ManageRoles, P.MentionEveryone,
  ] },
  { key: 'staff',      name: '🔧 Trial Staff',   color: 0x1ABC9C, hoist: true,  scopes: '*', perms: [
      P.ModerateMembers, P.ManageMessages, P.ManageThreads, P.MuteMembers, P.MoveMembers,
  ] },
  { key: 'support',    name: '🎫 Support Team',  color: 0xFAA61A, hoist: true,  scopes: '*', perms: [P.ManageMessages] },
  { key: 'premium',    name: '💎 Premium',       color: 0x9B59B6, hoist: false, scopes: '*', perms: [] },
  { key: 'lvl50',      name: '⭐ Level 50',      color: 0xF1C40F, hoist: false, scopes: '*', perms: [] },
  { key: 'lvl25',      name: '✨ Level 25',      color: 0xF39C12, hoist: false, scopes: '*', perms: [] },
  { key: 'lvl10',      name: '🔅 Level 10',      color: 0xE67E22, hoist: false, scopes: '*', perms: [] },
  { key: 'announce',   name: '📢 Announcements', color: 0x3498DB, hoist: false, scopes: '*', perms: [], mentionable: true },
  { key: 'giveaway',   name: '🎉 Giveaways',     color: 0x2ECC71, hoist: false, scopes: '*', perms: [], mentionable: true },
  { key: 'events',     name: '🎮 Events',        color: 0x00B0F4, hoist: false, scopes: '*', perms: [], mentionable: true },
  { key: 'culer',      name: '🔵🔴 Culer',       color: 0xA50044, hoist: false, scopes: ['full'], perms: [], mentionable: true },
  { key: 'verified',   name: '✅ Member',        color: 0x95A5A6, hoist: false, scopes: '*', perms: [] },
  { key: 'bots',       name: '🤖 Bots',          color: 0x808080, hoist: false, scopes: '*', perms: [] },
  { key: 'quarantine', name: '🚫 Quarantined',   color: 0x2F3136, hoist: false, scopes: '*', perms: [] },
  { key: 'muted',      name: '🔇 Muted',         color: 0x2F3136, hoist: false, scopes: '*', perms: [] },
];

// ── CATEGORY + CHANNEL BLUEPRINT ────────────────────────────────────────────
// visibility: 'public' | 'members' | 'staff'
// channel tuple: [name, type, opts?]
//   type: text | voice | announcement | stage | forum
//   opts.readonly  — members can't send (staff can)
//   opts.slowmode  — seconds
//   opts.lockVoice — deny Connect for @everyone (used for stat labels)
const LAYOUT = [
  {
    name: '📊 SERVER STATS', visibility: 'public', scopes: '*',
    channels: [
      ['Members: —', 'voice', { lockVoice: true }],
      ['Humans: —', 'voice', { lockVoice: true }],
      ['Bots: —', 'voice', { lockVoice: true }],
    ],
  },
  {
    name: '👋 START HERE', visibility: 'public', scopes: '*',
    channels: [
      ['welcome', 'text', { readonly: true }],
      ['rules', 'text', { readonly: true }],
      ['verify', 'text', { readonly: true }],
      ['announcements', 'announcement', { readonly: true }],
      ['nexus-updates', 'text', { readonly: true }],
      ['roles', 'text', { readonly: true }],
    ],
  },
  {
    name: '💬 COMMUNITY', visibility: 'members', scopes: '*',
    channels: [
      ['general', 'text'],
      ['general-2', 'text'],
      ['nexus-chat', 'text'],
      ['media', 'text'],
      ['memes', 'text'],
      ['counting', 'text', { slowmode: 3 }],
      ['bot-commands', 'text'],
    ],
  },
  {
    name: '🎯 ENGAGEMENT', visibility: 'members', scopes: '*',
    channels: [
      ['level-ups', 'text', { readonly: true }],
      ['milestones', 'text', { readonly: true }],
      ['giveaways', 'text', { readonly: true }],
      ['polls-suggestions', 'text'],
      ['debates', 'text'],
      ['questions', 'text'],
    ],
  },
  {
    name: '💰 ECONOMY', visibility: 'members', scopes: ['core-ai', 'full'],
    channels: [
      ['economy', 'text'],
      ['gambling', 'text'],
      ['card-packs', 'text'],
      ['role-shop', 'text', { readonly: true }],
    ],
  },
  {
    name: '🎫 SUPPORT', visibility: 'members', scopes: '*',
    channels: [
      ['create-a-ticket', 'text', { readonly: true }],
      ['report-a-member', 'text', { readonly: true }],
    ],
  },
  {
    name: '⚽ FC BARCELONA', visibility: 'members', scopes: ['full'],
    channels: [
      ['barca-chat', 'text'],
      ['match-schedule', 'text', { readonly: true }],
      ['laliga-standings', 'text', { readonly: true }],
      ['match-threads', 'text'],
    ],
  },
  {
    name: '🧠 NEXUS AI LAB', visibility: 'staff', scopes: ['core-ai', 'full'],
    channels: [
      ['ai-announcements', 'text'],
      ['bot-logs', 'text'],
      ['prompt-workbench', 'text'],
      ['jailbreak-stress-test', 'text'],
      ['benchmark-suite', 'text'],
      ['negative-feedback', 'text'],
    ],
  },
  {
    name: '🛠️ STAFF', visibility: 'staff', scopes: '*',
    channels: [
      ['staff-chat', 'text'],
      ['staff-announcements', 'text'],
      ['staff-suggestions', 'text'],
      ['mod-log', 'text'],
      ['server-log', 'text'],
      ['message-log', 'text'],
      ['voice-log', 'text'],
      ['join-leave-log', 'text'],
      ['ticket-logs', 'text'],
      ['quarantine', 'text'],
    ],
  },
  {
    name: '🔊 VOICE', visibility: 'members', scopes: '*',
    channels: [
      ['➕ Join to Create', 'voice'],
      ['General VC', 'voice'],
      ['General VC 2', 'voice'],
      ['Music', 'voice'],
      ['Streaming', 'voice'],
      ['AFK', 'voice'],
    ],
  },
  {
    name: '🔒 STAFF VOICE', visibility: 'staff', scopes: '*',
    channels: [['Staff VC', 'voice']],
  },
];

const CHANNEL_TYPE = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  stage: ChannelType.GuildStageVoice,
  forum: ChannelType.GuildForum,
};

const inScope = (scopes, scope) => scopes === '*' || (Array.isArray(scopes) && scopes.includes(scope));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const matchesName = (channel, wanted) =>
  channel.name === wanted || channel.name === slug(wanted);

/**
 * Return a text-only preview of what a build at `scope` would create,
 * without touching the guild.
 */
export function previewServerBuild(guild, scope = 'core-ai') {
  const roles = ROLES.filter((r) => inScope(r.scopes, scope));
  const cats = LAYOUT.filter((c) => inScope(c.scopes, scope));
  const existingRoleNames = new Set(guild.roles.cache.map((r) => r.name));
  const existingChannelNames = new Set(guild.channels.cache.map((c) => c.name));

  return {
    scope,
    roles: roles.map((r) => ({ name: r.name, exists: existingRoleNames.has(r.name) })),
    categories: cats.map((c) => ({
      name: c.name,
      exists: existingChannelNames.has(c.name),
      channels: c.channels.map(([n]) => ({
        name: n,
        exists: existingChannelNames.has(n) || existingChannelNames.has(slug(n)),
      })),
    })),
    totals: {
      roles: roles.length,
      categories: cats.length,
      channels: cats.reduce((a, c) => a + c.channels.length, 0),
    },
  };
}

/**
 * Build the server from the blueprint.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object}  opts
 * @param {'core'|'core-ai'|'full'} [opts.scope='core-ai']
 * @param {string}  [opts.reason]
 * @returns {Promise<object>} results summary
 */
export async function buildServer(guild, { scope = 'core-ai', reason = 'Server build (/build-server)' } = {}) {
  const results = {
    scope,
    rolesCreated: [], rolesExisting: [],
    categoriesCreated: [], channelsCreated: [], channelsExisting: [],
    settingsApplied: [], notes: [], errors: [],
  };

  const me = guild.members.me;
  if (!me?.permissions.has(P.ManageChannels) || !me?.permissions.has(P.ManageRoles)) {
    results.errors.push('Bot is missing Manage Channels / Manage Roles (Administrator recommended).');
    return results;
  }

  const everyone = guild.roles.everyone;
  const roleMap = {};

  // ── ROLES: create lowest-first so each new one stacks above the previous ──
  const wantedRoles = ROLES.filter((r) => inScope(r.scopes, scope));
  for (const def of [...wantedRoles].reverse()) {
    let role = guild.roles.cache.find((r) => r.name === def.name);
    if (role) {
      results.rolesExisting.push(def.name);
    } else {
      try {
        role = await guild.roles.create({
          name: def.name,
          color: def.color,
          hoist: def.hoist,
          mentionable: def.mentionable ?? false,
          permissions: def.perms,
          reason,
        });
        results.rolesCreated.push(def.name);
      } catch (err) {
        results.errors.push(`Role "${def.name}": ${err.message}`);
        continue;
      }
    }
    roleMap[def.key] = role;
  }

  try {
    const ordered = wantedRoles.map((d) => roleMap[d.key]).filter(Boolean);
    await guild.roles.setPositions(ordered.map((role, i) => ({ role, position: ordered.length - i })));
  } catch (err) {
    results.notes.push(`Could not fully reorder roles (${err.message}). Drag the bot's role higher in Server Settings → Roles.`);
  }

  const staffRoles = [roleMap.support, roleMap.staff, roleMap.mod, roleMap.admin, roleMap.owner].filter(Boolean);
  const denyView = { id: everyone.id, deny: [P.ViewChannel] };
  const mutedOw = roleMap.muted
    ? { id: roleMap.muted.id, deny: [P.SendMessages, P.AddReactions, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads, P.Speak] }
    : null;
  const quarantineOw = roleMap.quarantine ? { id: roleMap.quarantine.id, deny: [P.ViewChannel] } : null;

  const overwritesFor = (visibility) => {
    const ow = [];
    if (visibility === 'public') {
      ow.push({ id: everyone.id, allow: [P.ViewChannel], deny: [P.CreatePublicThreads, P.CreatePrivateThreads] });
    } else if (visibility === 'members') {
      ow.push(denyView);
      if (roleMap.verified) ow.push({ id: roleMap.verified.id, allow: [P.ViewChannel] });
    } else if (visibility === 'staff') {
      ow.push(denyView);
      for (const sr of staffRoles) ow.push({ id: sr.id, allow: [P.ViewChannel, P.SendMessages] });
    }
    if (roleMap.bots) ow.push({ id: roleMap.bots.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles] });
    if (mutedOw) ow.push(mutedOw);
    if (quarantineOw && visibility !== 'staff') ow.push(quarantineOw);
    return ow;
  };

  // ── CATEGORIES + CHANNELS ───────────────────────────────────────────────
  const madeChannels = {}; // name -> channel
  for (const cat of LAYOUT.filter((c) => inScope(c.scopes, scope))) {
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === cat.name,
    );
    if (!category) {
      try {
        category = await guild.channels.create({
          name: cat.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: overwritesFor(cat.visibility),
          reason,
        });
        results.categoriesCreated.push(cat.name);
      } catch (err) {
        results.errors.push(`Category "${cat.name}": ${err.message}`);
        continue;
      }
    }

    for (const [chName, chType, chOpts = {}] of cat.channels) {
      const existing = guild.channels.cache.find(
        (c) => c.parentId === category.id && matchesName(c, chName),
      );
      if (existing) {
        results.channelsExisting.push(chName);
        madeChannels[chName] = existing;
        continue;
      }

      const extra = [];
      if (chOpts.readonly) {
        const target = cat.visibility === 'public' ? everyone.id : roleMap.verified?.id;
        if (target) extra.push({ id: target, deny: [P.SendMessages, P.AddReactions] });
      }
      if (chOpts.lockVoice) extra.push({ id: everyone.id, deny: [P.Connect] });

      const createOpts = {
        name: chName,
        type: CHANNEL_TYPE[chType] ?? ChannelType.GuildText,
        parent: category.id,
        rateLimitPerUser: chOpts.slowmode || 0,
        permissionOverwrites: [...overwritesFor(cat.visibility), ...extra],
        reason,
      };

      try {
        madeChannels[chName] = await guild.channels.create(createOpts);
        results.channelsCreated.push(chName);
      } catch (err) {
        if (createOpts.type === ChannelType.GuildAnnouncement) {
          try {
            madeChannels[chName] = await guild.channels.create({ ...createOpts, type: ChannelType.GuildText });
            results.channelsCreated.push(chName);
            results.notes.push(`#${chName} made as text — enable Community to convert it to an Announcement channel.`);
          } catch (err2) {
            results.errors.push(`Channel "${chName}": ${err2.message}`);
          }
        } else {
          results.errors.push(`Channel "${chName}": ${err.message}`);
        }
      }
    }
  }

  // ── BASE GUILD SETTINGS ─────────────────────────────────────────────────
  const afk = madeChannels['AFK'];
  if (afk) {
    try {
      await guild.edit({ afkChannel: afk.id, afkTimeout: 300 });
      results.settingsApplied.push('AFK channel');
    } catch (err) { results.notes.push(`AFK channel not set: ${err.message}`); }
  }
  const sys = madeChannels['general'];
  if (sys) {
    try {
      await guild.edit({ systemChannel: sys.id });
      results.settingsApplied.push('System messages channel');
    } catch { /* non-fatal */ }
  }

  // ── FOLLOW-UP WIRING HINTS ──────────────────────────────────────────────
  const c = (n) => (madeChannels[n] ? `<#${madeChannels[n].id}>` : `#${n}`);
  const r = (k) => (roleMap[k] ? `<@&${roleMap[k].id}>` : k);
  results.wiring = [
    `/verification setup — panel ${c('verify')}, role ${r('verified')}`,
    `/welcome — ${c('welcome')}   ·   /goodbye — ${c('join-leave-log')}`,
    `/logging setchannel — mod ${c('mod-log')}, server ${c('server-log')}, messages ${c('message-log')}, voice ${c('voice-log')}, joins ${c('join-leave-log')}`,
    `/mod-set & /admin-set — ${r('mod')} / ${r('admin')}`,
    `/ticket setup — panel ${c('create-a-ticket')}, log ${c('ticket-logs')}, support ${r('support')}`,
    `/report setchannel ${c('report-a-member')}   ·   /suggestion-set-channel ${c('staff-suggestions')}`,
    `/set-milestones ${c('milestones')}   ·   /set-bot-alerts ${c('bot-logs')}`,
    `/jointocreate setup — category 🔊 VOICE, trigger "➕ Join to Create"`,
    `/serverstats create — members/humans/bots → the 📊 SERVER STATS voice channels`,
    `/raidshield — quarantine role ${r('quarantine')}, channel ${c('quarantine')}`,
  ];
  if (scope === 'core-ai' || scope === 'full') {
    results.wiring.push(
      `/set-ai-telemetry set — bot-logs ${c('bot-logs')}, prompt-workbench ${c('prompt-workbench')}, jailbreak-stress-test ${c('jailbreak-stress-test')}, announcements ${c('ai-announcements')}, benchmark-suite ${c('benchmark-suite')}, negative-feedback ${c('negative-feedback')}`,
    );
  }
  if (scope === 'full') {
    results.wiring.push(
      `/football & /laliga-standings — schedule ${c('match-schedule')}, standings ${c('laliga-standings')}`,
    );
  }

  logger.info(`[serverBuilder] Built guild ${guild.id} scope=${scope}`, {
    roles: results.rolesCreated.length,
    categories: results.categoriesCreated.length,
    channels: results.channelsCreated.length,
    errors: results.errors.length,
  });

  return results;
}
