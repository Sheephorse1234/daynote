export type Line = { id: string; text: string; done: boolean; pinned: boolean; schedule: { groupId: string } | null };
export type Project = { id: string; name: string; aliases: string[] };
export type Note = { schema: 2; revision: string; updatedAt: string; lines: Line[]; projects: Project[] };
export type Day = { iso: string; label: string; stamp: number };
export type Group = { id: string; heading?: Line; day?: Day; end?: Day; lines: Line[] };
export type Event = { id: string; groupId: string; text: string; project: string | null; projectId: string | null; start: Day; end: Day; done: boolean; warning?: string };
export const MAX_BACKUP_BYTES = 2_000_000;
export const uid = () => crypto.randomUUID();
export const line = (text = ''): Line => ({ id: uid(), text, done: false, pinned: false, schedule: null });

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

export type Period = { start: Day; end: Day; label: string };
const dateToken = '(?:\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{2}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{8}|\\d{6})';
const endToken = `(?:${dateToken}|\\d{4}|\\d{1,2}[./-]\\d{1,2})`;
const periodPattern = new RegExp(`^(${dateToken})\\s*~+\\s*(${endToken})$`);
const embeddedPeriod = new RegExp(`(^|[\\s\\[(])(${dateToken}\\s*~+\\s*${endToken})(?=$|[\\s\\]),;:!?])`, 'g');
export function parsePeriod(text: string): Period | null {
  const match = periodPattern.exec(text.trim());
  if (!match) return null;
  const start = parseDate(match[1]);
  if (!start) return null;
  const short = /^(\d{2})(\d{2})$/.exec(match[2]) ?? /^(\d{1,2})[./-](\d{1,2})$/.exec(match[2]);
  const end = short ? parseDate(`${start.iso.slice(0, 4)}.${short[1]}.${short[2]}`) : parseDate(match[2]);
  // A short end inherits the stated year only; never guess a year rollover.
  if (!end || end.stamp < start.stamp) return null;
  return { start, end, label: `${start.label}~${end.label}` };
}
export function parseHeading(text: string): Period | null {
  const day = parseDate(text);
  return day ? { start: day, end: day, label: day.label } : parsePeriod(text);
}
export function displayText(text: string): string {
  const heading = parseHeading(text);
  if (heading) return heading.label;
  return text.replace(embeddedPeriod, (all, prefix: string, value: string) => {
    const period = parsePeriod(value);
    return period ? prefix + period.label : all;
  });
}
export function groupsOf(lines: Line[]): Group[] {
  const groups: Group[] = [];
  let current: Group = { id: 'free', lines: [] };
  for (const row of lines) {
    const period = parseHeading(row.text);
    if (period) {
      if (current.lines.length || current.heading) groups.push(current);
      current = { id: row.id, heading: row, day: period.start, end: period.end, lines: [] };
    } else current.lines.push(row);
  }
  if (current.lines.length || current.heading) groups.push(current);
  return groups;
}
export function sortedGroups(lines: Line[]): Group[] {
  return groupsOf(lines).sort((a, b) => Number(!!b.heading?.pinned) - Number(!!a.heading?.pinned)
    || (b.day?.stamp ?? -Infinity) - (a.day?.stamp ?? -Infinity));
}
// The old parser is retained exclusively for importing schema 1 projects.
function legacyProjectOf(text: string): string | null {
  const explicit = /\[프로젝트:\s*([^\]\n]+)\]/.exec(text);
  if (explicit) return explicit[1].trim() || null;
  return /(?:^|\s)([\p{L}\p{N}_-]+프로젝트)(?=\s|$|[,:：])/u.exec(text)?.[1] ?? null;
}
export function projectOf(text: string, projects: Project[]): Project | null {
  const value = text.trimStart().normalize('NFC');
  const matches = projects.filter(project => [project.name, ...project.aliases].some(alias => {
    const key = alias.trim().normalize('NFC');
    return key && value.startsWith(key) && !/^[\p{L}\p{N}_-]/u.test(value.slice(key.length));
  }));
  return matches.length === 1 ? matches[0] : null;
}
export function addProjectAlias(projects: Project[], alias: string, target: { id: string } | { name: string }): Project[] {
  const expression = alias.trim().normalize('NFC');
  const name = 'name' in target ? target.name.trim().normalize('NFC') : '';
  if (!expression || expression.length > 100 || /[\r\n]/.test(expression)) throw new Error('프로젝트 표현은 한 줄, 100자 이하로 선택하세요.');
  if ('name' in target && (!name || name.length > 100 || /[\r\n]/.test(name))) throw new Error('표준 프로젝트명을 100자 이하로 적어주세요.');
  const existing = 'id' in target ? projects.find(project => project.id === target.id) : undefined;
  if ('id' in target && !existing) throw new Error('선택한 프로젝트를 찾을 수 없습니다.');
  const keys = existing ? [expression] : [expression, name];
  if (projects.some(project => project.id !== existing?.id && keys.some(key => [project.name, ...project.aliases].includes(key)))) throw new Error('이미 다른 프로젝트에 등록된 이름 또는 별칭입니다. 해당 프로젝트를 선택하세요.');
  if (existing) return projects.map(project => project.id === existing.id ? { ...project, aliases: [...new Set([...project.aliases, expression])] } : project);
  return [...projects, { id: uid(), name, aliases: [...new Set([name, expression])] }];
}
export function setSchedule(lines: Line[], id: string, enabled: boolean): Line[] {
  const row = lines.find(item => item.id === id);
  if (!row) throw new Error('이 메모 줄을 찾을 수 없습니다.');
  if (!enabled) return lines.map(item => item.id === id ? { ...item, schedule: null } : item);
  if (row.schedule) return lines;
  const group = groupsOf(lines).find(item => item.lines.some(task => task.id === id));
  if (!group?.heading || !row.text.trim()) throw new Error('유효한 날짜 또는 기간 제목 아래의 할 일을 선택하세요.');
  return lines.map(item => item.id === id ? { ...item, schedule: { groupId: group.heading!.id } } : item);
}
// A deleted task carries no separate event record. A missing heading removes its registrations.
// An existing but temporarily invalid heading suspends its events until the date is valid again.
export function reconcileSchedules(lines: Line[]): Line[] {
  const byId = new Map(lines.map(row => [row.id, row]));
  const membership = new Map(groupsOf(lines).flatMap(group => group.lines.map(row => [row.id, group.heading?.id] as const)));
  return lines.map(row => {
    if (!row.schedule) return row;
    const heading = byId.get(row.schedule.groupId);
    if (!heading || !row.text.trim() || parseHeading(row.text)) return { ...row, schedule: null };
    if (parseHeading(heading.text)) {
      const groupId = membership.get(row.id);
      return { ...row, schedule: groupId ? { groupId } : null };
    }
    return row;
  });
}
export function eventsOf(lines: Line[], projects: Project[] = []): Event[] {
  const events: Event[] = [];
  const byId = new Map(lines.map(row => [row.id, row]));
  for (const row of reconcileSchedules(lines)) {
    if (!row.schedule) continue;
    const heading = byId.get(row.schedule.groupId);
    const period = heading && parseHeading(heading.text);
    if (!period) continue;
    let start = period.start, end = period.end, warning: string | undefined;
    const ranges = [...row.text.matchAll(embeddedPeriod)];
    if (ranges.length === 1) {
      const range = parsePeriod(ranges[0][2]);
      if (range) { start = range.start; end = range.end; }
      else warning = '유효하지 않은 기간입니다. 날짜 제목 기준으로 표시합니다.';
    } else if (ranges.length > 1) warning = '기간이 여러 개입니다. 날짜 제목 기준으로 표시합니다.';
    else if (/\[[^\]]*~[^\]]*\]/.test(row.text)) warning = '기간 형식을 확인하세요. 날짜 제목 기준으로 표시합니다.';
    const project = projectOf(row.text, projects);
    events.push({ id: row.id, groupId: row.schedule.groupId, text: displayText(row.text), project: project?.name ?? null, projectId: project?.id ?? null, start, end, done: row.done, warning });
  }
  return events.sort((a, b) => a.start.stamp - b.start.stamp || a.id.localeCompare(b.id));
}
export function makeNote(lines: Line[], projects: Project[] = []): Note {
  return { schema: 2, revision: uid(), updatedAt: new Date().toISOString(), lines: reconcileSchedules(lines), projects };
}
export function validateNote(value: unknown): Note {
  if (!value || typeof value !== 'object') throw new Error('백업 형식을 확인하세요.');
  const note = value as Omit<Note, 'schema'> & { schema: number };
  if (![1, 2].includes(note.schema) || typeof note.revision !== 'string' || !note.revision || typeof note.updatedAt !== 'string' || !Number.isFinite(Date.parse(note.updatedAt)) || !Array.isArray(note.lines) || note.lines.length < 1 || note.lines.length > 20000) throw new Error('지원하지 않거나 손상된 백업입니다.');
  const ids = new Set<string>();
  const lines: Line[] = note.lines.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.text !== 'string' || /[\r\n]/.test(row.text) || typeof row.done !== 'boolean' || typeof row.pinned !== 'boolean') throw new Error('메모 줄 데이터가 올바르지 않습니다.');
    ids.add(row.id);
    if (note.schema === 2 && row.schedule !== null && (!row.schedule || typeof row.schedule.groupId !== 'string' || !row.schedule.groupId)) throw new Error('일정 등록 정보가 올바르지 않습니다.');
    return { id: row.id, text: row.text, done: row.done, pinned: row.pinned, schedule: note.schema === 1 ? null : row.schedule && { groupId: row.schedule.groupId } };
  });
  let projects: Project[] = [];
  if (note.schema === 1) {
    // Freeze ONLY the events that the old version actually displayed. Never register new input.
    let heading: Line | undefined;
    const legacyNames = new Set<string>();
    for (const row of lines) {
      if (parseDate(row.text)) { heading = row; continue; }
      if (!heading || !row.text.trim() || /^참고\s*:/.test(row.text.trim())) continue;
      row.schedule = { groupId: heading.id };
      const name = legacyProjectOf(row.text);
      if (name) legacyNames.add(name);
    }
    projects = [...legacyNames].map(name => ({ id: `legacy:${encodeURIComponent(name)}`, name, aliases: [name, `[프로젝트: ${name}]`] }));
  } else {
    if (!Array.isArray(note.projects) || note.projects.length > 2000) throw new Error('프로젝트 데이터가 올바르지 않습니다.');
    const projectIds = new Set<string>();
    projects = note.projects.map(project => {
      if (!project || typeof project.id !== 'string' || !project.id || projectIds.has(project.id) || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 100 || /[\r\n]/.test(project.name) || !Array.isArray(project.aliases) || project.aliases.length > 2000 || project.aliases.some(alias => typeof alias !== 'string' || !alias.trim() || alias.length > 100 || /[\r\n]/.test(alias))) throw new Error('프로젝트 이름 또는 별칭이 올바르지 않습니다.');
      projectIds.add(project.id);
      return { id: project.id, name: project.name.trim().normalize('NFC'), aliases: [...new Set(project.aliases.map(alias => alias.trim().normalize('NFC')))] };
    });
    if (lines.some(row => row.schedule && (!ids.has(row.schedule.groupId) || row.id === row.schedule.groupId))) throw new Error('일정에 연결된 날짜 줄을 찾을 수 없습니다.');
  }
  return { schema: 2, revision: note.revision, updatedAt: note.updatedAt, lines: reconcileSchedules(lines), projects };
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
  return sortedGroups(lines).map(group => [group.heading ? displayText(group.heading.text) : null, ...group.lines.map(row => `${row.done ? '[완료] ' : ''}${displayText(row.text)}`)].filter(text => text !== null).join('\n').trimEnd()).join('\n\n');
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
