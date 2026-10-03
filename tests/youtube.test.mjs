import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { normalizeYouTubeUrl, createDownloader } = createRequire(import.meta.url)('../electron/youtube.cjs');
const url = 'https://www.youtube.com/watch?v=BaW_jenozKc';
test('YouTube-URLs werden validiert und auf ein einzelnes Video begrenzt', () => {
  assert.equal(normalizeYouTubeUrl('https://youtu.be/BaW_jenozKc?t=10'), url);
  assert.equal(normalizeYouTubeUrl('https://www.youtube.com/shorts/BaW_jenozKc'), url);
  assert.equal(normalizeYouTubeUrl(url + '&list=abc'), url);
  for (const input of ['file:///secret', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://youtube.com/playlist?list=abc', 'https://user:password@youtube.com/watch?v=BaW_jenozKc', '--exec=anything', 'https://youtube.com/watch?v=invalid']) assert.throws(() => normalizeYouTubeUrl(input));
});
async function fixture() {
  const root = await fs.mkdtemp(path.resolve('test-output', 'youtube-unit-'));
  const tools = path.join(root, 'tools'); await fs.mkdir(tools); await fs.mkdir(path.join(root, 'audio'));
  const suffix = process.platform === 'win32' ? '.exe' : '';
  await Promise.all(['yt-dlp', 'ffmpeg', 'ffprobe'].map(name => fs.writeFile(path.join(tools, name + suffix), 'test tool')));
  return { root, tools, runtime: process.execPath };
}
test('YouTube-Import meldet Fortschritt, erzeugt Bibliotheksdatei und entfernt temporäre Dateien', async () => {
  await fs.mkdir('test-output', { recursive: true });
  const config = await fixture(), updates = [];
  const downloader = createDownloader({ ...config, progress: u => updates.push(u), execute: async (_exe, args, options) => {
    assert.ok(args.includes('--no-playlist')); assert.equal(args.at(-1), url);
    options.onLine('GIGMAN_TITLE:"Test Song"'); options.onLine('GIGMAN_PROGRESS: 50.0%');
    const output = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp3');
    await fs.writeFile(output, Buffer.from('MP3 test fixture'));
  } });
  const result = await downloader.download(url);
  assert.equal(result.song.title, 'Test Song'); assert.equal(result.song.sourceUrl, url);
  assert.ok((await fs.stat(path.join(config.root, 'audio', result.song.file))).size > 0);
  assert.ok(updates.some(u => u.percent === 50));
  assert.equal((await fs.readdir(config.root)).filter(f => f.startsWith('download-')).length, 0);
});
test('Abbruch verhindert Bibliotheksimport und räumt den Arbeitsordner auf', async () => {
  const config = await fixture(); let started;
  const running = new Promise(resolve => { started = resolve; });
  const downloader = createDownloader({ ...config, execute: async (_exe, _args, { signal }) => {
    started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw new Error('aborted');
  } });
  const job = downloader.download(url); await running;
  await assert.rejects(downloader.download(url), /bereits/);
  await downloader.cancel(); assert.deepEqual(await job, { canceled: true });
  assert.equal((await fs.readdir(path.join(config.root, 'audio'))).length, 0);
  assert.equal((await fs.readdir(config.root)).filter(f => f.startsWith('download-')).length, 0);
});
test('Fehlende Werkzeuge und YouTube-Sperren liefern verständliche Fehler', async () => {
  const config = await fixture();
  const fail = createDownloader({ ...config, execute: async () => { throw new Error('Sign in to confirm you are not a bot'); } });
  await assert.rejects(fail.download(url), /ohne Anmeldung/);
  await assert.rejects(createDownloader({ ...config, tools: path.join(config.root, 'missing') }).download(url), /Werkzeuge fehlen/);
});
