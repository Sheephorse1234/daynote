import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { groupsOf, line, displayText, parseHeading, sortedGroups, splitLine, type Line } from './model';

type Props = { lines: Line[]; disabled: boolean; onChange: (lines: Line[]) => void; onUndo: () => void; onRedo: () => void; onNotice: (text: string) => void; onSchedule: (id: string, enabled: boolean) => void; onProject: (id: string, text: string) => void };
export default function Editor({ lines, disabled, onChange, onUndo, onRedo, onNotice, onSchedule, onProject }: Props) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; text: string; left: number; top: number } | null>(null);
  const selectionBlockedUntil = useRef(0);
  const [focused, setFocused] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ id: string; caret: number } | null>(null);
  const composing = useRef(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ id: string; x: number; y: number; pointer: number; moved: boolean; fired: boolean; heading: boolean } | null>(null);
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
  }, [lines, focused]);
  useEffect(() => () => clearTimeout(longPress.current), []);
  const cancelTimer = () => clearTimeout(longPress.current);
  function openMenu(id: string, selectedOnly = false) {
    if (disabled || composing.current || Date.now() < Math.max(blockUntil.current, selectionBlockedUntil.current)) return;
    const input = elements.current.get(id), row = current.current.lines.find(item => item.id === id);
    if (!input || !row || parseHeading(row.text) || !row.text.trim()) return;
    const selected = input.value.slice(input.selectionStart, input.selectionEnd).trim();
    if (selectedOnly && !selected) return;
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
    const top = Math.max((viewport?.offsetTop ?? 0) + 8, Math.min(rect.bottom + 5, bottom - 64));
    setContextMenu({ id, text: selected, left: Math.max(8, Math.min(rect.left, window.innerWidth - 290)), top });
  }
  useEffect(() => {
    const dismiss = (event: Event) => { if (event.type !== 'pointerdown' || !root.current?.contains(event.target as Node)) setContextMenu(null); };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); };
  }, []);
  function insert(row: Line, start: number, end: number, text: string) {
    setContextMenu(null);
    const result = splitLine(lines, row.id, start, end, text);
    const newIds = result.lines.filter(item => !byId.has(item.id)).map(item => item.id);
    const ids = displayed.map(item => item.id), at = ids.indexOf(row.id);
    ids.splice(at + 1, 0, ...newIds); setOrder(ids);
    onChange(result.lines); focus(result.focusId, result.caret);
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>, row: Line) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { setContextMenu(null); return; }
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') { event.preventDefault(); openMenu(row.id); return; }
    const input = event.currentTarget, start = input.selectionStart, end = input.selectionEnd;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? onRedo() : onUndo(); return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onChange(lines.map(item => item.id === row.id ? parseHeading(row.text) ? { ...item, pinned: !item.pinned } : { ...item, done: !item.done } : item));
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
    cancelTimer(); setContextMenu(null);
    press.current = { id: row.id, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false, fired: false, heading: !!parseHeading(row.text) };
    longPress.current = setTimeout(() => {
      const gesture = press.current;
      if (!gesture || gesture.moved || current.current.disabled) return;
      gesture.fired = true;
      if (!gesture.heading) { lastTap.current = null; openMenu(gesture.id); return; }
      setContextMenu(null); selectionBlockedUntil.current = Date.now() + 1000;
      blockUntil.current = Date.now() + 1000;
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
    if (gesture.fired) { event.preventDefault(); event.stopPropagation(); if (gesture.heading) blockUntil.current = Date.now() + 650; return; }
    if (gesture.moved || disabled) return;
    const row = lines.find(item => item.id === gesture.id);
    if (!row || parseHeading(row.text) || !row.text.trim()) return;
    const input = elements.current.get(row.id);
    const previous = lastTap.current, now = Date.now();
    if (previous && previous.id === row.id && now - previous.time < 320 && Math.hypot(previous.x - event.clientX, previous.y - event.clientY) < 24) {
      event.preventDefault(); lastTap.current = null; setContextMenu(null); selectionBlockedUntil.current = Date.now() + 400;
      onChange(lines.map(item => item.id === row.id ? { ...item, done: !item.done } : item));
      onNotice(row.done ? '완료를 취소했습니다.' : '이 줄을 완료했습니다.');
    } else if (!input || input.selectionStart === input.selectionEnd) lastTap.current = { id: row.id, time: now, x: event.clientX, y: event.clientY };
  }
  return <div ref={root} className="editor" aria-label="자유 메모 편집기"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOrder(null); setFocused(null); setContextMenu(null); } }}
    onClickCapture={event => { if (Date.now() < blockUntil.current) { event.preventDefault(); event.stopPropagation(); (document.activeElement as HTMLElement)?.blur(); } }}
    onPointerDownCapture={event => { if (Date.now() < blockUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerMove={event => { const gesture = press.current; if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) { gesture.moved = true; cancelTimer(); } }}
    onPointerUpCapture={pointerUp} onPointerCancel={() => { cancelTimer(); press.current = null; lastTap.current = null; }}>
    {displayed.map((row, index) => {
      const day = parseHeading(row.text);
      const nextContent = displayed.slice(index + 1).find(item => item.text.trim());
      const separator = !row.text.trim() && nextContent && parseHeading(nextContent.text) && focused !== row.id;
      return <div key={row.id} className={`note-line ${day ? 'date-line' : ''} ${day && index > 0 ? 'group-gap' : ''} ${row.done && !day ? 'done' : ''} ${separator ? 'collapsed-blank' : ''}`}>
        {row.id === freeStart && lines.some(item => parseHeading(item.text)) && <p className="free-label">자유 메모</p>}
        {day && row.pinned && <span className="pin-dot" title="상단 고정" aria-label="상단 고정">●</span>}
        <textarea ref={element => { if (element) elements.current.set(row.id, element); else elements.current.delete(row.id); }}
          aria-label={day ? `날짜 ${day.label}` : `메모 ${index + 1}`} rows={1} spellCheck={false} readOnly={disabled}
          value={focused !== row.id ? displayText(row.text) : row.text}
          placeholder={lines.length === 1 ? '날짜나 생각을 적어보세요…' : ''}
          onFocus={() => { if (Date.now() < blockUntil.current) { elements.current.get(row.id)?.blur(); return; } if (!order) setOrder(displayed.map(item => item.id)); setFocused(row.id); setContextMenu(null); }}
          onChange={event => { setContextMenu(null); const text = event.target.value; if (text.includes('\n')) insert(row, 0, row.text.length, text); else onChange(lines.map(item => item.id === row.id ? { ...item, text } : item)); }}
          onKeyDown={event => keyDown(event, row)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onPaste={event => { event.preventDefault(); insert(row, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.clipboardData.getData('text/plain')); }}
          onPointerDown={event => pointerDown(event, row)}
          onSelect={() => openMenu(row.id, true)}
          onContextMenu={event => { event.preventDefault(); if (!day) openMenu(row.id); }}
          onDoubleClick={event => { event.preventDefault(); setContextMenu(null); selectionBlockedUntil.current = Date.now() + 400; }} />
      </div>;
    })}
    {contextMenu && !disabled && byId.has(contextMenu.id) && <div className="task-menu" role="toolbar" aria-label="태스크 메뉴" data-no-swipe="true" style={{ left: contextMenu.left, top: contextMenu.top }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}>
      <button onClick={() => { onSchedule(contextMenu.id, !byId.get(contextMenu.id)!.schedule); setContextMenu(null); }}>{byId.get(contextMenu.id)!.schedule ? '일정에서 해제' : '일정에 추가'}</button>
      {contextMenu.text && <button onClick={() => { onProject(contextMenu.id, contextMenu.text); setContextMenu(null); }}>프로젝트</button>}
    </div>}
    <button className="write-more" disabled={disabled} onClick={() => {
      const added = line();
      const after = lines.findIndex(row => row.id === displayed.at(-1)?.id) + 1;
      onChange([...lines.slice(0, after), added, ...lines.slice(after)]);
      setOrder([...displayed.map(row => row.id), added.id]); focus(added.id, 0);
    }}>계속 쓰기 <span aria-hidden="true">↵</span></button>
  </div>;
}
