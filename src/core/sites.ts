import type { EngineId, Link, LinkKind, SiteId } from './types.ts';

// What OnePlace knows about each site: display name, colour, which engine to try first,
// where to log in, and an honest support status for the "Supported sites" page.

export type SupportStatus = 'works' | 'login' | 'best';

export interface SiteInfo {
  id: SiteId;
  name: string;
  /** Avatar colour (we never show other companies' logos). */
  color: string;
  /** Opened from the Home shortcuts. */
  home?: string;
  /** Login page for in-app login (cookies for stories, private and age-restricted posts). */
  login?: string;
  /** Pages whose cookies belong to this site's login. */
  cookieUrls?: string[];
  status: SupportStatus;
  /** What can be downloaded, shown on the Supported sites page. */
  what: string;
}

const VIDEO_FIRST: EngineId[] = ['ytdlp', 'gallerydl'];
const PHOTO_FIRST: EngineId[] = ['gallerydl', 'ytdlp'];

export const SITES: Record<SiteId, SiteInfo> = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    color: '#E62117',
    home: 'https://m.youtube.com/',
    login: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F',
    cookieUrls: ['https://www.youtube.com', 'https://m.youtube.com', 'https://accounts.google.com', 'https://www.google.com'],
    status: 'works',
    what: 'Videos, Shorts, live, playlists, channels, thumbnails',
  },
  ytmusic: {
    id: 'ytmusic',
    name: 'YouTube Music',
    color: '#C4302B',
    home: 'https://music.youtube.com/',
    login: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
    cookieUrls: ['https://music.youtube.com', 'https://www.youtube.com', 'https://accounts.google.com'],
    status: 'works',
    what: 'Songs, albums, playlists with tags and cover art',
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    color: '#D62976',
    home: 'https://www.instagram.com/',
    login: 'https://www.instagram.com/accounts/login/',
    cookieUrls: ['https://www.instagram.com'],
    status: 'login',
    what: 'Reels, photos, carousels, reel audio; stories and highlights need login',
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    color: '#1877F2',
    home: 'https://m.facebook.com/watch/',
    login: 'https://m.facebook.com/login/',
    cookieUrls: ['https://www.facebook.com', 'https://m.facebook.com'],
    status: 'works',
    what: 'Videos, reels, watch, photos; private groups need login',
  },
  x: {
    id: 'x',
    name: 'X (Twitter)',
    color: '#14171A',
    home: 'https://x.com/',
    login: 'https://x.com/i/flow/login',
    cookieUrls: ['https://x.com', 'https://twitter.com'],
    status: 'works',
    what: 'Videos, GIFs, photos; sensitive posts need login',
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    color: '#25F4EE',
    login: 'https://www.tiktok.com/login',
    cookieUrls: ['https://www.tiktok.com'],
    status: 'works',
    what: 'Videos, photo posts',
  },
  reddit: {
    id: 'reddit',
    name: 'Reddit',
    color: '#FF4500',
    home: 'https://www.reddit.com/',
    login: 'https://www.reddit.com/login/',
    cookieUrls: ['https://www.reddit.com'],
    status: 'works',
    what: 'Videos with sound, GIFs, image galleries',
  },
  pinterest: {
    id: 'pinterest',
    name: 'Pinterest',
    color: '#E60023',
    home: 'https://www.pinterest.com/',
    login: 'https://www.pinterest.com/login/',
    cookieUrls: ['https://www.pinterest.com'],
    status: 'works',
    what: 'Pins (photos and videos), boards',
  },
  snapchat: { id: 'snapchat', name: 'Snapchat', color: '#FFFC00', status: 'works', what: 'Spotlight videos' },
  threads: {
    id: 'threads',
    name: 'Threads',
    color: '#101010',
    login: 'https://www.threads.net/login',
    cookieUrls: ['https://www.threads.net', 'https://www.threads.com'],
    status: 'best',
    what: 'Best effort for now (in-app browser coming)',
  },
  linkedin: { id: 'linkedin', name: 'LinkedIn', color: '#0A66C2', status: 'works', what: 'Post videos' },
  tumblr: { id: 'tumblr', name: 'Tumblr', color: '#36465D', status: 'works', what: 'Posts, photos, videos' },
  bluesky: { id: 'bluesky', name: 'Bluesky', color: '#1185FE', status: 'works', what: 'Videos, photos' },
  imgur: { id: 'imgur', name: 'Imgur', color: '#1BB76E', status: 'works', what: 'Images, albums, GIFs' },
  vimeo: { id: 'vimeo', name: 'Vimeo', color: '#1AB7EA', status: 'works', what: 'Videos' },
  dailymotion: { id: 'dailymotion', name: 'Dailymotion', color: '#0D0D0D', status: 'works', what: 'Videos' },
  twitch: { id: 'twitch', name: 'Twitch', color: '#9146FF', status: 'works', what: 'VODs, clips, live' },
  kick: { id: 'kick', name: 'Kick', color: '#53FC18', status: 'works', what: 'VODs, clips, live' },
  soundcloud: { id: 'soundcloud', name: 'SoundCloud', color: '#FF5500', status: 'works', what: 'Tracks, playlists' },
  bandcamp: { id: 'bandcamp', name: 'Bandcamp', color: '#629AA9', status: 'works', what: 'Tracks, albums (free previews)' },
  mixcloud: { id: 'mixcloud', name: 'Mixcloud', color: '#5000FF', status: 'works', what: 'Shows, mixes' },
  audiomack: { id: 'audiomack', name: 'Audiomack', color: '#FFA200', status: 'works', what: 'Songs, albums' },
  jiosaavn: { id: 'jiosaavn', name: 'JioSaavn', color: '#2BC5B4', status: 'works', what: 'Songs, albums, playlists' },
  bilibili: { id: 'bilibili', name: 'Bilibili', color: '#00A1D6', status: 'works', what: 'Videos' },
  rumble: { id: 'rumble', name: 'Rumble', color: '#85C742', status: 'works', what: 'Videos' },
  streamable: { id: 'streamable', name: 'Streamable', color: '#0F90FA', status: 'works', what: 'Videos' },
  ninegag: { id: 'ninegag', name: '9GAG', color: '#000000', status: 'works', what: 'Videos, GIFs' },
  likee: { id: 'likee', name: 'Likee', color: '#FF3C6E', status: 'works', what: 'Videos' },
  sharechat: { id: 'sharechat', name: 'ShareChat', color: '#FF7A00', status: 'best', what: 'Best effort (not in the engines yet)' },
  moj: { id: 'moj', name: 'Moj', color: '#FE5C02', status: 'best', what: 'Best effort (not in the engines yet)' },
  terabox: { id: 'terabox', name: 'Terabox', color: '#3A7BFF', status: 'best', what: 'Best effort (not in the engines yet)' },
  gdrive: { id: 'gdrive', name: 'Google Drive', color: '#1FA463', status: 'works', what: 'Public files and videos' },
  dropbox: { id: 'dropbox', name: 'Dropbox', color: '#0061FF', status: 'works', what: 'Public files and videos' },
  archive: { id: 'archive', name: 'Internet Archive', color: '#666666', status: 'works', what: 'Videos, audio' },
  other: { id: 'other', name: 'Website', color: '#6B7280', status: 'works', what: '1,000+ more sites and pages with embedded video' },
};

/** Sites shown as shortcuts on the Home screen. */
export const HOME_SITES: SiteId[] = ['youtube', 'instagram', 'facebook', 'x', 'ytmusic', 'pinterest', 'reddit', 'jiosaavn'];

/**
 * Engines to try, in order. yt-dlp is best for video/audio; gallery-dl understands photo
 * posts, carousels, stories and profiles. If the first engine finds nothing, the next one runs.
 */
export function enginesFor(link: Pick<Link, 'site' | 'kind'>, loggedIn = true): EngineId[] {
  const { site, kind } = link;
  switch (site) {
    case 'youtube':
    case 'ytmusic':
    case 'soundcloud':
    case 'jiosaavn':
    case 'vimeo':
    case 'dailymotion':
    case 'twitch':
    case 'kick':
      return ['ytdlp'];
    case 'instagram':
      // gallery-dl needs a login for Instagram; without one, yt-dlp (videos work logged out) goes first.
      return kind === 'reel' || kind === 'audio' || !loggedIn ? VIDEO_FIRST : PHOTO_FIRST;
    case 'facebook':
      return kind === 'post' ? PHOTO_FIRST : VIDEO_FIRST;
    case 'tiktok':
      return kind === 'post' ? PHOTO_FIRST : VIDEO_FIRST;
    case 'pinterest':
    case 'tumblr':
    case 'imgur':
      return PHOTO_FIRST;
    default:
      return VIDEO_FIRST;
  }
}

export const siteInfo = (id: string): SiteInfo => SITES[id as SiteId] ?? SITES.other;

/** Kinds that only work after logging in to the site inside OnePlace. */
export function needsLogin(link: Pick<Link, 'site' | 'kind'>): boolean {
  return link.site === 'instagram' && (link.kind === 'story' || link.kind === 'highlight');
}

export const KIND_LABEL: Record<LinkKind, string> = {
  video: 'Video',
  short: 'Short',
  live: 'Live',
  song: 'Song',
  reel: 'Reel',
  post: 'Post',
  story: 'Story',
  highlight: 'Highlight',
  profile: 'Profile',
  playlist: 'Playlist',
  channel: 'Channel',
  album: 'Album',
  audio: 'Audio',
  unknown: 'Link',
};
