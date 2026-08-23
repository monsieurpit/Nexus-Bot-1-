import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType
} from '@discordjs/voice';
import youtubedl from 'youtube-dl-exec';
import prism from 'prism-media';
import { logger } from '../utils/logger.js';
import { getPlaylistTracks } from './spotifyService.js';

const TRACK_START_TIMEOUT_MS = 15_000;
const TRACK_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

const YTDLP_FLAGS = {
  noWarnings: true,
  noCheckCertificates: true,
  preferFreeFormats: true,
  format: 'bestaudio/best',
  noPlaylist: true,
  quiet: true,
  output: '-'
};

// guildId -> { stopRequested, player, connection, loop, totalLoops, ytdlpProcess, currentStream }
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
  session.ytdlpProcess?.kill?.('SIGKILL');
  session.currentStream?.destroy?.();
  session.player.stop(true);
  return true;
}

function createTrackResource(query) {
  const subprocess = youtubedl.exec(`ytsearch1:${query}`, YTDLP_FLAGS);
  subprocess.catch(() => {}); // yt-dlp exits non-zero when we SIGKILL it early; don't crash on that
  subprocess.stderr?.resume(); // drain yt-dlp's stderr so it never blocks on a full pipe buffer

  const transcoder = new prism.FFmpeg({
    args: ['-analyzeduration', '0', '-loglevel', '0', '-f', 's16le', '-ar', '48000', '-ac', '2']
  });

  const pcmStream = subprocess.stdout.pipe(transcoder);
  const resource = createAudioResource(pcmStream, { inputType: StreamType.Raw });

  return { resource, subprocess, pcmStream };
}

async function playTrack(session, track) {
  const query = `${track.name} ${track.artists.join(' ')}`.trim();
  let subprocess = null;
  let pcmStream = null;

  try {
    const created = createTrackResource(query);
    subprocess = created.subprocess;
    pcmStream = created.pcmStream;
    session.ytdlpProcess = subprocess;
    session.currentStream = pcmStream;

    session.player.play(created.resource);

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
    subprocess?.kill?.('SIGKILL');
    pcmStream?.destroy?.();
    session.ytdlpProcess = null;
    session.currentStream = null;
  }
}

/**
 * Joins a voice channel and plays a Spotify playlist (via matching YouTube audio,
 * extracted with yt-dlp and transcoded through ffmpeg) in order, looping it
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
    ytdlpProcess: null,
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
        await playTrack(session, track);
        if (session.stopRequested) break outer;
      }
    }
  } catch (err) {
    logger.error(`[VC Music] Playback session error in guild ${guildId}: ${err.message}`);
  } finally {
    session.ytdlpProcess?.kill?.('SIGKILL');
    session.currentStream?.destroy?.();
    player.stop(true);
    connection.destroy();
    activeSessions.delete(guildId);
    logger.info(`[VC Music] Guild ${guildId}: playlist session ended, disconnected from voice.`);
  }
}
