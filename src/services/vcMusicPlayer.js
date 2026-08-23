import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus
} from '@discordjs/voice';
import play from 'play-dl';
import { logger } from '../utils/logger.js';
import { getPlaylistTracks } from './spotifyService.js';

const TRACK_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

// guildId -> { stopRequested, player, connection, loop, totalLoops }
const activeSessions = new Map();

export function isPlaybackActive(guildId) {
  return activeSessions.has(guildId);
}

export function getPlaybackStatus(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return null;
  return { loop: session.loop, totalLoops: session.totalLoops };
}

/**
 * Requests an immediate, clean stop of any playlist playback in a guild.
 * Interrupts the current track right away instead of waiting for it to finish.
 */
export function stopPlaylistPlayback(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return false;
  session.stopRequested = true;
  session.player.stop(true);
  return true;
}

async function playTrack(player, track) {
  const query = `${track.name} ${track.artists.join(' ')}`.trim();
  try {
    const searchResults = await play.search(query, { limit: 1, source: { youtube: 'video' } });
    const match = searchResults?.[0];
    if (!match) {
      logger.debug(`[VC Music] No YouTube match for "${query}", skipping.`);
      return;
    }

    const streamInfo = await play.stream(match.url);
    const resource = createAudioResource(streamInfo.stream, { inputType: streamInfo.type });
    player.play(resource);

    await entersState(player, AudioPlayerStatus.Playing, 5_000).catch(() => {});
    await entersState(player, AudioPlayerStatus.Idle, TRACK_WAIT_TIMEOUT_MS);
  } catch (err) {
    logger.warn(`[VC Music] Skipping track "${query}": ${err.message}`);
    player.stop(true);
  }
}

/**
 * Joins a voice channel and plays a Spotify playlist (via matching YouTube audio)
 * in order, looping it `loopCount` times before disconnecting cleanly.
 */
export async function startPlaylistPlayback({ guild, voiceChannel, playlistUrl, loopCount = 3 }) {
  const guildId = guild.id;
  if (activeSessions.has(guildId)) {
    logger.debug(`[VC Music] Playback already active in guild ${guildId}, ignoring duplicate start.`);
    return;
  }

  let tracks;
  try {
    tracks = await getPlaylistTracks(playlistUrl);
  } catch (err) {
    logger.error(`[VC Music] Failed to fetch Spotify playlist for guild ${guildId}: ${err.message}`);
    return;
  }

  if (!tracks || tracks.length === 0) {
    logger.warn(`[VC Music] Playlist returned no tracks for guild ${guildId}`);
    return;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  const player = createAudioPlayer();
  connection.subscribe(player);

  const session = { stopRequested: false, player, connection, loop: 1, totalLoops: loopCount };
  activeSessions.set(guildId, session);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    outer:
    for (let loop = 1; loop <= loopCount; loop++) {
      session.loop = loop;
      logger.info(`[VC Music] Guild ${guildId}: starting playlist loop ${loop}/${loopCount}`);
      for (const track of tracks) {
        if (session.stopRequested) break outer;
        await playTrack(player, track);
        if (session.stopRequested) break outer;
      }
    }
  } catch (err) {
    logger.error(`[VC Music] Playback session error in guild ${guildId}: ${err.message}`);
  } finally {
    player.stop(true);
    connection.destroy();
    activeSessions.delete(guildId);
    logger.info(`[VC Music] Guild ${guildId}: playlist session ended, disconnected from voice.`);
  }
}
