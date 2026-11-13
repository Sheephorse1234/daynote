export type Line = { id: string; text: string; done: boolean; pinned: boolean };
export type Note = { schema: 1; revision: string; updatedAt: string; lines: Line[] };
export type Day = { iso: string; label: string; stamp: number };
export type Group = { id: string; heading?: Line; day?: Day; lines: Line[] };
export type Event = { id: string; text: string; project: string | null; start: Day; end: Day; done: boolean; warning?: string };
export const MAX_BACKUP_BYTES = 2_000_000;
export const uid = () => crypto.randomUUID();
export const line = (text = ''): Line => ({ id: uid(), text, done: false, pinned: false });

// Two-digit years are deliberately limited to 2000–2099. Never use Date's rollover parsing.
export function parseDate(text: string): Day | null {
  const value = text.trim();
  const parts = /^(\d{2}|\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(value)
    ?? /^(\d{4})(\d{2})(\d{2})$/.exec(value)
    ?? /^(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!parts) return null;
  const year = parts[1].length === 2 ? 2000 + +parts[1] : +parts[1];
  const month = +parts[2], day = +parts[3];
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { stamp, iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, label: `${String(year % 100).padStart(2, '0')}.${month}.${day}` };
}

export function groupsOf(lines: Line[]): Group[] {
  const groups: Group[] = [];
  let current: Group = { id: 'free', lines: [] };
  for (const row of lines) {
    const day = parseDate(row.text);
    if (day) {
      if (current.lines.length || current.heading) groups.push(current);
      current = { id: row.id, heading: row, day, lines: [] };
    } else current.lines.push(row);
  }
  if (current.lines.length || current.heading) groups.push(current);
  return groups;
}
export function sortedGroups(lines: Line[]): Group[] {
  return groupsOf(lines).sort((a, b) => Number(!!b.heading?.pinned) - Number(!!a.heading?.pinned)
    || (b.day?.stamp ?? -Infinity) - (a.day?.stamp ?? -Infinity));
}
export function projectOf(text: string): string | null {
  const explicit = /\[프로젝트:\s*([^\]\n]+)\]/.exec(text);
  if (explicit) return explicit[1].trim() || null;
  return /(?:^|\s)([\p{L}\p{N}_-]+프로젝트)(?=\s|$|[,:：])/u.exec(text)?.[1] ?? null;
}
const dateToken = '(?:\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{2}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{8}|\\d{6})';
const rangePattern = new RegExp(`\\[(${dateToken})\\s*~\\s*(${dateToken})\\]`);
export function eventsOf(lines: Line[]): Event[] {
  const events: Event[] = [];
  for (const group of groupsOf(lines)) {
    if (!group.day) continue;
    for (const row of group.lines) {
      if (!row.text.trim() || /^참고\s*:/.test(row.text.trim())) continue;
      const match = rangePattern.exec(row.text);
      let start = group.day, end = group.day, warning: string | undefined;
      if (match) {
        const a = parseDate(match[1]), b = parseDate(match[2]);
        if (a && b && b.stamp >= a.stamp) { start = a; end = b; }
        else warning = '유효하지 않은 기간입니다. 날짜 제목의 하루 일정으로 표시합니다.';
      } else if (/\[[^\]]*~[^\]]*\]/.test(row.text)) warning = '기간 형식을 확인하세요. [26.11.1~26.11.5] 형식을 사용합니다.';
      events.push({ id: row.id, text: row.text, project: projectOf(row.text), start, end, done: row.done, warning });
    }
  }
  return events.sort((a, b) => a.start.stamp - b.start.stamp || a.id.localeCompare(b.id));
}
export function makeNote(lines: Line[]): Note {
  return { schema: 1, revision: uid(), updatedAt: new Date().toISOString(), lines };
}
export function validateNote(value: unknown): Note {
  if (!value || typeof value !== 'object') throw new Error('백업 형식을 확인하세요.');
  const note = value as Note;
  if (note.schema !== 1 || typeof note.revision !== 'string' || !note.revision || typeof note.updatedAt !== 'string' || !Number.isFinite(Date.parse(note.updatedAt)) || !Array.isArray(note.lines) || note.lines.length < 1 || note.lines.length > 20000) throw new Error('지원하지 않거나 손상된 백업입니다.');
  const ids = new Set<string>();
  const lines = note.lines.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.text !== 'string' || /[\r\n]/.test(row.text) || typeof row.done !== 'boolean' || typeof row.pinned !== 'boolean') throw new Error('메모 줄 데이터가 올바르지 않습니다.');
    ids.add(row.id);
    return { id: row.id, text: row.text, done: row.done, pinned: row.pinned };
  });
  return { schema: 1, revision: note.revision, updatedAt: note.updatedAt, lines };
}
export function readBackup(text: string): Note {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('백업은 2MB 이하만 가져올 수 있습니다.');
  try { return validateNote(JSON.parse(text)); } catch (error) {
    if (error instanceof SyntaxError) throw new Error('JSON 백업 파일을 선택하세요.');
    throw error;
  }
}
export function plainText(lines: Line[], original = false): string {
  if (original) return lines.map(row => row.text).join('\n');
  return sortedGroups(lines).map(group => [group.heading ? group.day!.label : null, ...group.lines.map(row => `${row.done ? '[완료] ' : ''}${row.text}`)].filter(text => text !== null).join('\n').trimEnd()).join('\n\n');
}
export function splitLine(lines: Line[], id: string, start: number, end: number, text: string): { lines: Line[]; focusId: string; caret: number } {
  const index = lines.findIndex(row => row.id === id), row = lines[index];
  if (!row) return { lines, focusId: id, caret: start };
  const pieces = text.replace(/\r\n?/g, '\n').split('\n');
  const before = row.text.slice(0, start), after = row.text.slice(end);
  if (pieces.length === 1) return { lines: lines.map(r => r.id === id ? { ...r, text: before + text + after } : r), focusId: id, caret: before.length + text.length };
  const added = pieces.map((piece, i) => i === 0 ? { ...row, text: before + piece } : line(piece + (i === pieces.length - 1 ? after : '')));
  return { lines: [...lines.slice(0, index), ...added, ...lines.slice(index + 1)], focusId: added.at(-1)!.id, caret: pieces.at(-1)!.length };
}
