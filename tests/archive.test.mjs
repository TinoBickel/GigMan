import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { createRequire } from 'node:module';
const { exportArchive, importArchive } = createRequire(import.meta.url)('../electron/archive.cjs');
const file = '12345678-1234-1234-1234-123456789abc.mp3';
const song = { id: 'song-a', title: 'Solo Practice', file, duration: 10, gap: 7, tempo: 0.75, pitch: -2, playMode: 'loops', count: 2, bpm: 135, volume: 0.35, sections: [{ id: 'solo-a', name: 'Solo 1', start: 2, end: 4 }] };
const library = { version: 1, setlists: [{ id: 'list-a', name: 'Gig A', songs: [song] }, { id: 'list-b', name: 'Gig B', songs: [{ ...song, id: 'song-b', sections: [] }] }] };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gigman-archive-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'audio'));
  await fs.writeFile(path.join(root, 'audio', file), Buffer.from('MP3 fixture bytes'));
  return { root, archive: path.join(root, 'gig.gigman') };
}
test('Portable Sicherung erhält mehrere Setlisten, Reihenfolge, MP3s und alle Songwerte; wiederholtes Laden verwendet neue IDs', async t => {
  const { root, archive } = await fixture(t);
  assert.deepEqual(await exportArchive(root, archive, library), { setlists: 2, songs: 2 });
  const entries = []; await tar.t({ file: archive, onReadEntry: entry => entries.push(entry.path) });
  assert.deepEqual(entries, ['setlists.json', `audio/${file}`], 'Gemeinsam verwendete MP3 liegt nur einmal im Archiv');
  const imported = await importArchive(root, archive), again = await importArchive(root, archive);
  const result = imported.setlists[0].songs[0];
  assert.deepEqual({ ...result, id: song.id, file, sections: result.sections.map(s => ({ ...s, id: song.sections[0].id })) }, song);
  assert.notEqual(imported.setlists[0].id, library.setlists[0].id);
  assert.notEqual(imported.setlists[0].id, again.setlists[0].id);
  assert.notEqual(result.id, again.setlists[0].songs[0].id);
  assert.equal(imported.setlists[1].songs[0].file, result.file);
  assert.equal(await fs.readFile(path.join(root, 'audio', result.file), 'utf8'), 'MP3 fixture bytes');
  assert.deepEqual(imported.setlists.map(list => list.name), ['Gig A', 'Gig B']);
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.backup-') || name.startsWith('.restore-')), false);
});
test('Fehlende MP3 überschreibt eine vorhandene Sicherung nicht', async t => {
  const { root, archive } = await fixture(t);
  await fs.writeFile(archive, 'Vorhandene Sicherung');
  await fs.rm(path.join(root, 'audio', file));
  await assert.rejects(exportArchive(root, archive, library), /MP3 prüfen/);
  assert.equal(await fs.readFile(archive, 'utf8'), 'Vorhandene Sicherung');
});
test('Beschädigte MP3 und fremde Archiveinträge werden vor dem Import abgewiesen', async t => {
  const { root, archive } = await fixture(t);
  await exportArchive(root, archive, library);
  const stage = path.join(root, 'tampered'); await fs.mkdir(stage);
  await tar.x({ file: archive, cwd: stage });
  await fs.writeFile(path.join(stage, 'audio', file), 'Corrupted fixture');
  await tar.c({ cwd: stage, file: archive, gzip: true }, ['setlists.json', `audio/${file}`]);
  await assert.rejects(importArchive(root, archive), /beschädigt/);
  assert.deepEqual(await fs.readdir(path.join(root, 'audio')), [file], 'Kein Teilimport bei beschädigter Sicherung');
  await fs.writeFile(path.join(stage, 'unexpected.txt'), 'Nicht importieren');
  await tar.c({ cwd: stage, file: archive, gzip: true }, ['setlists.json', 'unexpected.txt']);
  await assert.rejects(importArchive(root, archive), /beschädigt/);
});
test('Leere Setlisten lassen sich ebenfalls archivieren', async t => {
  const { root, archive } = await fixture(t);
  await exportArchive(root, archive, { version: 1, setlists: [{ id: 'empty', name: 'Nächster Gig', songs: [] }] });
  assert.equal((await importArchive(root, archive)).setlists[0].songs.length, 0);
});
