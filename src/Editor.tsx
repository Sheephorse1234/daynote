import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { groupsOf, line, parseDate, sortedGroups, splitLine, type Line } from './model';

type Props = { lines: Line[]; disabled: boolean; onChange: (lines: Line[]) => void; onUndo: () => void; onRedo: () => void; onNotice: (text: string) => void };
export default function Editor({ lines, disabled, onChange, onUndo, onRedo, onNotice }: Props) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ id: string; caret: number } | null>(null);
  const composing = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ id: string; x: number; y: number; pointer: number; moved: boolean; fired: boolean } | null>(null);
  const lastTap = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  const blockUntil = useRef(0);
  const current = useRef({ lines, onChange, disabled });
  current.current = { lines, onChange, disabled };
  const sorted = sortedGroups(lines).flatMap(group => [...(group.heading ? [group.heading] : []), ...group.lines]);
  const freeStart = groupsOf(lines).find(group => !group.heading)?.lines[0]?.id;
  const byId = new Map(lines.map(row => [row.id, row]));
  const displayed = order ? [...order.map(id => byId.get(id)).filter((row): row is Line => !!row), ...sorted.filter(row => !order.includes(row.id))] : sorted;
  const focus = (id: string, caret: number) => { pendingFocus.current = { id, caret }; setFocused(id); };
  useLayoutEffect(() => {
    for (const textarea of elements.current.values()) {
      textarea.style.height = '0px';
      textarea.style.height = `${Math.max(32, textarea.scrollHeight)}px`;
    }
    const next = pendingFocus.current;
    if (next) {
      const element = elements.current.get(next.id);
      element?.focus(); element?.setSelectionRange(next.caret, next.caret);
      pendingFocus.current = null;
    }
  });
  useEffect(() => () => clearTimeout(longPress.current), []);
  const cancelTimer = () => clearTimeout(longPress.current);
  function insert(row: Line, start: number, end: number, text: string) {
    const result = splitLine(lines, row.id, start, end, text);
    const newIds = result.lines.filter(item => !byId.has(item.id)).map(item => item.id);
    const ids = displayed.map(item => item.id), at = ids.indexOf(row.id);
    ids.splice(at + 1, 0, ...newIds); setOrder(ids);
    onChange(result.lines); focus(result.focusId, result.caret);
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>, row: Line) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? onRedo() : onUndo(); return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onChange(lines.map(item => item.id === row.id ? parseDate(row.text) ? { ...item, pinned: !item.pinned } : { ...item, done: !item.done } : item));
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); insert(row, start, end, '\n'); return; }
    const index = lines.findIndex(item => item.id === row.id);
    const displayIndex = displayed.findIndex(item => item.id === row.id);
    if (event.key === 'Backspace' && start === 0 && end === 0 && index > 0 && displayed[displayIndex - 1]?.id === lines[index - 1].id) {
      event.preventDefault(); const previous = lines[index - 1];
      onChange(lines.flatMap((item, i) => i === index ? [] : i === index - 1 ? [{ ...item, text: item.text + row.text }] : [item]));
      focus(previous.id, previous.text.length);
    } else if (event.key === 'Delete' && start === row.text.length && end === start && index < lines.length - 1 && displayed[displayIndex + 1]?.id === lines[index + 1].id) {
      event.preventDefault(); const next = lines[index + 1];
      onChange(lines.flatMap((item, i) => i === index + 1 ? [] : i === index ? [{ ...item, text: item.text + next.text }] : [item]));
      focus(row.id, start);
    } else if (event.key === 'ArrowUp' && start === 0 && displayed[displayIndex - 1]) {
      event.preventDefault(); const previous = displayed[displayIndex - 1]; focus(previous.id, previous.text.length);
    } else if (event.key === 'ArrowDown' && end === row.text.length && displayed[displayIndex + 1]) {
      event.preventDefault(); focus(displayed[displayIndex + 1].id, 0);
    }
  }
  function pointerDown(event: PointerEvent<HTMLTextAreaElement>, row: Line) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    cancelTimer();
    press.current = { id: row.id, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false, fired: false };
    if (!parseDate(row.text)) return;
    longPress.current = setTimeout(() => {
      const gesture = press.current;
      if (!gesture || gesture.moved || current.current.disabled) return;
      gesture.fired = true; blockUntil.current = Date.now() + 1000;
      // Capture on the stable parent before reordering. Release/click cannot land on a moved paragraph.
      root.current?.setPointerCapture(gesture.pointer);
      (document.activeElement as HTMLElement)?.blur();
      const rows = current.current.lines;
      const target = rows.find(item => item.id === gesture.id);
      current.current.onChange(rows.map(item => item.id === gesture.id ? { ...item, pinned: !item.pinned } : item));
      setOrder(null); setFocused(null);
      onNotice(target?.pinned ? '날짜 그룹의 고정을 해제했습니다.' : '날짜 그룹을 맨 위에 고정했습니다.');
    }, 500);
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    cancelTimer(); const gesture = press.current; press.current = null;
    if (!gesture) return;
    if (gesture.fired) { event.preventDefault(); event.stopPropagation(); blockUntil.current = Date.now() + 650; return; }
    if (gesture.moved || disabled) return;
    const row = lines.find(item => item.id === gesture.id);
    if (!row || parseDate(row.text) || !row.text.trim()) return;
    const previous = lastTap.current, now = Date.now();
    if (previous && previous.id === row.id && now - previous.time < 320 && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 24) {
      event.preventDefault(); lastTap.current = null;
      onChange(lines.map(item => item.id === row.id ? { ...item, done: !item.done } : item));
      onNotice(row.done ? '완료를 취소했습니다.' : '이 줄을 완료했습니다.');
    } else lastTap.current = { id: row.id, time: now, x: event.clientX, y: event.clientY };
  }
  return <div ref={root} className="editor" aria-label="자유 메모 편집기"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOrder(null); setFocused(null); } }}
    onClickCapture={event => { if (Date.now() < blockUntil.current) { event.preventDefault(); event.stopPropagation(); (document.activeElement as HTMLElement)?.blur(); } }}
    onPointerDownCapture={event => { if (Date.now() < blockUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerMove={event => { const gesture = press.current; if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) { gesture.moved = true; cancelTimer(); } }}
    onPointerUpCapture={pointerUp} onPointerCancel={() => { cancelTimer(); press.current = null; lastTap.current = null; }}>
    {displayed.map((row, index) => {
      const day = parseDate(row.text);
      const nextContent = displayed.slice(index + 1).find(item => item.text.trim());
      const separator = !row.text.trim() && nextContent && parseDate(nextContent.text) && focused !== row.id;
      return <div key={row.id} className={`note-line ${day ? 'date-line' : ''} ${day && index > 0 ? 'group-gap' : ''} ${row.done && !day ? 'done' : ''} ${separator ? 'collapsed-blank' : ''}`}>
        {row.id === freeStart && lines.some(item => parseDate(item.text)) && <p className="free-label">자유 메모</p>}
        {day && row.pinned && <span className="pin-dot" title="상단 고정" aria-label="상단 고정">●</span>}
        <textarea ref={element => { if (element) elements.current.set(row.id, element); else elements.current.delete(row.id); }}
          aria-label={day ? `날짜 ${day.label}` : `메모 ${index + 1}`} rows={1} spellCheck={false} readOnly={disabled}
          value={day && focused !== row.id ? day.label : row.text}
          placeholder={lines.length === 1 ? '날짜나 생각을 적어보세요…' : ''}
          onFocus={() => { if (Date.now() < blockUntil.current) { elements.current.get(row.id)?.blur(); return; } if (!order) setOrder(displayed.map(item => item.id)); setFocused(row.id); }}
          onChange={event => { const text = event.target.value; if (text.includes('\n')) insert(row, 0, row.text.length, text); else onChange(lines.map(item => item.id === row.id ? { ...item, text } : item)); }}
          onKeyDown={event => keyDown(event, row)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onPaste={event => { event.preventDefault(); insert(row, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.clipboardData.getData('text/plain')); }}
          onPointerDown={event => pointerDown(event, row)}
          onContextMenu={event => { if (day) event.preventDefault(); }}
          onDoubleClick={event => { event.preventDefault(); }} />
      </div>;
    })}
    <button className="write-more" disabled={disabled} onClick={() => {
      const added = line();
      const after = lines.findIndex(row => row.id === displayed.at(-1)?.id) + 1;
      onChange([...lines.slice(0, after), added, ...lines.slice(after)]);
      setOrder([...displayed.map(row => row.id), added.id]); focus(added.id, 0);
    }}>계속 쓰기 <span aria-hidden="true">↵</span></button>
  </div>;
}
