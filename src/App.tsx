import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import Editor from './Editor';
import Timeline from './Timeline';
import { line, makeNote, MAX_BACKUP_BYTES, plainText, readBackup, type Line, type Note } from './model';
import { loadNote, RECOVERY_KEY, saveNote, STORAGE_KEY } from './storage';

function initial() {
  try { const stored = loadNote(); return { note: stored ?? makeNote([line()]), revision: stored?.revision ?? null, error: '' }; }
  catch (error) { return { note: makeNote([line()]), revision: null, error: `저장된 메모를 열 수 없습니다. 원본을 덮어쓰지 않았습니다. ${String(error)}` }; }
}
function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function backupName() { return `하루결-${new Date().toISOString().replace(/[:.]/g, '-')}.backup.json`; }
export default function App() {
  const [boot] = useState(initial);
  const [note, setNote] = useState(boot.note);
  const noteRef = useRef(note);
  const savedRevision = useRef(boot.revision);
  const [error, setError] = useState(boot.error);
  const [view, setView] = useState<'memo' | 'schedule'>('memo');
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState('');
  const [lock, setLock] = useState<'loading' | 'owned' | 'other'>('loading');
  const [online, setOnline] = useState(navigator.onLine);
  const [importing, setImporting] = useState<{ note: Note; previous: string | null } | null>(null);
  const [fileError, setFileError] = useState('');
  const [history, setHistory] = useState<Line[][]>([]);
  const [future, setFuture] = useState<Line[][]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{ x: number; y: number; time: number } | null>(null);
  const [pwaError, setPwaError] = useState('');
  const { offlineReady: [offlineReady], needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError: () => setPwaError('오프라인 준비에 실패했습니다. 인터넷 연결 후 다시 열어주세요.'),
    onRegisteredSW: (_url, registration) => {
      // Check when returning to a long-lived home-screen app, without interrupting editing.
      const check = () => { if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update().catch(() => {}); };
      document.addEventListener('visibilitychange', check);
    }
  });
  useEffect(() => {
    if (!navigator.locks) { setLock('owned'); return; }
    let disposed = false;
    let release: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const acquire = () => { void navigator.locks.request('daynote-writer:v1', { ifAvailable: true }, async held => {
      if (disposed) return;
      if (!held) { setLock('other'); retry = setTimeout(acquire, 1000); return; }
      // Reload after acquiring the lock, so an old view can never overwrite a newer session.
      try { const current = loadNote(); if (current) { noteRef.current = current; setNote(current); savedRevision.current = current.revision; } setError(''); } catch { /* initial() shows recovery guidance */ }
      setLock('owned');
      await new Promise<void>(resolve => { release = resolve; if (disposed) resolve(); });
    }).catch(() => { if (!disposed) setLock('other'); }); };
    acquire();
    return () => { disposed = true; clearTimeout(retry); release?.(); };
  }, []);
  useEffect(() => {
    const network = () => setOnline(navigator.onLine);
    const changed = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY || event.key === null) setError('다른 창에서 저장 내용이 변경됐습니다. 필요한 내용을 백업한 뒤 새로고침하세요.');
    };
    window.addEventListener('online', network); window.addEventListener('offline', network); window.addEventListener('storage', changed);
    return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); window.removeEventListener('storage', changed); };
  }, []);
  useEffect(() => { if (menu) dialog.current?.showModal(); else dialog.current?.close(); }, [menu]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2400); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (error) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [error]);
  function write(lines: Line[], track = true) {
    if (lock !== 'owned' || error) return;
    const previous = noteRef.current;
    const next = makeNote(lines.length ? lines : [line()]);
    if (track) { setHistory(items => [...items.slice(-29), previous.lines]); setFuture([]); }
    noteRef.current = next; setNote(next);
    try { saveNote(next, savedRevision.current); savedRevision.current = next.revision; }
    catch (failure) { setError((failure as Error).message); }
  }
  function undo() {
    if (!history.length || error) return;
    const last = history.at(-1)!; setHistory(history.slice(0, -1)); setFuture(items => [...items, noteRef.current.lines]); write(last, false);
  }
  function redo() {
    if (!future.length || error) return;
    const next = future.at(-1)!; setFuture(future.slice(0, -1)); setHistory(items => [...items, noteRef.current.lines]); write(next, false);
  }
  async function readFile(file?: File) {
    setFileError(''); setImporting(null);
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('2MB 이하의 백업 파일을 선택하세요.');
      const imported = readBackup(await file.text());
      setImporting({ note: imported, previous: localStorage.getItem(STORAGE_KEY) });
    } catch (failure) { setFileError((failure as Error).message); }
  }
  function restore() {
    if (!importing || lock !== 'owned') return;
    try {
      if (localStorage.getItem(STORAGE_KEY) !== importing.previous) throw new Error('가져오기 준비 중 원본이 바뀌었습니다. 파일을 다시 선택하세요.');
      // Preserve the actual persisted source, even if it was corrupt. Do not overwrite it if this fails.
      if (importing.previous !== null) localStorage.setItem(RECOVERY_KEY, importing.previous);
      const next = makeNote(importing.note.lines);
      const raw = JSON.stringify(next);
      if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw new Error('가져올 데이터가 너무 큽니다.');
      localStorage.setItem(STORAGE_KEY, raw);
      noteRef.current = next; setNote(next); savedRevision.current = next.revision;
      setError(''); setHistory([]); setFuture([]); setImporting(null); setMenu(false); setNotice('백업을 복구했습니다.');
    } catch (failure) { setFileError(`가져오지 못했습니다. 기존 메모를 유지합니다. ${(failure as Error).message}`); }
  }
  const readOnly = lock !== 'owned' || !!error;
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); setView('memo'); }}><span className="brand-symbol" aria-hidden="true">≋</span>하루결<span className="version">V1</span></a>
      <nav className="view-tabs" aria-label="메인 화면"><button className={view === 'memo' ? 'active' : ''} aria-pressed={view === 'memo'} onClick={() => setView('memo')}>메모</button><button className={view === 'schedule' ? 'active' : ''} aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>일정</button></nav>
      <button className="menu-button" onClick={() => setMenu(true)} aria-label="백업과 사용법">···</button>
    </header>
    <div className="status-line"><span className={`status-dot ${error ? 'error-dot' : ''}`} /><span role="status">{error ? '저장 확인 필요' : lock === 'other' ? '다른 창에서 편집 중 · 읽기 전용' : lock === 'loading' ? '메모 여는 중…' : savedRevision.current ? '이 기기에 저장됨' : '이 기기에 자동 저장'}</span><span className="connection">{online ? '로컬 우선' : '오프라인'}</span></div>
    {error && <div className="alert" role="alert"><p>{error}</p><button onClick={() => download(backupName(), JSON.stringify(noteRef.current))}>현재 화면 백업</button><button onClick={() => setMenu(true)}>복구 메뉴</button></div>}
    {lock === 'other' && <div className="alert">다른 하루결 창을 닫으면 잠시 후 편집할 수 있습니다.</div>}
    {pwaError && <div className="alert">{pwaError}</div>}
    {needRefresh && <div className="update-banner">새 버전이 준비됐어요. <button disabled={readOnly} onClick={() => void updateServiceWorker(true).catch(() => setPwaError('업데이트에 실패했습니다. 연결 후 다시 시도하세요.'))}>저장된 메모로 업데이트</button></div>}
    <main onTouchStart={event => {
      const target = event.target as HTMLElement;
      if (event.touches.length !== 1 || target.closest('textarea,button,input,select,[data-no-swipe]')) { swipe.current = null; return; }
      const touch = event.touches[0]; swipe.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }} onTouchEnd={event => {
      const start = swipe.current; swipe.current = null; if (!start || !event.changedTouches.length) return;
      const touch = event.changedTouches[0], dx = touch.clientX - start.x, dy = touch.clientY - start.y;
      if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - start.time < 700) setView(dx < 0 ? 'schedule' : 'memo');
    }} onTouchCancel={() => { swipe.current = null; }}>
      {view === 'memo' ? <section className="memo-section"><div className="section-heading"><div><p className="eyebrow">YOUR EVERYDAY NOTES</p><h1>생각은 자유롭게,<br className="mobile-break" /> 일정은 자연스럽게.</h1><p className="muted">날짜 아래 할 일을 적어보세요.</p></div><div className="history-actions"><button disabled={!history.length || readOnly} onClick={undo} aria-label="실행 취소">↶</button><button disabled={!future.length || readOnly} onClick={redo} aria-label="다시 실행">↷</button></div></div>
        <Editor lines={note.lines} disabled={readOnly} onChange={write} onUndo={undo} onRedo={redo} onNotice={setNotice} />
        {note.lines.length === 1 && !note.lines[0].text && <div className="starter"><p><strong>261101</strong> 입력 후 Enter.<br />그 아래 적은 한 줄이 하나의 일정이 됩니다.</p><button disabled={readOnly} onClick={() => write(['26.11.20', 'A프로젝트 검토 회의', 'A프로젝트 상세설계 [26.11.16~26.11.20]', '26.11.13', 'B프로젝트 자료 전달', '참고: 회의 전 공유할 내용 정리'].map(text => line(text)))}>예시 넣어보기</button></div>}
        <div className="memo-hint">날짜 꾹 눌러 고정 · 할 일 두 번 눌러 완료<br /><span>빈 여백을 왼쪽으로 쓸면 일정으로 이동합니다.</span></div>
      </section> : <Timeline lines={note.lines} onOpen={() => setView('memo')} />}
    </main>
    <footer>나의 기록, 나의 기기에.<span>{offlineReady ? '오프라인 사용 준비 완료' : '하루결 · 메모와 일정'}</span></footer>
    {notice && <div className="notice" role="status">{notice}</div>}
    <dialog ref={dialog} onCancel={() => setMenu(false)} onClose={() => setMenu(false)}>
      <div className="dialog-heading"><h2>백업과 사용법</h2><button aria-label="닫기" onClick={() => setMenu(false)}>×</button></div>
      <p>메모는 현재 기기와 이 웹 주소에만 저장됩니다. 기기 간 자동 동기화는 하지 않습니다.</p>
      <div className="backup-actions"><button className="primary" onClick={() => { download(backupName(), JSON.stringify(noteRef.current)); setNotice('백업 파일을 다운로드했습니다. 파일 앱에서 확인하세요.'); }}>전체 백업 내려받기</button><button onClick={() => download('하루결-메모.txt', plainText(note.lines), 'text/plain')}>읽기용 텍스트</button><button onClick={() => download('하루결-원문.txt', plainText(note.lines, true), 'text/plain')}>입력 원문 텍스트</button></div>
      <p className="small">전체 백업에는 원문·완료·고정 정보가 포함됩니다. 파일 앱이나 본인 저장 공간에 보관하세요. 브라우저 데이터 삭제·저장 공간 정리로 메모가 사라질 수 있습니다.</p>
      <label className="file-label">백업 파일 가져오기<input type="file" accept=".json,application/json" disabled={lock !== 'owned'} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
      {fileError && <p className="warning" role="alert">{fileError}</p>}
      {importing && <div className="import-preview"><strong>{importing.note.lines.length}줄의 메모를 확인했습니다.</strong><p>현재 메모를 이 백업으로 교체합니다. 먼저 전체 백업을 내려받으세요. 교체 직전 저장본도 기기에 한 개 남깁니다.</p><button className="primary" onClick={restore}>이 백업으로 교체</button><button onClick={() => setImporting(null)}>취소</button></div>}
      <div className="recovery-actions"><button onClick={() => { try { const raw = localStorage.getItem(RECOVERY_KEY); if (!raw) { setFileError('교체 직전 저장본이 아직 없습니다.'); return; } download('하루결-교체직전.backup.json', raw); } catch { setFileError('저장소를 열 수 없습니다.'); } }}>교체 직전 저장본 받기</button><button onClick={() => { try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) download('하루결-저장원본.backup.json', raw); else setFileError('저장된 원본이 없습니다.'); } catch { setFileError('저장소를 열 수 없습니다.'); } }}>저장소 원본 받기</button></div>
      <details><summary>입력과 조작 방법</summary><ul><li>날짜만 한 줄: 261101, 20261101, 26/11.1, 26/11/1, 26-11-1, 26.11.1 → 26.11.1. 2000~2099년만 인식합니다.</li><li>입력 중에는 원문을 보여줍니다. Enter 또는 편집을 마치면 날짜가 정리됩니다. 원문은 전체 백업에 남습니다.</li><li>날짜를 0.5초 누르면 해당 날짜부터 다음 날짜 전까지 함께 고정됩니다. 할 일 두 번 누르기는 그 줄만 완료합니다.</li><li>날짜 위의 자유 메모와 ‘참고:’로 시작하는 줄은 일정에 넣지 않습니다. 날짜 아래 다른 줄은 할 일로 봅니다.</li><li>프로젝트: A프로젝트 또는 [프로젝트: 우리 집 수리]. 각 태스크 줄에 직접 적으세요.</li><li>기간: [26.11.1~26.11.5]. 기간이 없으면 하루 일정입니다. 일정 수정은 메모에서 합니다.</li><li>줄바꿈은 Enter. 같은 그룹 안에서 줄 앞 Backspace로 이전 줄과 합칩니다. 여러 줄을 붙여넣을 수 있습니다. 줄을 넘는 드래그 선택은 V1에서 지원하지 않습니다.</li><li>⌘/Ctrl+Z 실행 취소, Shift를 함께 누르면 다시 실행. ⌘/Ctrl+Enter는 날짜 고정 또는 줄 완료입니다.</li><li>빈 여백을 좌우로 쓸어 화면을 바꿉니다. 텍스트 선택과 타임라인 가로 스크롤은 그대로 사용할 수 있습니다.</li></ul></details>
      <details><summary>아이패드에 설치 · 업데이트</summary><p>배포된 HTTPS 주소를 Safari로 열고 공유 → 홈 화면에 추가를 누르세요. ‘웹 앱으로 열기’가 있으면 켭니다. 홈 화면 앱을 인터넷 연결 상태에서 한 번 열고 오프라인 준비 완료를 확인하세요.</p><p>새 버전 안내가 뜨면 업데이트 버튼을 누르세요. 주소를 바꾸거나 앱을 지우기 전에는 백업하세요. 앱 실행에는 Apple 유료 개발자 가입이 필요하지 않습니다.</p></details>
      <button onClick={() => { if (navigator.storage?.persist) void navigator.storage.persist().then(granted => setNotice(granted ? '브라우저의 저장 유지가 허용됐습니다. 백업도 보관하세요.' : '저장 유지가 보장되지 않습니다. 백업을 보관하세요.')).catch(() => setNotice('저장 유지 요청을 지원하지 않습니다.')); else setNotice('이 브라우저는 저장 유지 요청을 지원하지 않습니다.'); }}>기기 저장 유지 요청</button>
    </dialog>
  </div>;
}
