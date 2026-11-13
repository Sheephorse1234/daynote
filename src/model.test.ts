import { describe, expect, it } from 'vitest';
import { eventsOf, groupsOf, line, makeNote, parseDate, plainText, projectOf, readBackup, sortedGroups, splitLine } from './model';
import { loadNote, saveNote, STORAGE_KEY } from './storage';

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
    const first = eventsOf(lines);
    expect(first).toHaveLength(2);
    expect(eventsOf(lines)).toEqual(first);
    expect(new Set(first.map(event => event.id)).size).toBe(2);
    expect(first[0].start).toEqual(first[0].end);
    lines[1].text = '26.11.2';
    expect(eventsOf(lines).map(event => event.start.iso)).toEqual(['2026-11-02', '2026-11-02']);
  });
  it('프로젝트를 추론하거나 다음 줄로 전파하지 않는다', () => {
    expect(projectOf('A프로젝트 설계')).toBe('A프로젝트');
    expect(projectOf('[프로젝트: 우리 집] 도배')).toBe('우리 집');
    expect(projectOf('프로젝트에 대한 이야기')).toBeNull();
    const rows = ['26.11.1', 'A프로젝트 작업', '다음 작업'].map(text => line(text));
    expect(eventsOf(rows).find(event => event.text === '다음 작업')?.project).toBeNull();
  });
  it('명시한 유효 기간만 사용하고 역전·잘못된 기간에는 경고한다', () => {
    const rows = ['26.11.1', 'A프로젝트 [26.11.1~26.11.5]', '오류 [26.11.5~26.11.1]', '오류 [26.2.30~26.3.1]', '오류 [다음주~다다음주]', '준비 5일'].map(text => line(text));
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
  it('원문, 고정, 완료를 왕복 복구한다', () => expect(readBackup(JSON.stringify(sample()))).toEqual(expect.objectContaining({ schema: 1, lines: expect.arrayContaining([expect.objectContaining({ text: '26/11.1' }), expect.objectContaining({ done: true, pinned: true })]) })));
  it('손상, 미지원 버전, 중복 ID, 숨겨진 줄바꿈, 과대 파일을 거부한다', () => {
    expect(() => readBackup('{')).toThrow();
    expect(() => readBackup(JSON.stringify({ ...sample(), schema: 2 }))).toThrow();
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
