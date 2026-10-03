const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const tar = require('tar');
const audioName = /^[a-f0-9-]{36}\.mp3$/;
const badArchive = () => new Error('Die Datei ist keine gültige GigMan-Sicherung oder ist beschädigt.');
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function libraryValue(value) {
  if (value?.version !== 1 || !Array.isArray(value.setlists) || !value.setlists.length) throw badArchive();
  const number = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  const listIds = new Set(), songIds = new Set(), sectionIds = new Set();
  const unique = (id, ids) => { if (!text(id, 100) || ids.has(id)) throw badArchive(); ids.add(id); return id; };
  const setlists = value.setlists.map(list => {
    if (!text(list.name, 100) || !Array.isArray(list.songs)) throw badArchive();
    return { id: unique(list.id, listIds), name: list.name, songs: list.songs.map(song => {
      if (!text(song.title, 1024) || !audioName.test(song.file) || !Array.isArray(song.sections) || !number(song.duration, 0, 1e9) || !number(song.gap, 0, 600) || !number(song.tempo, 0.5, 1.25) || !number(song.pitch, -12, 12) || !Number.isInteger(song.pitch) || !['full', 'loops'].includes(song.playMode) || ![0,2,4,8].includes(song.count) || !number(song.bpm, 30, 240) || !number(song.volume, 0, 1)) throw badArchive();
      return { id: unique(song.id, songIds), title: song.title, file: song.file, duration: song.duration, gap: song.gap, tempo: song.tempo, pitch: song.pitch, playMode: song.playMode, count: song.count, bpm: song.bpm, volume: song.volume, sections: song.sections.map(section => {
        if (!text(section.name, 80) || !number(section.start, 0, song.duration) || !number(section.end, 0, song.duration) || section.end - section.start < 0.099999) throw badArchive();
        return { id: unique(section.id, sectionIds), name: section.name, start: section.start, end: section.end };
      }) };
    }) };
  });
  return { version: 1, setlists };
}
async function exportArchive(root, destination, value) {
  const library = libraryValue(value), stage = await fs.mkdtemp(path.join(root, '.backup-'));
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  try {
    await fs.mkdir(path.join(stage, 'audio'));
    const audio = Object.create(null);
    for (const song of library.setlists.flatMap(list => list.songs)) {
      if (audio[song.file]) continue;
      const source = path.join(root, 'audio', song.file), target = path.join(stage, 'audio', song.file);
      try {
        if (!(await fs.lstat(source)).isFile()) throw new Error();
        await fs.copyFile(source, target);
      } catch { throw new Error(`„${song.title}“ konnte nicht gesichert werden. Bitte die lokale MP3 prüfen.`); }
      audio[song.file] = { size: (await fs.stat(target)).size, sha256: await digest(target) };
    }
    await fs.writeFile(path.join(stage, 'setlists.json'), JSON.stringify({ format: 'GigMan', version: 1, createdAt: new Date().toISOString(), library, audio }));
    await tar.c({ cwd: stage, file: temporary, gzip: true, portable: true, strict: true }, ['setlists.json', ...Object.keys(audio).map(file => `audio/${file}`)]);
    await fs.rename(temporary, destination);
    return { setlists: library.setlists.length, songs: library.setlists.reduce((n, list) => n + list.songs.length, 0) };
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
    await fs.rm(stage, { recursive: true, force: true });
  }
}
async function importArchive(root, source) {
  const stage = await fs.mkdtemp(path.join(root, '.restore-')), copied = [];
  try {
    const entries = new Map(); let invalid = false;
    const allowed = (name, entry) => entry.type === 'File' && !entry.linkpath && (name === 'setlists.json' ? entry.size <= 16 * 1024 * 1024 : name.startsWith('audio/') && audioName.test(name.slice(6)) && entry.size <= 2 * 1024 ** 3);
    await tar.t({ file: source, strict: true, filter: (name, entry) => {
      if (!allowed(name, entry) || entries.has(name)) { invalid = true; return false; }
      entries.set(name, entry.size); return true;
    } });
    if (invalid || !entries.has('setlists.json')) throw badArchive();
    await tar.x({ file: source, cwd: stage, strict: true, filter: (name, entry) => {
      if (!allowed(name, entry) || entries.get(name) !== entry.size) { invalid = true; return false; }
      return true;
    } });
    if (invalid) throw badArchive();
    const manifest = JSON.parse(await fs.readFile(path.join(stage, 'setlists.json'), 'utf8'));
    if (manifest.format !== 'GigMan' || manifest.version !== 1 || !manifest.audio || typeof manifest.audio !== 'object') throw badArchive();
    const library = libraryValue(manifest.library), songs = library.setlists.flatMap(list => list.songs), files = new Set(songs.map(song => song.file));
    if (entries.size !== files.size + 1 || Object.keys(manifest.audio).length !== files.size) throw badArchive();
    for (const file of files) {
      const meta = manifest.audio[file], target = path.join(stage, 'audio', file);
      if (!meta || meta.size !== entries.get(`audio/${file}`) || !/^[a-f0-9]{64}$/.test(meta.sha256) || await digest(target) !== meta.sha256) throw badArchive();
    }
    await fs.mkdir(path.join(root, 'audio'), { recursive: true });
    const fileNames = new Map();
    for (const file of files) {
      const name = `${randomUUID()}.mp3`, target = path.join(root, 'audio', name);
      await fs.copyFile(path.join(stage, 'audio', file), target, require('node:fs').constants.COPYFILE_EXCL);
      copied.push(target); fileNames.set(file, name);
    }
    for (const list of library.setlists) {
      list.id = randomUUID();
      for (const song of list.songs) { song.id = randomUUID(); song.file = fileNames.get(song.file); for (const section of song.sections) section.id = randomUUID(); }
    }
    return library;
  } catch (error) {
    await Promise.all(copied.map(file => fs.rm(file, { force: true })));
    if (error.code === 'ENOSPC') throw new Error('Nicht genug freier Speicherplatz zum Laden der Sicherung.');
    throw badArchive();
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
module.exports = { exportArchive, importArchive };
