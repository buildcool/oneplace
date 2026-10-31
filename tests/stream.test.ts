import { describe, expect, it } from 'vitest';
import { SKIP_MUSIC, SKIP_VIDEO, entriesToItems, queueUrl, skipLabel, streamItem, ytId, ytThumb } from '../src/core/stream.ts';
import { setSponsorBlock, toPlayItem } from '../src/ui/viewer/play.ts';

describe('links played without downloading', () => {
  it('finds the YouTube id of every kind of link', () => {
    expect(ytId('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ');
    expect(ytId('https://music.youtube.com/watch?v=kJQP7kiw5Fk&list=RDAMVMkJQP7kiw5Fk')).toBe('kJQP7kiw5Fk');
    expect(ytId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(ytId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(ytId('https://www.instagram.com/reel/ABC/')).toBeUndefined();
  });

  it('makes a player item: one address per video, the picture, sound only for songs', () => {
    const v = streamItem({ url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Never Gonna', thumb: 'https://i.ytimg.com/a.jpg' });
    expect(v).toMatchObject({ key: 'yt:dQw4w9WgXcQ', kind: 'video', stream: true, site: 'youtube', title: 'Never Gonna' });
    expect(v.file.uri).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(v.thumbs).toEqual(['https://i.ytimg.com/a.jpg', ytThumb('dQw4w9WgXcQ')]);
    const song = streamItem({ url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk', audio: true });
    expect(song).toMatchObject({ key: 'yt:kJQP7kiw5Fk', kind: 'audio', site: 'ytmusic', title: 'YouTube' });
    expect(song.file.uri).toBe('https://www.youtube.com/watch?v=kJQP7kiw5Fk');
    const other = streamItem({ url: 'https://www.instagram.com/reel/ABC123/', title: 'Reel', thumb: 'http://insecure/x.jpg' });
    expect(other.key).toBe('web:https://www.instagram.com/reel/ABC123/');
    expect(other.thumbs).toEqual([]);
  });

  it('tells the player to find the stream and what SponsorBlock skips', () => {
    const v = streamItem({ url: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ' });
    setSponsorBlock(true);
    expect(toPlayItem(v)).toMatchObject({ id: 'yt:dQw4w9WgXcQ', uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', stream: true, audioOnly: false, site: 'youtube', skip: SKIP_VIDEO });
    expect(toPlayItem(streamItem({ url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk', audio: true })).skip).toEqual(SKIP_MUSIC);
    expect(toPlayItem(streamItem({ url: 'https://www.instagram.com/reel/ABC123/' })).skip).toBeUndefined();
    setSponsorBlock(false);
    expect(toPlayItem(v).skip).toBeUndefined();
    setSponsorBlock(true);
  });

  it('queues the rest of a playlist, or a mix when autoplay is on', () => {
    expect(queueUrl('https://music.youtube.com/watch?v=kJQP7kiw5Fk&list=OLAK5uy_abc', false, true)).toBe('https://www.youtube.com/watch?v=kJQP7kiw5Fk&list=OLAK5uy_abc');
    expect(queueUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ', true, false)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ');
    expect(queueUrl('https://music.youtube.com/watch?v=kJQP7kiw5Fk', true, true)).toBe('https://www.youtube.com/watch?v=kJQP7kiw5Fk&list=RDAMVMkJQP7kiw5Fk');
    expect(queueUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ', false, false)).toBeUndefined();
    expect(queueUrl('https://www.youtube.com/playlist?list=PLx', false, false)).toBe('https://www.youtube.com/playlist?list=PLx');
  });

  it('turns a list into the songs after the one playing, each once', () => {
    // Shape of yt-dlp's real answer (--flat-playlist -J) for a YouTube mix.
    const mix = {
      _type: 'playlist',
      title: 'Mix - Luis Fonsi - Despacito',
      entries: [
        { id: 'kJQP7kiw5Fk', title: 'Despacito', duration: 282, channel: 'Luis Fonsi' },
        { id: 'pRpeEdMmmQ0', title: 'Waka Waka', duration: 211, channel: 'Shakira' },
        { id: 'pRpeEdMmmQ0', title: 'Waka Waka (again)' },
        { id: 'not-an-id', title: 'bad' },
        null,
        { id: 'b8I-7Wk_Vbc', title: 'Bailando', duration: 272, uploader: 'Enrique Iglesias' },
      ],
    };
    const items = entriesToItems(mix, true, 'kJQP7kiw5Fk');
    expect(items.map((x) => x.title)).toEqual(['Waka Waka', 'Bailando']);
    expect(items[1]).toMatchObject({ kind: 'audio', artist: 'Enrique Iglesias', dur: 272, site: 'ytmusic' });
    // An album opened at its third song: only what comes after it.
    const album = { entries: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'].map((id) => ({ id, title: id })) };
    expect(entriesToItems(album, true, 'ccccccccccc').map((x) => x.title)).toEqual(['ddddddddddd']);
    expect(entriesToItems({ nope: 1 }, false)).toEqual([]);
    expect(entriesToItems(album, false, undefined, 2)).toHaveLength(2);
  });

  it('says what SponsorBlock skipped', () => {
    expect(skipLabel('sponsor')).toBe('yt.skipSponsor');
    expect(skipLabel('music_offtopic')).toBe('yt.skipNonMusic');
    expect(skipLabel('filler')).toBe('yt.skipPart');
  });
});
