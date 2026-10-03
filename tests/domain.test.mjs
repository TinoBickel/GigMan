import test from 'node:test';
import assert from 'node:assert/strict';
import { playlist, moveSong, validateSection, dragSection, songSettings } from '../src/domain.js';
test('Setliste spielt nur Sektionen, sortiert nach Startzeit, und unmarkierte Songs vollständig', () => {
  const songs = [{ id: 'a', duration: 180, sections: [{ id: 'second', start: 100, end: 120 }, { id: 'first', start: 20, end: 30 }] }, { id: 'b', duration: 240, sections: [] }];
  assert.deepEqual(playlist(songs).map(s => [s.songId, s.start, s.end]), [['a', 20, 30], ['a', 100, 120], ['b', 0, 240]]);
});
test('Sortieren funktioniert in beide Richtungen, ohne die Originalreihenfolge zu verändern', () => {
  const songs = ['a', 'b', 'c'].map(id => ({ id }));
  assert.deepEqual(moveSong(songs, 'a', 'c').map(s => s.id), ['b', 'c', 'a']);
  assert.deepEqual(moveSong(songs, 'c', 'a').map(s => s.id), ['c', 'a', 'b']);
  assert.deepEqual(songs.map(s => s.id), ['a', 'b', 'c']);
});
test('Ungültige und zu kurze Sektionen werden abgewiesen', () => {
  assert.equal(validateSection(-1, 5, 10), false);
  assert.equal(validateSection(5, 4, 10), false);
  assert.equal(validateSection(0, 11, 10), false);
  assert.equal(validateSection(1, 1.01, 10), false);
  assert.equal(validateSection(NaN, 5, 10), false);
  assert.equal(validateSection(0, 10, 10), true);
});
test('Sektionen verschieben hält Länge und Songgrenzen ein; Randgriffe verändern nur ihren Rand', () => {
  const section = { start: 3, end: 5 };
  assert.deepEqual(dragSection(section, 2, 'move', 10), { start: 5, end: 7 });
  assert.deepEqual(dragSection(section, -10, 'move', 10), { start: 0, end: 2 });
  assert.deepEqual(dragSection(section, 20, 'move', 10), { start: 8, end: 10 });
  assert.deepEqual(dragSection(section, -2, 'start', 10), { start: 1, end: 5 });
  assert.deepEqual(dragSection(section, 2, 'end', 10), { start: 3, end: 7 });
  assert.deepEqual(dragSection(section, 10, 'start', 10), { start: 4.9, end: 5 });
  assert.deepEqual(dragSection(section, -10, 'end', 10), { start: 3, end: 3.1 });
});
test('Gemischte Setliste berücksichtigt Komplett / Loops pro Song', () => {
  const section = { start: 20, end: 30 };
  assert.deepEqual(playlist([
    { id: 'full', duration: 100, playMode: 'full', sections: [section] },
    { id: 'loops', duration: 120, playMode: 'loops', sections: [section] },
    { id: 'empty', duration: 80, playMode: 'loops', sections: [] }
  ]).map(s => [s.songId, s.start, s.end]), [['full', 0, 100], ['loops', 20, 30], ['empty', 0, 80]]);
});
test('Songwerte übernehmen alte globale Einstellungen nur für fehlende Werte', () => {
  assert.deepEqual(songSettings({}, { tempo: 0.75, pitch: -2 }), { tempo: 0.75, pitch: -2, playMode: 'loops' });
  assert.deepEqual(songSettings({ tempo: 1.1, pitch: 3, playMode: 'full' }, { tempo: 0.75, pitch: -2 }), { tempo: 1.1, pitch: 3, playMode: 'full' });
});
