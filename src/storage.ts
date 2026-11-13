import { MAX_BACKUP_BYTES, type Note, readBackup, validateNote } from './model';
export const STORAGE_KEY = 'daynote.v1';
export const RECOVERY_KEY = 'daynote.before-import.v1';
export function loadNote(storage: Pick<Storage, 'getItem'> = localStorage): Note | null {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === null ? null : readBackup(raw);
}
export function saveNote(note: Note, expectedRevision: string | null, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  validateNote(note);
  const current = loadNote(storage);
  if ((current?.revision ?? null) !== expectedRevision) throw new Error('다른 창에서 메모가 변경됐습니다. 이 창의 내용을 백업한 뒤 새로고침하세요.');
  const raw = JSON.stringify(note);
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw new Error('메모가 2MB를 넘었습니다. 백업 후 내용을 나눠 보관하세요.');
  try { storage.setItem(STORAGE_KEY, raw); } catch { throw new Error('기기에 저장하지 못했습니다. 저장 공간을 확인하고 지금 백업을 내려받으세요.'); }
}
