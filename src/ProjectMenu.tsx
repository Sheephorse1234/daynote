import { useEffect, useRef, useState } from 'react';
import type { Project } from './model';

export default function ProjectMenu({ expression, projects, onClose, onSave }: {
  expression: string;
  projects: Project[];
  onClose: () => void;
  onSave: (target: { id: string } | { name: string }) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState('');
  const [name, setName] = useState(expression);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="project-dialog" aria-label="프로젝트 표현 등록" onCancel={onClose} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      try { onSave(target ? { id: target } : { name }); }
      catch (failure) { setError((failure as Error).message); }
    }}>
      <div className="dialog-heading"><h2>프로젝트</h2><button type="button" aria-label="닫기" onClick={onClose}>×</button></div>
      <p>선택한 표현: <strong>{expression}</strong></p>
      <label>연결할 프로젝트<select aria-label="연결할 프로젝트" value={target} onChange={event => { setTarget(event.target.value); setError(''); }}>
        <option value="">새 프로젝트</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      {!target && <label>표준 프로젝트명<input aria-label="표준 프로젝트명" value={name} maxLength={100} onChange={event => setName(event.target.value)} required /></label>}
      <p className="small">메모 표현은 그대로 둡니다. 일정 등록은 별도로 ‘일정에 추가’를 누르세요.</p>
      {error && <p className="warning" role="alert">{error}</p>}
      <button className="primary" type="submit">등록</button>
    </form>
  </dialog>;
}
