import { describe, expect, it } from 'vitest';
import { addProjectAlias, displayText, eventsOf, groupsOf, line, makeNote, parseDate, parsePeriod, plainText, projectOf, readBackup, reconcileSchedules, setSchedule, sortedGroups, splitLine } from './model';
import { loadNote, saveNote, STORAGE_KEY, MIGRATION_KEY } from './storage';

describe('독립 날짜와 실제 달력 검증', () => {
  it.each(['261101', '20261101', '26/11.1', '26/11/1', '26-11-1', '26.11.1'])('%s를 안전하게 통일한다', text => {
    expect(parseDate(text)).toMatchObject({ iso: '2026-11-01', label: '26.11.1' });
  });
  it.each(['260229', '20260230', '26.13.1', '26.0.1', '26.11.0', '261132', '261101 문서', '문서 261101', '19991101', '21000101', '2026-1', '26111'])('%s는 날짜로 변환하지 않는다', text => expect(parseDate(text)).toBeNull());
  it('윤년과 2000년을 처리한다', () => {
    expect(parseDate('240229')?.iso).toBe('2024-02-29');
    expect(parseDate('000229')?.label).toBe('00.2.29');
  });
});
describe('원문 그룹과 일정 추출', () => {
  it('고정 그룹 우선, 미래순이며 원문은 손대지 않는다', () => {
    const lines = ['개인 지식', '261101', 'A프로젝트 작업', '26/11.3', '다른 작업'].map(text => line(text));
    const raw = plainText(lines, true);
    expect(sortedGroups(lines).map(group => group.day?.label)).toEqual(['26.11.3', '26.11.1', undefined]);
    lines[1].pinned = true;
    expect(sortedGroups(lines)[0].lines[0].text).toBe('A프로젝트 작업');
    expect(plainText(lines, true)).toBe(raw);
  });
  it('반복 계산해도 중복 생성하지 않고 실제 별도 줄은 유지한다', () => {
    const lines = ['메모 261101', '26.11.1', '같은 작업', '같은 작업', '참고: 일반 지식', ''].map(text => line(text));
    lines[2].schedule = { groupId: lines[1].id }; lines[3].schedule = { groupId: lines[1].id };
    const first = eventsOf(lines);
    expect(first).toHaveLength(2);
    expect(eventsOf(lines)).toEqual(first);
    expect(new Set(first.map(event => event.id)).size).toBe(2);
    expect(first[0].start).toEqual(first[0].end);
    lines[1].text = '26.11.2';
    expect(eventsOf(lines).map(event => event.start.iso)).toEqual(['2026-11-02', '2026-11-02']);
  });
  it('프로젝트를 추론하거나 다음 줄로 전파하지 않는다', () => {
    const projects = [{ id: 'a', name: 'A프로젝트', aliases: [] }];
    expect(projectOf('A프로젝트 설계', projects)?.id).toBe('a');
    expect(projectOf('[프로젝트: 우리 집] 도배', projects)).toBeNull();
    expect(projectOf('프로젝트에 대한 이야기', projects)).toBeNull();
    const rows = ['26.11.1', 'A프로젝트 작업', '다음 작업'].map(text => line(text));
    rows[2].schedule = { groupId: rows[0].id };
    expect(eventsOf(rows, projects).find(event => event.text === '다음 작업')?.project).toBeNull();
  });
  it('명시한 유효 기간만 사용하고 역전·잘못된 기간에는 경고한다', () => {
    const rows = ['26.11.1', 'A프로젝트 [26.11.1~26.11.5]', '오류 [26.11.5~26.11.1]', '오류 [26.2.30~26.3.1]', '오류 [다음주~다다음주]', '준비 5일'].map(text => line(text));
    rows.slice(1).forEach(row => { row.schedule = { groupId: rows[0].id }; });
    const events = eventsOf(rows);
    expect(events.find(event => event.text.startsWith('A'))?.end.iso).toBe('2026-11-05');
    for (const event of events.filter(item => item.text.startsWith('오류'))) { expect(event.warning).toBeTruthy(); expect(event.start).toEqual(event.end); }
    expect(events.find(item => item.text === '준비 5일')?.end.iso).toBe('2026-11-01');
  });
  it('Enter와 여러 줄 붙여넣기가 뒤 텍스트와 기존 식별자를 보존한다', () => {
    const row = line('회의 준비'); row.done = true;
    const result = splitLine([row], row.id, 2, 3, '\nA\r\nB');
    expect(result.lines.map(item => item.text)).toEqual(['회의', 'A', 'B준비']);
    expect(result.lines[0].id).toBe(row.id);
    expect(result.lines[0].done).toBe(true);
    expect(result.lines[1].done).toBe(false);
    expect(result.focusId).toBe(result.lines[2].id);
    expect(result.caret).toBe(1);
  });
  it('날짜를 지우면 그룹 경계만 바뀌고 텍스트가 사라지지 않는다', () => {
    const rows = ['26.11.1', '할 일', '잘못된 날짜', '보존할 내용'].map(text => line(text));
    expect(groupsOf(rows)[0].lines).toHaveLength(3);
    expect(plainText(rows, true)).toContain('보존할 내용');
  });
});
describe('백업과 저장 안전성', () => {
  const sample = () => makeNote([line('26/11.1'), { ...line('<script>실행하지 않는 원문</script>'), done: true, pinned: true }]);
  it('원문, 고정, 완료를 왕복 복구한다', () => expect(readBackup(JSON.stringify(sample()))).toEqual(expect.objectContaining({ schema: 2, lines: expect.arrayContaining([expect.objectContaining({ text: '26/11.1' }), expect.objectContaining({ done: true, pinned: true })]) })));
  it('손상, 미지원 버전, 중복 ID, 숨겨진 줄바꿈, 과대 파일을 거부한다', () => {
    expect(() => readBackup('{')).toThrow();
    expect(() => readBackup(JSON.stringify({ ...sample(), schema: 3 }))).toThrow();
    const note = sample(); note.lines[1].id = note.lines[0].id;
    expect(() => readBackup(JSON.stringify(note))).toThrow();
    note.lines = [line('한 줄\n두 줄')]; expect(() => readBackup(JSON.stringify(note))).toThrow();
    expect(() => readBackup(' '.repeat(2_000_001))).toThrow();
  });
  it('다른 창의 갱신을 덮어쓰지 않는다', () => {
    const map = new Map<string, string>();
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
    const note = sample(); saveNote(note, null, storage);
    const changed = sample(); saveNote(changed, note.revision, storage);
    expect(() => saveNote(sample(), note.revision, storage)).toThrow('다른 창');
    expect(loadNote(storage)).toEqual(changed);
    map.set(STORAGE_KEY, 'damaged');
    expect(() => saveNote(sample(), null, storage)).toThrow();
    expect(map.get(STORAGE_KEY)).toBe('damaged');
  });
  it('저장 용량 오류를 사용자에게 알린다', () => {
    const storage = { getItem: () => null, setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); } };
    expect(() => saveNote(sample(), null, storage)).toThrow('기기에 저장하지 못했습니다');
  });
});

describe('명시적 일정 등록과 연결 수명', () => {
  it('날짜와 프로젝트가 있어도 새 메모는 등록하지 않는다', () => {
    const rows = ['26.11.11', '123플젝 문서 제출', '도면 검토', '해당 안건은 기존 123프로젝트에서 사용되었던 것으로...'].map(text => line(text));
    expect(eventsOf(makeNote(rows).lines)).toEqual([]);
    const added = setSchedule(rows, rows[1].id, true);
    expect(eventsOf(added)).toHaveLength(1);
    expect(eventsOf(setSchedule(added, rows[1].id, true))).toEqual(eventsOf(added));
    expect(added.map(row => row.text)).toEqual(rows.map(row => row.text));
    expect(eventsOf(added)[0]).toMatchObject({ id: rows[1].id, groupId: rows[0].id });
  });
  it('원문 날짜/내용/완료를 수정하면 같은 일정 ID가 갱신된다', () => {
    let rows = ['261101', '123플젝 문서 제출'].map(text => line(text));
    rows = setSchedule(rows, rows[1].id, true);
    rows[0].text = '26/11/3'; rows[1].text = '123플젝 도면 검토'; rows[1].done = true;
    expect(eventsOf(rows)[0]).toMatchObject({ id: rows[1].id, text: '123플젝 도면 검토', start: { iso: '2026-11-03' }, done: true });
  });
  it('해제/줄 삭제/비우기는 일정만 제거하고 다른 원문은 보존한다', () => {
    const rows = ['26.11.1', '작업', '일반 메모'].map(text => line(text));
    const added = setSchedule(rows, rows[1].id, true);
    expect(eventsOf(setSchedule(added, rows[1].id, false))).toEqual([]);
    expect(setSchedule(added, rows[1].id, false).map(row => row.text)).toEqual(rows.map(row => row.text));
    expect(eventsOf(added.filter(row => row.id !== rows[1].id))).toEqual([]);
    const blank = reconcileSchedules(added.map(row => row.id === rows[1].id ? { ...row, text: '' } : row));
    expect(blank[1].schedule).toBeNull();
    expect(eventsOf(blank)).toEqual([]);
  });
  it('잘못된 제목 수정 중에는 다른 그룹 날짜로 이동하지 않고 복구를 기다린다', () => {
    let rows = ['26.11.5', '다른 그룹', '26.11.1', '등록할 작업'].map(text => line(text));
    rows = setSchedule(rows, rows[3].id, true);
    rows[2].text = '26.11.';
    rows = reconcileSchedules(rows);
    expect(eventsOf(rows)).toEqual([]);
    expect(rows[3].schedule?.groupId).toBe(rows[2].id);
    rows[2].text = '26.11.2';
    expect(eventsOf(rows)[0].start.iso).toBe('2026-11-02');
    expect(reconcileSchedules(rows.filter(row => row.id !== rows[2].id)).at(-1)?.schedule).toBeNull();
  });
  it('새 날짜 제목 삽입은 그룹 연결을 갱신하고 줄 분할은 등록을 복제하지 않는다', () => {
    let rows = ['26.11.1', '작업 원문'].map(text => line(text)); rows = setSchedule(rows, rows[1].id, true);
    const heading = line('26.11.2'); rows.splice(1, 0, heading);
    rows = reconcileSchedules(rows);
    expect(eventsOf(rows)[0].groupId).toBe(heading.id);
    const split = splitLine(rows, rows[2].id, 2, 2, '\n');
    expect(eventsOf(split.lines)).toHaveLength(1);
    expect(split.lines.at(-1)?.schedule).toBeNull();
  });
  it('날짜 없는 일반 메모는 등록 오류를 알리고 원문을 유지한다', () => {
    const rows = [line('일반 지식')];
    expect(() => setSchedule(rows, rows[0].id, true)).toThrow('유효한 날짜');
    expect(rows[0].schedule).toBeNull();
  });
});

describe('프로젝트 이름과 사용자 등록 별칭', () => {
  it('123플젝을 기존 123프로젝트와 연결하고 일정 등록과 분리한다', () => {
    let projects = addProjectAlias([], '123프로젝트', { name: '123프로젝트' });
    const id = projects[0].id;
    projects = addProjectAlias(projects, '123플젝', { id });
    projects = addProjectAlias(projects, '123', { id });
    projects = addProjectAlias(projects, '123플젝', { id });
    expect(projects).toHaveLength(1);
    expect(projects[0].aliases).toHaveLength(3);
    for (const text of ['123플젝 문서만들기', '123프로젝트 상세설계 제출', '123 도면 검토', ' 123플젝: 자료']) expect(projectOf(text, projects)?.id).toBe(id);
    const rows = ['26.11.11', '123플젝 문서만들기'].map(text => line(text));
    expect(eventsOf(rows, projects)).toHaveLength(0);
    expect(eventsOf(setSchedule(rows, rows[1].id, true), projects)[0].projectId).toBe(id);
    expect(rows[1].text).toBe('123플젝 문서만들기');
  });
  it.each(['해당 안건은 기존 123프로젝트에서 사용되었던 것으로', '기존 123플젝 자료를 참고해 작성', '123플젝에서 작성', '1234 도면', '123-4 도면', '123플젝문서', '새123플젝 자료'])('중간 또는 다른 단어인 %s를 분류하지 않는다', text => {
    const projects = [{ id: 'p', name: '123프로젝트', aliases: ['123플젝', '123'] }];
    expect(projectOf(text, projects)).toBeNull();
  });
  it('겹치는 별칭 또는 이름은 임의로 한 프로젝트를 고르지 않는다', () => {
    const projects = [{ id: 'a', name: '공통', aliases: [] }, { id: 'b', name: '별도', aliases: ['공통'] }];
    expect(projectOf('공통 작업', projects)).toBeNull();
    expect(() => addProjectAlias(projects, '공통', { id: 'b' })).toThrow('다른 프로젝트');
    expect(projectOf('공통 프로젝트 작업', [{ id: 'a', name: '공통', aliases: [] }, { id: 'b', name: '공통 프로젝트', aliases: [] }])).toBeNull();
  });
  it('표준 이름 변경도 프로젝트 ID와 원문을 유지한다', () => {
    const projects = [{ id: 'a', name: '이름', aliases: ['123플젝'] }];
    const rows = ['26.11.1', '123플젝 작업'].map(text => line(text));
    const registered = setSchedule(rows, rows[1].id, true);
    projects[0].name = '새 이름';
    expect(eventsOf(registered, projects)[0]).toMatchObject({ projectId: 'a', project: '새 이름', text: '123플젝 작업' });
  });
});

describe('기간 표기 및 이전 저장 데이터 이관', () => {
  it.each(['261101~~~1103', '26/11/1~11/3', '20261101~20261103'])('%s는 26.11.1~26.11.3으로 표시하고 원문은 보존한다', text => {
    expect(parsePeriod(text)?.label).toBe('26.11.1~26.11.3');
    expect(displayText(text)).toBe('26.11.1~26.11.3');
    const rows = [line(text), line('작업')];
    const events = eventsOf(setSchedule(rows, rows[1].id, true));
    expect(events[0].end.iso).toBe('2026-11-03');
    expect(rows[0].text).toBe(text);
    expect(displayText(`작업 [${text}]`)).toBe('작업 [26.11.1~26.11.3]');
  });
  it.each(['261101~~~1031', '261201~0101', '260229~0301', '261101~1131'])('유효하지 않거나 연도 추측이 필요한 %s를 변환하지 않는다', text => {
    expect(parsePeriod(text)).toBeNull(); expect(displayText(text)).toBe(text);
  });
  it('schema 1을 반복 읽어도 원문/ID/완료/고정/기존 일정이 보존된다', () => {
    const old = { schema: 1, revision: 'old', updatedAt: '2026-11-13T00:00:00Z', lines: ['지식', '261101', 'A프로젝트 작업', '참고: 자료', '일반 문장'].map((text, i) => ({ id: String(i), text, done: i === 2, pinned: i === 1 })) };
    const raw = JSON.stringify(old);
    const migrated = readBackup(raw);
    expect(migrated.schema).toBe(2);
    expect(readBackup(raw)).toEqual(migrated);
    expect(migrated.lines.map(({ schedule: _schedule, ...row }) => row)).toEqual(old.lines);
    expect(eventsOf(migrated.lines, migrated.projects)).toHaveLength(2);
    expect(migrated.projects[0].name).toBe('A프로젝트');
    const next = makeNote([...migrated.lines, line('새 메모')], migrated.projects);
    const map = new Map([[STORAGE_KEY, raw]]);
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
    saveNote(next, 'old', storage);
    expect(map.get(MIGRATION_KEY)).toBe(raw);
    expect(eventsOf(loadNote(storage)!.lines)).toHaveLength(2);
    expect(readBackup(JSON.stringify(next))).toEqual(next);
  });
  it('schema 2 백업은 등록/미등록/별칭을 보존하며 끊어진 참조를 거부한다', () => {
    const rows = ['26.11.1', '123플젝 작업', '등록하지 않은 메모'].map(text => line(text));
    const note = makeNote(setSchedule(rows, rows[1].id, true), addProjectAlias([], '123플젝', { name: '123프로젝트' }));
    expect(readBackup(JSON.stringify(note))).toEqual(note);
    note.lines[1].schedule = { groupId: 'missing' };
    expect(() => readBackup(JSON.stringify(note))).toThrow('날짜 줄');
  });
});
