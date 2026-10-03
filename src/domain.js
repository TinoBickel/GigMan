export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export function time(n) { n = Math.max(0, n || 0); return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`; }
export function ranges(song) {
  return song.sections.length ? [...song.sections].sort((a, b) => a.start - b.start).map(s => ({ ...s, songId: song.id })) : [{ id: 'full', name: 'Ganzer Song', start: 0, end: song.duration, songId: song.id }];
}
export function playlist(songs) { return songs.flatMap(ranges); }
export function moveSong(songs, id, target) {
  const from = songs.findIndex(s => s.id === id), to = songs.findIndex(s => s.id === target);
  if (from < 0 || to < 0) return songs;
  const result = [...songs]; result.splice(to, 0, result.splice(from, 1)[0]); return result;
}
export function validateSection(start, end, duration) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= duration && end - start >= 0.1;
}
export function dragSection(section, delta, edge, duration) {
  if (edge === 'start') return { start: clamp(section.start + delta, 0, section.end - 0.1), end: section.end };
  if (edge === 'end') return { start: section.start, end: clamp(section.end + delta, section.start + 0.1, duration) };
  const length = section.end - section.start, start = clamp(section.start + delta, 0, duration - length);
  return { start, end: start + length };
}
