import { initializeApp, getApps } from 'firebase/app';
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    deleteDoc,
    collection,
    getDocs,
    getDocFromServer,
    setLogLevel,
    increment as fsIncrement
} from 'firebase/firestore';
import { createRequire } from 'module';
import { logger } from './logger.js';

setLogLevel('error');

const require = createRequire(import.meta.url);
const firebaseConfig = require('../../firebase-applet-config.json');

/**
 * Robust sanitizer for Firestore documents to prevent invalid data errors
 * Supports BigInt, Date, Map, Set, circular structures, undefined, and nested objects.
 */
export function sanitizeForFirestore(obj, seen = new WeakSet()) {
    if (obj === undefined) return null;
    if (typeof obj === 'function' || typeof obj === 'symbol') return null;
    if (typeof obj === 'bigint') return obj.toString();
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return obj.toISOString();

    if (obj instanceof Set) {
        return Array.from(obj).map(item => sanitizeForFirestore(item, seen));
    }

    if (obj instanceof Map) {
        const cleanMap = {};
        for (const [k, v] of obj.entries()) {
            if (v !== undefined) {
                const safeKey = String(k) || '_empty_key';
                cleanMap[safeKey] = sanitizeForFirestore(v, seen);
            }
        }
        return cleanMap;
    }

    if (seen.has(obj)) {
        return '[Circular]';
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
        return obj.map(item => item === undefined ? null : sanitizeForFirestore(item, seen));
    }

    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
            const safeKey = k || '_empty_key';
            clean[safeKey] = sanitizeForFirestore(v, seen);
        }
    }
    return clean;
}

class FirestoreDatabase {
    constructor() {
        this.app = null;
        this.db = null;
        this.connected = false;
        this.databaseId = firebaseConfig.firestoreDatabaseId;
    }

    async connect() {
        try {
            if (!this.app) {
                if (getApps().length === 0) {
                    this.app = initializeApp(firebaseConfig);
                } else {
                    this.app = getApps()[0];
                }
            }

            // Connect to specified database instance if available, fallback to default
            if (this.databaseId && this.databaseId !== '(default)') {
                try {
                    this.db = getFirestore(this.app, this.databaseId);
                } catch {
                    this.db = getFirestore(this.app);
                }
            } else {
                this.db = getFirestore(this.app);
            }

            this.connected = true;

            // Validate read/write permissions from server to prevent false-positive connections
            try {
                await getDocFromServer(doc(this.db, 'system', 'status'));
            } catch (permErr) {
                if (permErr?.message?.includes('permission') || permErr?.code === 'permission-denied') {
                    logger.warn('Firebase Firestore lacks permission or has restrictive security rules. Disabling Firestore.');
                    this.connected = false;
                    this.db = null;
                    return false;
                }
            }

            // Write initial status document so kv_data collection is initialized
            await this.set('system:status', {
                status: 'online',
                bot: 'Nexus',
                connectedAt: new Date().toISOString()
            }).catch(err => {
                logger.warn('Could not write initial system status:', err.message);
            });

            // Automatically synchronize and populate dedicated tables/collections
            await this.syncGuildFeatureTables().catch(err => {
                logger.warn('Initial syncGuildFeatureTables non-fatal error:', err.message);
            });

            logger.info(`✅ Firebase Firestore Database connected (${this.databaseId || 'default'})`);
            return true;
        } catch (error) {
            logger.error('Firebase Firestore connection failed:', error);
            this.connected = false;
            return false;
        }
    }

    async syncGuildFeatureTables() {
        if (!this.db) return;
        try {
            const guildsSnapshot = await getDocs(collection(this.db, 'guilds')).catch(() => null);
            const kvSnapshot = await getDocs(collection(this.db, 'kv_data')).catch(() => null);

            const discoveredGuildIds = new Set();
            if (guildsSnapshot && !guildsSnapshot.empty) {
                for (const d of guildsSnapshot.docs) discoveredGuildIds.add(d.id);
            }

            // 1. Process and migrate any relevant kv_data records to their dedicated collections
            if (kvSnapshot && !kvSnapshot.empty) {
                for (const kvDoc of kvSnapshot.docs) {
                    const rawKey = this.decodeKey(kvDoc.id);
                    const kvVal = kvDoc.data()?.value;
                    if (!rawKey) continue;

                    const parts = rawKey.split(':');
                    if (parts[0] === 'guild' && parts[1]) {
                        discoveredGuildIds.add(parts[1]);
                    } else if (parts[0] === 'economy' && parts[1]) {
                        discoveredGuildIds.add(parts[1]);
                    }

                    const targetRef = this.getDocRef(rawKey);
                    if (targetRef && targetRef.path !== kvDoc.ref.path) {
                        await setDoc(targetRef, sanitizeForFirestore({
                            key: rawKey,
                            value: kvVal,
                            migratedAt: new Date().toISOString()
                        }), { merge: true }).catch(() => null);
                    }
                }
            }

            // 2. Synchronize all requested standalone feature tables for all active guilds
            for (const guildId of discoveredGuildIds) {
                let config = {};
                if (guildsSnapshot) {
                    const guildDoc = guildsSnapshot.docs.find(d => d.id === guildId);
                    if (guildDoc) {
                        const data = guildDoc.data();
                        config = data?.value || data || {};
                    }
                }

                // A. Embeds System (/embeds)
                if (config.embeds && typeof config.embeds === 'object') {
                    for (const [embedId, embedData] of Object.entries(config.embeds)) {
                        await setDoc(doc(this.db, 'embeds', `${guildId}_${embedId}`), sanitizeForFirestore({
                            key: `guild:${guildId}:embeds:${embedId}`,
                            value: embedData,
                            guildId,
                            embedId,
                            updatedAt: new Date().toISOString()
                        }), { merge: true }).catch(() => null);
                    }
                }

                // B. Football System (/football_configs, /football)
                await setDoc(doc(this.db, 'football_configs', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:football:config`,
                    value: config.football || { enabled: false },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // C. Giveaway System (/giveaways)
                await setDoc(doc(this.db, 'giveaways', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:giveaways`,
                    value: config.giveaways || [],
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // D. Economy System (/economy_configs, /economy_shops, /economy_participants)
                await setDoc(doc(this.db, 'economy_configs', guildId), sanitizeForFirestore({
                    key: `economy:${guildId}:config`,
                    value: config.economy || { currencySymbol: '🪙', startingBalance: 100 },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                await setDoc(doc(this.db, 'economy_shops', guildId), sanitizeForFirestore({
                    key: `economy:${guildId}:shop`,
                    value: config.economyShop || [],
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                await setDoc(doc(this.db, 'economy_participants', guildId), sanitizeForFirestore({
                    key: `economy:${guildId}:participants`,
                    value: config.economyParticipants || [],
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // E. Raidshield System & Reports (/raidshield_configs, /reports)
                await setDoc(doc(this.db, 'raidshield_configs', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:raidshield:config`,
                    value: config.raidShield || { enabled: false },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                await setDoc(doc(this.db, 'reports', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:reports`,
                    value: config.reports || { enabled: false },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // F. Server Save System with Save IDs (/server_saves)
                await setDoc(doc(this.db, 'server_saves', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:server_backup:saves`,
                    value: config.serverSaves || [],
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // G. Server Stats System (/serverstats_configs, /serverstats_counters)
                await setDoc(doc(this.db, 'serverstats_configs', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:serverstats:config`,
                    value: config.serverStats || config.counters || { enabled: false },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                await setDoc(doc(this.db, 'serverstats_counters', guildId), sanitizeForFirestore({
                    key: `counters:${guildId}`,
                    value: config.counters || {},
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // H. Sticky Notes System (/sticky_notes)
                await setDoc(doc(this.db, 'sticky_notes', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:stickynotes`,
                    value: config.stickyNotes || {},
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // I. Weekly Summary System with 3 Last Weekly Summaries History (/weekly_stats, /weekly_stats_history)
                await setDoc(doc(this.db, 'weekly_stats', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:weekly_stats`,
                    value: config.weeklyStats || { joins: 0, leaves: 0, messagesSent: 0, moderations: 0, ticketsOpened: 0, ticketsClosed: 0 },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                await setDoc(doc(this.db, 'weekly_stats_history', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:weekly_summary:history`,
                    value: config.weeklyHistory || [],
                    guildId,
                    maxHistory: 3,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);

                // J. Ticket System (/ticket_configs)
                await setDoc(doc(this.db, 'ticket_configs', guildId), sanitizeForFirestore({
                    key: `guild:${guildId}:ticket:config`,
                    value: config.tickets || { enabled: false },
                    guildId,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);
            }

            logger.info(`✅ Synchronized dedicated tables for ${discoveredGuildIds.size} guild(s)`);
        } catch (err) {
            logger.warn('Guild feature tables sync warning:', err.message);
        }
    }

    isAvailable() {
        return this.connected && this.db !== null;
    }

    encodeKey(key) {
        if (!key || typeof key !== 'string') return 'unknown_key';
        return encodeURIComponent(key).replace(/\./g, '%2E');
    }

    decodeKey(safeKey) {
        if (!safeKey || typeof safeKey !== 'string') return '';
        try {
            return decodeURIComponent(safeKey);
        } catch {
            return safeKey;
        }
    }

    getDocRef(key) {
        if (!this.db || !key || typeof key !== 'string') return null;

        const parts = key.split(':');

        if (parts[0] === 'guild' && parts[1]) {
            const guildId = parts[1];
            
            // Core Configs
            if (parts[2] === 'config' || !parts[2]) return doc(this.db, 'guilds', guildId);
            if (parts[2] === 'welcome') return doc(this.db, 'welcome', guildId);
            
            // Leveling
            if (parts[2] === 'leveling') {
                if (parts[3] === 'config' || !parts[3]) return doc(this.db, 'leveling_configs', guildId);
                if (parts[3] === 'users' && parts[4]) return doc(this.db, 'leveling', `${guildId}_${parts[4]}`);
                return doc(this.db, 'leveling_configs', guildId);
            }
            
            // Tickets
            if (parts[2] === 'tickets') return doc(this.db, 'ticket_configs', guildId);
            if (parts[2] === 'ticket') {
                if (parts[3] === 'config' || !parts[3]) return doc(this.db, 'ticket_configs', guildId);
                if (parts[3] === 'counter') return doc(this.db, 'ticket_counters', guildId);
                if (parts[3]) return doc(this.db, 'tickets', `${guildId}_${parts[3]}`); // Format: guildId_channelId
            }
            
            // Modlogs & Warnings
            if (parts[2] === 'warnings' && parts[3]) return doc(this.db, 'moderation', `${guildId}_${parts[3]}`);
            if (parts[2] === 'modlog') {
                if (parts[3] === 'settings' || !parts[3]) return doc(this.db, 'modlog_settings', guildId);
                if (parts[3] === 'cases' && parts[4]) return doc(this.db, 'modlogs', `${guildId}_${parts[4]}`);
                if (parts[3] === 'users' && parts[4]) return doc(this.db, 'modlog_users', `${guildId}_${parts[4]}`);
            }
            
            // Applications
            if (parts[2] === 'applications') {
                if (parts[3] === 'roles') return doc(this.db, 'app_roles', guildId);
                if (parts[3] === 'settings' || !parts[3]) return doc(this.db, 'app_settings', guildId);
                if (parts[3] === 'users' && parts[4]) return doc(this.db, 'app_users', `${guildId}_${parts[4]}`);
                if (parts[3] && !parts[4]) return doc(this.db, 'applications', `${guildId}_${parts[3]}`);
                return doc(this.db, 'app_settings', guildId);
            }
            
            // Join to Create
            if (parts[2] === 'jointocreate') {
                if (parts[3] === 'channels') return doc(this.db, 'jointocreate_channels', guildId);
                return doc(this.db, 'jointocreate_configs', guildId);
            }
            
            // AFK & Invites
            if (parts[2] === 'afk' && parts[3]) return doc(this.db, 'afk', `${guildId}_${parts[3]}`);
            if (parts[2] === 'invites') {
                if (!parts[3]) return doc(this.db, 'invite_tracking', guildId);
                if (parts[3]) return doc(this.db, 'member_invites', `${guildId}_${parts[3]}`);
            }
            if (parts[2] === 'invite_uses' && parts[3]) return doc(this.db, 'invite_uses', `${guildId}_${parts[3]}`);
            if (parts[2] === 'fake_account' && parts[3]) return doc(this.db, 'fake_accounts', `${guildId}_${parts[3]}`);

            // Embeds System
            if (parts[2] === 'embeds' && parts[3]) return doc(this.db, 'embeds', `${guildId}_${parts[3]}`);
            if (parts[2] === 'embedbutton' && parts[3]) return doc(this.db, 'embed_buttons', `${guildId}_${parts[3]}`);

            // Football System
            if (parts[2] === 'football') return doc(this.db, 'football_configs', guildId);

            // Giveaway System
            if (parts[2] === 'giveaways') return doc(this.db, 'giveaways', guildId);
            if (parts[2] === 'giveaway' && parts[3]) return doc(this.db, 'giveaways', `${guildId}_${parts[3]}`);

            // Raidshield & Reports System
            if (parts[2] === 'raidshield') return doc(this.db, 'raidshield_configs', guildId);
            if (parts[2] === 'reports') {
                if (parts[3]) return doc(this.db, 'reports', `${guildId}_${parts[3]}`);
                return doc(this.db, 'reports', guildId);
            }

            // Server Backup & Save System (Indexed with 6-char Save ID)
            if (parts[2] === 'server_backup') {
                if (parts[3] === 'saves') return doc(this.db, 'server_saves', guildId);
                if (parts[3] === 'save' && parts[4]) return doc(this.db, 'server_save_snapshots', `${guildId}_${parts[4]}`);
            }
            if (parts[2] === 'autosave') {
                return doc(this.db, 'autosave_configs', guildId);
            }

            // Verification System
            if (parts[2] === 'verification') {
                return doc(this.db, 'verification_configs', guildId);
            }

            // Logging System
            if (parts[2] === 'logging') {
                return doc(this.db, 'logging_configs', guildId);
            }

            // Server Stats System
            if (parts[2] === 'serverstats' || parts[2] === 'counters') {
                if (parts[3] === 'config') return doc(this.db, 'serverstats_configs', guildId);
                if (parts[3] === 'cache') return doc(this.db, 'serverstats_cache', guildId);
                if (parts[3] === 'counters') return doc(this.db, 'serverstats_counters', guildId);
                return doc(this.db, 'serverstats_counters', guildId);
            }

            // Sticky Notes System
            if (parts[2] === 'stickynote' && parts[3]) return doc(this.db, 'sticky_notes', `${guildId}_${parts[3]}`);
            if (parts[2] === 'stickynotes') return doc(this.db, 'sticky_notes', guildId);

            // Weekly Summary System (Saves 3 last weekly summaries)
            if (parts[2] === 'weekly_stats') return doc(this.db, 'weekly_stats', guildId);
            if (parts[2] === 'prev_weekly_stats') return doc(this.db, 'weekly_stats_history', `${guildId}_prev`);
            if (parts[2] === 'weekly_summary') {
                if (parts[3] === 'history' || parts[3] === 'summaries') return doc(this.db, 'weekly_stats_history', guildId);
                return doc(this.db, 'weekly_stats', guildId);
            }

            // Reaction Roles
            if (parts[2] === 'reaction_roles' && parts[3]) return doc(this.db, 'reaction_roles', `${guildId}_${parts[3]}`);
        }

        // Global Scoped Modules

        // Economy System
        if (parts[0] === 'economy' && parts[1]) {
            const guildId = parts[1];
            if (parts[2] === 'config' || !parts[2]) return doc(this.db, 'economy_configs', guildId);
            if (parts[2] === 'user' && parts[3]) return doc(this.db, 'economy_balances', `${guildId}_${parts[3]}`);
            if (parts[2] === 'inventory' && parts[3]) return doc(this.db, 'economy_inventories', `${guildId}_${parts[3]}`);
            if (parts[2] === 'participants') return doc(this.db, 'economy_participants', guildId);
            if (parts[2] === 'shop') return doc(this.db, 'economy_shops', guildId);
            return doc(this.db, 'economy_configs', guildId);
        }

        // Server Stats Counters & Configs
        if (parts[0] === 'counters' && parts[1]) return doc(this.db, 'serverstats_counters', parts[1]);
        if (parts[0] === 'serverstats' && parts[1]) {
            if (parts[2] === 'counters') return doc(this.db, 'serverstats_counters', parts[1]);
            return doc(this.db, 'serverstats_configs', parts[1]);
        }

        // Leveling
        if (parts[0] === 'leveling' && parts[1]) {
            if (parts[2] === 'config' || !parts[2]) return doc(this.db, 'leveling_configs', parts[1]);
            return doc(this.db, 'leveling', `${parts[1]}_${parts[2]}`);
        }

        // Tickets
        if (parts[0] === 'ticket' && parts[1] && parts[2]) return doc(this.db, 'tickets', `${parts[1]}_${parts[2]}`);
        if (parts[0] === 'tickets' && parts[1]) return doc(this.db, 'ticket_configs', parts[1]);

        // Sticky notes
        if (parts[0] === 'stickynote' && parts[1] && parts[2]) return doc(this.db, 'sticky_notes', `${parts[1]}_${parts[2]}`);

        // Verification
        if (parts[0] === 'verification') {
            if (parts[1] === 'audit' && parts[2]) return doc(this.db, 'verification_audit', parts[2]);
            if (parts[1]) return doc(this.db, 'verification_configs', parts[1]);
        }

        // Raidshield Quarantine & Reports
        if (parts[0] === 'quarantine' && parts[1]) return doc(this.db, 'quarantines', parts[1]);
        if (parts[0] === 'quarantines' && parts[1]) return doc(this.db, 'quarantines', parts[1]);
        if (parts[0] === 'report' && parts[1]) {
            if (parts[2]) return doc(this.db, 'reports', `${parts[1]}_${parts[2]}`);
            return doc(this.db, 'reports', parts[1]);
        }
        if (parts[0] === 'reports' && parts[1]) return doc(this.db, 'reports', parts[1]);

        // Football Fixtures & Live
        if (parts[0] === 'football') {
            if (parts[1]) return doc(this.db, 'football', parts[1]);
            return doc(this.db, 'football', 'general');
        }

        // Giveaways
        if (parts[0] === 'giveaways' && parts[1]) return doc(this.db, 'giveaways', parts[1]);
        if (parts[0] === 'giveaway' && parts[1]) return doc(this.db, 'giveaways', parts[1]);

        // Server Save Snapshots
        if (parts[0] === 'server_save' && parts[1] && parts[2]) return doc(this.db, 'server_save_snapshots', `${parts[1]}_${parts[2]}`);

        // Reaction Roles & Moderation
        if (parts[0] === 'reaction_roles' && parts[1] && parts[2]) return doc(this.db, 'reaction_roles', `${parts[1]}_${parts[2]}`);
        if (parts[0] === 'moderation' && parts[2]) return doc(this.db, 'moderation', `${parts[2]}_${parts[3] || 'general'}`);

        const safeKey = this.encodeKey(key);
        return doc(this.db, 'kv_data', safeKey);
    }

    getKvDocRef(key) {
        if (!this.db || !key || typeof key !== 'string') return null;
        const safeKey = this.encodeKey(key);
        return doc(this.db, 'kv_data', safeKey);
    }

    getLegacyDocRef(key) {
        if (!this.db || !key || typeof key !== 'string') return null;
        const parts = key.split(':');
        if (parts[0] === 'guild' && parts[1]) {
            const guildId = parts[1];
            if (parts[2] === 'config') {
                return doc(this.db, 'guilds', guildId);
            }
            if (parts[2] === 'leveling' && parts[3] === 'users' && parts[4]) {
                return doc(this.db, 'guilds', guildId, 'user_levels', parts[4]);
            }
            if (parts[2] === 'ticket' && parts[3]) {
                return doc(this.db, 'guilds', guildId, 'tickets', parts[3]);
            }
            if (parts[2] === 'afk' && parts[3]) {
                return doc(this.db, 'guilds', guildId, 'afk', parts[3]);
            }
        }
        return null;
    }

    async get(key, defaultValue = null) {
        if (!this.isAvailable() || !key) return defaultValue;
        try {
            const docRef = this.getDocRef(key);
            if (docRef) {
                const snapshot = await getDoc(docRef);
                if (snapshot.exists()) {
                    const data = snapshot.data();
                    if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
                        await this.delete(key).catch(() => null);
                        return defaultValue;
                    }
                    if (data && 'value' in data) {
                        return data.value;
                    }
                    return data;
                }
            }

            // Fallback check kv_data location if not found in dedicated collection
            const kvRef = this.getKvDocRef(key);
            if (kvRef && (!docRef || kvRef.path !== docRef.path)) {
                const kvSnap = await getDoc(kvRef);
                if (kvSnap.exists()) {
                    const kvData = kvSnap.data();
                    if (kvData.expiresAt && new Date(kvData.expiresAt) < new Date()) {
                        await this.delete(key).catch(() => null);
                        return defaultValue;
                    }
                    if (kvData && 'value' in kvData) {
                        return kvData.value;
                    }
                    return kvData;
                }
            }

            // Fallback check inside main guilds doc if this is a guild sub-feature
            const parts = key.split(':');
            let guildId = null;
            if (parts[0] === 'guild' && parts[1]) guildId = parts[1];
            else if ((parts[0] === 'counters' || parts[0] === 'serverstats' || parts[0] === 'tickets' || parts[0] === 'giveaways' || parts[0] === 'economy') && parts[1]) guildId = parts[1];

            if (guildId) {
                const guildSnap = await getDoc(doc(this.db, 'guilds', guildId)).catch(() => null);
                if (guildSnap && guildSnap.exists()) {
                    const gData = guildSnap.data();
                    const gVal = (gData && 'value' in gData && typeof gData.value === 'object' && gData.value !== null) ? gData.value : gData;
                    if (gVal) {
                        if (key.includes('counters') || key.includes('serverstats')) {
                            if (gVal.counters) return gVal.counters;
                            if (gVal.serverStats) return gVal.serverStats;
                        }
                        if (key.includes('welcome') && gVal.welcome) return gVal.welcome;
                        if (key.includes('leveling') && gVal.leveling) return gVal.leveling;
                        if (key.includes('ticket') && gVal.tickets) return gVal.tickets;
                        if (key.includes('raidshield') && gVal.raidShield) return gVal.raidShield;
                        if (key.includes('football') && gVal.football) return gVal.football;
                        if (key.includes('autosave') && gVal.autoSave) return gVal.autoSave;
                        if (key.includes('verification') && gVal.verification) return gVal.verification;
                    }
                }
            }

            // Check legacy document location if not found in primary
            const legacyRef = this.getLegacyDocRef(key);
            if (legacyRef) {
                const legacySnap = await getDoc(legacyRef);
                if (legacySnap.exists()) {
                    const legData = legacySnap.data();
                    if (legData && 'value' in legData) {
                        return legData.value;
                    }
                    return legData;
                }
            }

            return defaultValue;
        } catch (error) {
            logger.error(`Firestore get error for key ${key}:`, error);
            return defaultValue;
        }
    }

    async set(key, value, ttl = null) {
        if (!this.isAvailable() || !key) return false;
        try {
            const docRef = this.getDocRef(key);
            if (!docRef) return false;

            const payload = {
                key,
                value,
                updatedAt: new Date().toISOString()
            };

            if (ttl && typeof ttl === 'number' && ttl > 0) {
                payload.expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
            }

            const cleanPayload = sanitizeForFirestore(payload);
            await setDoc(docRef, cleanPayload, { merge: true });

            // If updating guild config, also write to dedicated collections
            const parts = key.split(':');
            if (parts[0] === 'guild' && parts[1] && (parts[2] === 'config' || !parts[2]) && value && typeof value === 'object') {
                const guildId = parts[1];
                if (value.raidShield) {
                    await setDoc(doc(this.db, 'raidshield_configs', guildId), sanitizeForFirestore({
                        key: `guild:${guildId}:raidshield:config`,
                        value: value.raidShield,
                        guildId,
                        updatedAt: new Date().toISOString()
                    }), { merge: true }).catch(() => null);
                }
                if (value.football) {
                    await setDoc(doc(this.db, 'football_configs', guildId), sanitizeForFirestore({
                        key: `guild:${guildId}:football:config`,
                        value: value.football,
                        guildId,
                        updatedAt: new Date().toISOString()
                    }), { merge: true }).catch(() => null);
                }
                if (value.tickets) {
                    await setDoc(doc(this.db, 'ticket_configs', guildId), sanitizeForFirestore({
                        key: `guild:${guildId}:ticket:config`,
                        value: value.tickets,
                        guildId,
                        updatedAt: new Date().toISOString()
                    }), { merge: true }).catch(() => null);
                }
                if (value.serverStats || value.counters) {
                    await setDoc(doc(this.db, 'serverstats_configs', guildId), sanitizeForFirestore({
                        key: `guild:${guildId}:serverstats:config`,
                        value: value.serverStats || value.counters,
                        guildId,
                        updatedAt: new Date().toISOString()
                    }), { merge: true }).catch(() => null);
                    await setDoc(doc(this.db, 'serverstats_counters', guildId), sanitizeForFirestore({
                        key: `counters:${guildId}`,
                        value: value.counters || value.serverStats,
                        guildId,
                        updatedAt: new Date().toISOString()
                    }), { merge: true }).catch(() => null);
                }
            }

            // If saving server counters directly, also keep guild doc and secondary doc in sync
            if ((parts[0] === 'counters' && parts[1]) || (parts[0] === 'guild' && parts[1] && (parts[2] === 'serverstats' || parts[2] === 'counters'))) {
                const guildId = parts[1];
                await setDoc(doc(this.db, 'serverstats_counters', guildId), cleanPayload, { merge: true }).catch(() => null);
                await setDoc(doc(this.db, 'guilds', guildId), sanitizeForFirestore({
                    counters: value,
                    updatedAt: new Date().toISOString()
                }), { merge: true }).catch(() => null);
            }

            // Synchronize with kv_data and legacy collection so all views stay updated
            const kvRef = this.getKvDocRef(key);
            if (kvRef && kvRef.path !== docRef.path) {
                await setDoc(kvRef, cleanPayload, { merge: true }).catch(() => null);
            }

            const legacyRef = this.getLegacyDocRef(key);
            if (legacyRef && legacyRef.path !== docRef.path) {
                await setDoc(legacyRef, cleanPayload, { merge: true }).catch(() => null);
            }

            return true;
        } catch (error) {
            logger.error(`Firestore set error for key ${key}:`, error);
            return false;
        }
    }

    async increment(key, amount = 1) {
        if (!this.isAvailable() || !key) return false;
        try {
            const docRef = this.getDocRef(key);
            if (!docRef) return false;

            // This tells Google's servers to mathematically increment, eliminating race conditions.
            const payload = {
                key,
                value: fsIncrement(amount),
                updatedAt: new Date().toISOString()
            };

            await setDoc(docRef, payload, { merge: true });

            // Sync legacy fallbacks (Optional, but safe)
            const kvRef = this.getKvDocRef(key);
            if (kvRef && kvRef.path !== docRef.path) {
                await setDoc(kvRef, payload, { merge: true }).catch(() => null);
            }

            // Since fsIncrement() doesn't immediately return the new number, we fetch the result.
            // (The write itself is atomic, so fetching afterward is perfectly safe).
            const snap = await getDoc(docRef);
            return snap.exists() ? snap.data().value : amount;
        } catch (error) {
            logger.error(`Firestore increment error for key ${key}:`, error);
            return false;
        }
    }

    async decrement(key, amount = 1) {
        return this.increment(key, -amount);
    }

    async delete(key) {
        if (!this.isAvailable() || !key) return false;
        try {
            const docRef = this.getDocRef(key);
            if (docRef) {
                await deleteDoc(docRef);
            }

            const kvRef = this.getKvDocRef(key);
            if (kvRef) {
                await deleteDoc(kvRef).catch(() => null);
            }

            const legacyRef = this.getLegacyDocRef(key);
            if (legacyRef) {
                await deleteDoc(legacyRef).catch(() => null);
            }

            return true;
        } catch (error) {
            logger.error(`Firestore delete error for key ${key}:`, error);
            return false;
        }
    }

    async exists(key) {
        if (!this.isAvailable() || !key) return false;
        try {
            const docRef = this.getDocRef(key);
            if (!docRef) return false;

            const snapshot = await getDoc(docRef);
            if (snapshot.exists()) {
                const data = snapshot.data();
                if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
                    return false;
                }
                return true;
            }

            const legacyRef = this.getLegacyDocRef(key);
            if (legacyRef) {
                const legSnap = await getDoc(legacyRef);
                return legSnap.exists();
            }

            return false;
        } catch (error) {
            logger.error(`Firestore exists error for key ${key}:`, error);
            return false;
        }
    }

    async list(prefix = '') {
        if (!this.isAvailable()) return [];
        try {
            const keys = new Set();
            const now = new Date();

            // 1. Read kv_data
            try {
                const kvSnap = await getDocs(collection(this.db, 'kv_data'));
                kvSnap.forEach((docSnap) => {
                    const data = docSnap.data();
                    if (data.expiresAt && new Date(data.expiresAt) < now) {
                        return; // Skip expired
                    }
                    const key = data.key || this.decodeKey(docSnap.id);
                    if (!prefix || key.startsWith(prefix)) {
                        keys.add(key);
                    }
                });
            } catch (err) {
                logger.debug('Firestore list kv_data error:', err);
            }

            // 2. Check guilds collection
            try {
                const guildsSnap = await getDocs(collection(this.db, 'guilds'));
                guildsSnap.forEach((docSnap) => {
                    const kConfig = `guild:${docSnap.id}:config`;
                    if (!prefix || kConfig.startsWith(prefix)) keys.add(kConfig);
                    const kGuild = `guild:${docSnap.id}`;
                    if (!prefix || kGuild.startsWith(prefix)) keys.add(kGuild);
                });
            } catch {
                // Ignore if collection doesn't exist
            }

            // 3. Check serverstats collections
            if (!prefix || prefix.includes('counter') || prefix.includes('serverstats')) {
                try {
                    const snap = await getDocs(collection(this.db, 'serverstats_counters'));
                    snap.forEach((docSnap) => {
                        const k1 = `counters:${docSnap.id}`;
                        if (!prefix || k1.startsWith(prefix)) keys.add(k1);
                        const k2 = `guild:${docSnap.id}:serverstats:counters`;
                        if (!prefix || k2.startsWith(prefix)) keys.add(k2);
                    });
                } catch {}
                try {
                    const snap = await getDocs(collection(this.db, 'serverstats_configs'));
                    snap.forEach((docSnap) => {
                        const k = `guild:${docSnap.id}:serverstats:config`;
                        if (!prefix || k.startsWith(prefix)) keys.add(k);
                    });
                } catch {}
            }

            // 4. Check sticky_notes collection
            if (!prefix || prefix.includes('sticky')) {
                try {
                    const snap = await getDocs(collection(this.db, 'sticky_notes'));
                    snap.forEach((docSnap) => {
                        const data = docSnap.data();
                        const key = data.key || (docSnap.id.includes('_') ? `guild:${docSnap.id.split('_')[0]}:stickynote:${docSnap.id.split('_')[1]}` : `guild:${docSnap.id}:stickynotes`);
                        if (!prefix || key.startsWith(prefix)) keys.add(key);
                    });
                } catch {}
            }

            // 5. Check server_saves collection
            if (!prefix || prefix.includes('backup') || prefix.includes('save')) {
                try {
                    const snap = await getDocs(collection(this.db, 'server_saves'));
                    snap.forEach((docSnap) => {
                        const k = `guild:${docSnap.id}:server_backup:saves`;
                        if (!prefix || k.startsWith(prefix)) keys.add(k);
                    });
                } catch {}
            }

            // 6. Check giveaways collection
            if (!prefix || prefix.includes('giveaway')) {
                try {
                    const snap = await getDocs(collection(this.db, 'giveaways'));
                    snap.forEach((docSnap) => {
                        const k = `guild:${docSnap.id}:giveaways`;
                        if (!prefix || k.startsWith(prefix)) keys.add(k);
                    });
                } catch {}
            }

            return Array.from(keys);
        } catch (error) {
            logger.error(`Firestore list error for prefix ${prefix}:`, error);
            return [];
        }
    }

    async clear(prefix = '') {
        try {
            const keys = await this.list(prefix);
            for (const key of keys) {
                await this.delete(key);
            }
            return true;
        } catch (error) {
            logger.error('Firestore clear error:', error);
            return false;
        }
    }
}

export const firestoreDb = new FirestoreDatabase();
