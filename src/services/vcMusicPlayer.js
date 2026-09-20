import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus
} from '@discordjs/voice';
import { Innertube, UniversalCache } from 'youtubei.js';
import { Readable } from 'node:stream';
import { logger } from '../utils/logger.js';
import { getPlaylistTracks } from './spotifyService.js';

const TRACK_START_TIMEOUT_MS = 15_000;
const TRACK_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

// guildId -> { stopRequested, player, connection, loop, totalLoops, currentStream }
const activeSessions = new Map();

let innertubePromise = null;
function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true });
  }
  return innertubePromise;
}

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
  session.currentStream?.destroy?.();
  session.player.stop(true);
  return true;
}

async function findVideoId(yt, query) {
  const search = await yt.search(query);
  const videoResult = search.results?.find(r => r.type === 'Video');
  return videoResult?.video_id || null;
}

async function playTrack(session, yt, track) {
  const query = `${track.name} ${track.artists.join(' ')}`.trim();
  let nodeStream = null;

  try {
    const videoId = await findVideoId(yt, query);
    if (!videoId) {
      logger.debug(`[VC Music] No YouTube match for "${query}", skipping.`);
      return;
    }

    // Opus is virtually always available for standard YouTube videos, and
    // @discordjs/voice can play it directly with no transcoding step needed. Found live
    // (2026-09-20) that this "virtually always" doesn't hold for every video — real tracks
    // ("Ramenez la coupe à la maison" - Vegedream, "Bad boy" - Marwa Loud) were getting skipped
    // entirely with "No matching formats found" because requesting Opus specifically excludes any
    // video whose available formats don't happen to include an Opus-encoded audio stream (real
    // and not that rare — depends on how/when a given video was transcoded on YouTube's side, not
    // predictable up front). There was no fallback at all: one missing codec meant the whole track
    // got skipped rather than trying anything else. Now retries with no codec constraint (accepts
    // whatever audio format IS actually available) before giving up — createAudioResource() below
    // was already called with no explicit inputType, so it already lets @discordjs/voice infer/
    // transcode as needed either way; this fallback costs nothing extra when Opus IS available
    // (first attempt succeeds and the fallback branch never runs) and only pays for itself on the
    // videos that were previously failing outright.
    let webStream;
    try {
      webStream = await yt.download(videoId, { type: 'audio', quality: 'best', codec: 'opus' });
    } catch (opusErr) {
      logger.debug(`[VC Music] Opus format unavailable for "${query}" (${opusErr.message}), retrying with any available audio format.`);
      webStream = await yt.download(videoId, { type: 'audio', quality: 'best' });
    }
    nodeStream = Readable.fromWeb(webStream);
    session.currentStream = nodeStream;

    const resource = createAudioResource(nodeStream);
    session.player.play(resource);

    try {
      await entersState(session.player, AudioPlayerStatus.Playing, TRACK_START_TIMEOUT_MS);
    } catch {
      throw new Error(`track failed to start within ${TRACK_START_TIMEOUT_MS / 1000}s`);
    }

    await entersState(session.player, AudioPlayerStatus.Idle, TRACK_WAIT_TIMEOUT_MS);
  } catch (err) {
    logger.warn(`[VC Music] Skipping track "${query}": ${err.message}`);
  } finally {
    session.player.stop(true);
    nodeStream?.destroy?.();
    session.currentStream = null;
  }
}

/**
 * Joins a voice channel and plays a Spotify playlist (via matching YouTube audio,
 * searched and streamed with the pure-JS youtubei.js client) in order, looping it
 * `loopCount` times before disconnecting cleanly.
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

  let yt;
  try {
    yt = await getInnertube();
  } catch (err) {
    logger.error(`[VC Music] Failed to initialize YouTube client for guild ${guildId}: ${err.message}`);
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

  const session = {
    stopRequested: false,
    player,
    connection,
    loop: 1,
    totalLoops: loopCount,
    currentStream: null
  };
  activeSessions.set(guildId, session);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    outer:
    for (let loop = 1; loop <= loopCount; loop++) {
      session.loop = loop;
      logger.info(`[VC Music] Guild ${guildId}: starting playlist loop ${loop}/${loopCount}`);
      for (const track of tracks) {
        if (session.stopRequested) break outer;
        await playTrack(session, yt, track);
        if (session.stopRequested) break outer;
      }
    }
  } catch (err) {
    logger.error(`[VC Music] Playback session error in guild ${guildId}: ${err.message}`);
  } finally {
    session.currentStream?.destroy?.();
    player.stop(true);
    connection.destroy();
    activeSessions.delete(guildId);
    logger.info(`[VC Music] Guild ${guildId}: playlist session ended, disconnected from voice.`);
  }
}
