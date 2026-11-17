import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTrackToPlaylist,
  clampNumber,
  deriveTrackTitle,
  formatBgmTime,
  getNextTrackInPlaylist,
  isValidAudioUrl,
  parseImportedPlaylistJson,
  removeTrackFromPlaylist,
  serializePlaylistJson,
  shouldTriggerTailFade,
} from './bgmPlaylist';

test('isValidAudioUrl accepts http/https/root-relative URLs and rejects invalid inputs', () => {
  assert.equal(isValidAudioUrl('https://pub-123.r2.dev/tavern.mp3'), true);
  assert.equal(isValidAudioUrl('http://cdn.example.com/boss.ogg?v=1'), true);
  assert.equal(isValidAudioUrl('/audio/theme.wav'), true);
  assert.equal(isValidAudioUrl(''), false);
  assert.equal(isValidAudioUrl('   '), false);
  assert.equal(isValidAudioUrl('ftp://example.com/a.mp3'), false);
  assert.equal(isValidAudioUrl('not a url'), false);
});

test('deriveTrackTitle falls back to decoded filename without extension', () => {
  assert.equal(deriveTrackTitle('https://r2.dev/music/Dark%20Dungeon.mp3', ''), 'Dark Dungeon');
  assert.equal(deriveTrackTitle('https://r2.dev/music/track.ogg', '酒馆微光'), '酒馆微光');
});

test('addTrackToPlaylist & removeTrackFromPlaylist manage multi-R2 tracks cleanly', () => {
  const r1 = addTrackToPlaylist([], {
    title: '阿兹特兰暗流',
    url: 'https://bucket-a.r2.dev/aztlan.mp3',
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;

  const r2 = addTrackToPlaylist(r1.tracks, {
    title: '巨龙苏醒',
    url: 'https://bucket-b.r2.dev/dragon.ogg',
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.tracks.length, 2);

  // 相同 URL 不重复追加，更新自定义曲名
  const rDup = addTrackToPlaylist(r2.tracks, {
    title: '巨龙苏醒（Boss）',
    url: 'https://bucket-b.r2.dev/dragon.ogg',
  });
  assert.equal(rDup.ok, true);
  if (!rDup.ok) return;
  assert.equal(rDup.tracks.length, 2);
  assert.equal(rDup.tracks[1].title, '巨龙苏醒（Boss）');

  const afterDel = removeTrackFromPlaylist(rDup.tracks, r1.track.id);
  assert.equal(afterDel.length, 1);
  assert.equal(afterDel[0].url, 'https://bucket-b.r2.dev/dragon.ogg');
});

test('getNextTrackInPlaylist wraps around cyclically', () => {
  const list = [
    { id: '1', title: 'One', url: 'https://a.r2.dev/1.mp3', addedAt: 1 },
    { id: '2', title: 'Two', url: 'https://b.r2.dev/2.mp3', addedAt: 2 },
  ];
  assert.equal(getNextTrackInPlaylist(list, 'https://a.r2.dev/1.mp3')?.id, '2');
  assert.equal(getNextTrackInPlaylist(list, 'https://b.r2.dev/2.mp3')?.id, '1');
  assert.equal(getNextTrackInPlaylist(list, 'https://c.r2.dev/unknown.mp3')?.id, '1');
  assert.equal(getNextTrackInPlaylist([], 'https://a.r2.dev/1.mp3'), null);
});

test('serializePlaylistJson & parseImportedPlaylistJson round-trip and reject invalid JSON', () => {
  const initial = [
    { id: '1', title: 'Track A', url: 'https://r2-1.example.com/a.mp3', addedAt: 1 },
  ];
  const json = serializePlaylistJson([
    ...initial,
    { id: '2', title: 'Track B', url: 'https://r2-2.example.com/b.flac', addedAt: 2 },
  ]);

  const imported = parseImportedPlaylistJson(json, initial);
  assert.equal(imported.ok, true);
  if (imported.ok) {
    assert.equal(imported.tracks.length, 2);
    assert.equal(imported.addedCount, 1);
    assert.equal(imported.tracks[1].title, 'Track B');
  }

  const bad = parseImportedPlaylistJson('{bad json');
  assert.equal(bad.ok, false);
});

test('formatBgmTime & clampNumber match AudioEngine formatting rules', () => {
  assert.equal(formatBgmTime(65, 190), '01:05 / 03:10');
  assert.equal(formatBgmTime(9, 0), '00:09');
  assert.equal(clampNumber(1.4, 0, 1), 1);
  assert.equal(clampNumber(-0.2, 0, 1), 0);
});

test('shouldTriggerTailFade matches 6s head/tail fade thresholds', () => {
  assert.equal(
    shouldTriggerTailFade({
      isLongFade: true,
      isPlaying: true,
      isTailFading: false,
      duration: 30,
      currentTime: 25,
      longFadeDuration: 6,
    }),
    'start_tail_fade'
  );
  assert.equal(
    shouldTriggerTailFade({
      isLongFade: true,
      isPlaying: true,
      isTailFading: true,
      duration: 30,
      currentTime: 10,
      longFadeDuration: 6,
    }),
    'cancel_tail_fade'
  );
  assert.equal(
    shouldTriggerTailFade({
      isLongFade: true,
      isPlaying: true,
      isTailFading: false,
      duration: 10,
      currentTime: 6,
      longFadeDuration: 6,
    }),
    'none'
  );
});
