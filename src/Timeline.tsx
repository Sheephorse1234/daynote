import { useMemo, useRef, useState } from 'react';
import { eventsOf, type Line } from './model';
const DAY = 86_400_000;
function todayUTC() { const now = new Date(); return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()); }
function dateLabel(stamp: number) { const date = new Date(stamp); return `${date.getUTCMonth() + 1}.${date.getUTCDate()}`; }
export default function Timeline({ lines, onOpen }: { lines: Line[]; onOpen: () => void }) {
  const events = useMemo(() => eventsOf(lines), [lines]);
  const projects = useMemo(() => [...new Set(events.map(event => event.project).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'ko')), [events]);
  const [selected, select] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [toast, setToast] = useState<{ text: string; y: number } | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const choices = [null, ...projects];
  const actual = selected && projects.includes(selected) ? selected : null;
  const filtered = events.filter(event => !actual || event.project === actual);
  const start = anchor ?? filtered[0]?.start.stamp ?? todayUTC();
  const end = start + (windowDays - 1) * DAY;
  const visible = filtered.filter(event => event.start.stamp <= end && event.end.stamp >= start);
  function scrub(y: number) {
    const rect = rail.current!.getBoundingClientRect();
    const index = Math.max(0, Math.min(choices.length - 1, Math.floor((y - rect.top) / rect.height * choices.length)));
    select(choices[index]); setAnchor(null);
    setToast({ text: choices[index] ?? '전체 종합일정', y: Math.max(60, Math.min(window.innerHeight - 60, y)) });
  }
  return <section className="schedule" aria-label="일정 타임라인">
    <div className="section-heading"><div><p className="eyebrow">TIMELINE</p><h1>{actual ?? '전체 종합일정'}</h1><p className="muted">{filtered.length}개 일정 · ◆ 하루 일정 · ━ 명시한 기간</p></div></div>
    <div className="timeline-controls">
      <div className="period-controls"><button aria-label="이전 기간" onClick={() => setAnchor(start - windowDays * DAY)}>←</button><button onClick={() => setAnchor(todayUTC())}>오늘</button><button aria-label="다음 기간" onClick={() => setAnchor(start + windowDays * DAY)}>→</button><button onClick={() => setAnchor(null)}>첫 일정</button></div>
      <select aria-label="표시 기간" value={windowDays} onChange={event => setWindowDays(+event.target.value)}><option value={14}>2주</option><option value={30}>한 달</option><option value={90}>3개월</option></select>
    </div>
    <p className="range-label">{new Date(start).getUTCFullYear()}년 {dateLabel(start)} — {new Date(end).getUTCFullYear()}년 {dateLabel(end)}</p>
    <div className="timeline-scroll" data-no-swipe="true">
      <div className="timeline-table" style={{ minWidth: windowDays === 90 ? 900 : 640 }}>
        <div className="timeline-head"><span>메모에서 가져온 일정</span><div className="axis">{Array.from({ length: 6 }, (_, i) => <span key={i} style={{ left: `${i * 20}%` }}>{dateLabel(start + Math.round((windowDays - 1) * i / 5) * DAY)}</span>)}</div></div>
        {visible.map(event => {
          const left = (Math.max(event.start.stamp, start) - start) / (windowDays * DAY) * 100;
          const width = (Math.min(event.end.stamp + DAY, end + DAY) - Math.max(event.start.stamp, start)) / (windowDays * DAY) * 100;
          const milestone = event.start.stamp === event.end.stamp;
          return <div className={`timeline-row ${event.done ? 'finished' : ''}`} key={event.id}>
            <div className="event-text"><span>{event.text}</span><small>{event.project ?? '프로젝트 미지정'} · {event.start.label}{!milestone ? ` — ${event.end.label}` : ''}{event.done ? ' · 완료' : ''}</small>{event.warning && <small className="warning">{event.warning}</small>}</div>
            <div className="track" aria-label={`${milestone ? '하루 일정' : '기간 일정'} ${event.start.label}${milestone ? '' : `부터 ${event.end.label}까지`}`}>
              {todayUTC() >= start && todayUTC() <= end && <span className="today-marker" style={{ left: `${(todayUTC() - start) / (windowDays * DAY) * 100}%` }} />}
              <span className={milestone ? 'milestone' : 'duration-bar'} title={`${event.text}: ${event.start.label} — ${event.end.label}`} style={{ left: `${left}%`, width: milestone ? undefined : `${width}%` }}>{milestone ? '◆' : ''}</span>
            </div>
          </div>;
        })}
      </div>
    </div>
    {!visible.length && <div className="empty-state"><h2>{events.length ? '이 기간에는 일정이 없어요' : '메모가 일정이 되는 곳'}</h2><p>{events.length ? '첫 일정 또는 다른 기간을 선택해보세요.' : '메모에 날짜를 한 줄 적고, 아래에 할 일을 적어보세요.'}</p><button onClick={onOpen}>메모로 가기</button></div>}
    <p className="timeline-footnote">일정은 메모를 고치면 함께 바뀝니다. 오른쪽 막대를 위아래로 쓸어 프로젝트를 이동하세요.</p>
    <div className="project-rail" role="navigation" aria-label="프로젝트 빠른 이동" ref={rail} data-no-swipe="true"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); scrub(event.clientY); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event.clientY); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setToast(null); }}
      onPointerCancel={() => setToast(null)} onLostPointerCapture={() => setToast(null)}>
      {choices.map((project, index) => <button key={project ?? '__all'} className={actual === project ? 'selected' : ''} aria-label={project ?? '전체 종합일정'} aria-current={actual === project ? 'page' : undefined}
        onClick={event => { if (event.detail === 0) { select(project); setAnchor(null); } }} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); select(choices[next]); setAnchor(null); (rail.current?.children[next] as HTMLElement)?.focus(); }
        }}><span /></button>)}
    </div>
    {toast && <div className="project-toast" style={{ top: toast.y }} role="status">{toast.text}</div>}
  </section>;
}
