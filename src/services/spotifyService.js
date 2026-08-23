import { logger } from '../utils/logger.js';

// Spotify's Web API now requires the developer's own account to have Premium,
// so playlist metadata is instead read from the public, unauthenticated embed
// page (open.spotify.com/embed/playlist/<id>), which needs no credentials at
// all. Actual audio playback is sourced from YouTube by vcMusicPlayer.js using
// this metadata to search for matching tracks, since Spotify never allows a
// bot to stream its DRM-protected audio directly regardless of account tier.

const EMBED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function extractPlaylistId(playlistUrl) {
  const match = String(playlistUrl || '').match(/playlist\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Fetches the ordered track list of a public Spotify playlist.
 * Note: the embed page caps out around 100 tracks for very large playlists.
 * @param {string} playlistUrl
 * @returns {Promise<Array<{ name: string, artists: string[], durationMs: number }>>}
 */
export async function getPlaylistTracks(playlistUrl) {
  const playlistId = extractPlaylistId(playlistUrl);
  if (!playlistId) {
    throw new Error(`Invalid Spotify playlist URL: ${playlistUrl}`);
  }

  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': EMBED_USER_AGENT }
  });
  if (!res.ok) {
    throw new Error(`Spotify playlist page fetch failed: HTTP ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not locate playlist data on the Spotify embed page.');
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`Failed to parse Spotify playlist data: ${err.message}`);
  }

  const entity = data?.props?.pageProps?.state?.data?.entity;
  const trackList = entity?.trackList;
  if (!Array.isArray(trackList) || trackList.length === 0) {
    throw new Error('Spotify playlist has no readable tracks (it may be private or empty).');
  }

  const tracks = trackList
    .filter(track => track && track.title)
    .map(track => ({
      name: track.title,
      artists: track.subtitle ? track.subtitle.split(',').map(a => a.trim()).filter(Boolean) : [],
      durationMs: track.duration || 0
    }));

  logger.info(`[Spotify] Loaded ${tracks.length} tracks from playlist "${entity.name || playlistId}"`);
  return tracks;
}
