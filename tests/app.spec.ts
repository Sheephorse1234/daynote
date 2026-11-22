import { test, expect, type Page, type Locator } from '@playwright/test';

async function schedule(page: Page, row: Locator) {
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: '일정에 추가', exact: true }).click();
}
async function selectPrefix(page: Page, row: Locator, text: string) {
  const box = (await row.boundingBox())!;
  const width = await row.evaluate((element, value) => {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d')!;
    ctx.font = getComputedStyle(element).font;
    return ctx.measureText(value).width;
  }, text);
  await page.mouse.move(box.x + 1, box.y + 16); await page.mouse.down();
  await page.mouse.move(box.x + width + 2, box.y + 16, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole('button', { name: '프로젝트', exact: true })).toBeVisible();
}
async function createProject(page: Page, row: Locator, expression: string, name = expression) {
  await selectPrefix(page, row, expression);
  await page.getByRole('button', { name: '프로젝트', exact: true }).click();
  await page.getByRole('textbox', { name: '표준 프로젝트명' }).fill(name);
  await page.getByRole('button', { name: '등록', exact: true }).click();
}

test('입력, 날짜 정규화, 단일 줄 완료, 고정, 일정, 재실행 보존', async ({ page }) => {
  await page.goto('/');
  const first = page.getByRole('textbox').first();
  await expect(first).toBeEditable();
  await first.fill('261101'); await first.press('Enter');
  await expect(page.getByRole('textbox', { name: '날짜 26.11.1', exact: true })).toHaveValue('26.11.1');
  await page.locator('textarea:focus').fill('A프로젝트 설계'); await page.locator('textarea:focus').press('Enter');
  await page.locator('textarea:focus').fill('B프로젝트 검토'); await page.locator('textarea:focus').press('Enter');
  await page.locator('textarea:focus').fill('261120'); await page.locator('textarea:focus').press('Enter');
  await page.locator('textarea:focus').fill('A프로젝트 마감');
  await page.getByRole('heading', { level: 1 }).click();
  await schedule(page, page.locator('textarea').nth(1));
  await schedule(page, page.locator('textarea').nth(3));
  await schedule(page, page.locator('textarea').nth(4));
  await expect(page.getByRole('textbox').first()).toHaveValue('26.11.20');
  // Textarea values are inspected directly so this assertion does not depend on text-node rendering.
  const taskBox = page.locator('textarea').nth(3);
  await expect(taskBox).toHaveValue('A프로젝트 설계');
  await taskBox.dblclick({ delay: 100 });
  await expect(taskBox.locator('..')).toHaveClass(/done/);
  await expect(page.locator('.done')).toHaveCount(1);
  const heading = page.getByRole('textbox', { name: '날짜 26.11.1', exact: true });
  const box = (await heading.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 16); await page.mouse.down(); await page.waitForTimeout(580); await page.mouse.up();
  await expect(page.getByRole('textbox').first()).toHaveValue('26.11.1');
  await expect(page.locator('textarea:focus')).toHaveCount(0);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(3);
  await expect(page.locator('.milestone')).toHaveCount(3);
  await expect(page.locator('.duration-bar')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.done')).toHaveCount(1);
  await expect(page.locator('.pin-dot')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[0].text)).toBe('261101');
});

test('오프라인 재실행과 메모 저장', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByRole('textbox').first()).toBeEditable();
  await page.getByRole('textbox').first().fill('오프라인에도 보존');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('textbox').first()).toHaveValue('오프라인에도 보존');
  await page.getByRole('textbox').first().fill('연결 없이 수정'); await page.reload();
  await expect(page.getByRole('textbox').first()).toHaveValue('연결 없이 수정');
});

test('백업 내려받기와 검증 후 복구, 교체 전 데이터 보존', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('원본 데이터');
  await page.getByRole('button', { name: '백업과 사용법' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '전체 백업 내려받기' }).click();
  expect((await download).suggestedFilename()).toMatch(/backup.json$/);
  const backup = { schema: 1, revision: 'import', updatedAt: new Date().toISOString(), lines: [{ id: 'import-line', text: '복구한 메모', done: false, pinned: false }] };
  await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByText('1줄의 메모를 확인했습니다.')).toBeVisible();
  await page.getByRole('button', { name: '이 백업으로 교체' }).click();
  await expect(page.getByRole('textbox').first()).toHaveValue('복구한 메모');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.before-import.v1')!).lines[0].text)).toBe('원본 데이터');
});

test('오른쪽 스크럽은 즉시 프로젝트를 바꾸고 놓으면 이름이 사라진다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '예시 넣어보기' }).click();
  await createProject(page, page.locator('textarea').nth(1), 'A프로젝트');
  await createProject(page, page.locator('textarea').nth(4), 'B프로젝트');
  await schedule(page, page.locator('textarea').nth(1));
  await schedule(page, page.locator('textarea').nth(4));
  await page.getByRole('button', { name: '일정', exact: true }).click();
  const rail = page.getByRole('navigation', { name: '프로젝트 빠른 이동' });
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + 18, box.y + box.height - 3); await page.mouse.down();
  await expect(page.getByRole('heading', { name: 'B프로젝트', exact: true })).toBeVisible();
  await expect(page.locator('.project-toast')).toBeVisible();
  await page.mouse.move(box.x + 18, box.y + 3);
  await expect(page.getByRole('heading', { name: '전체 종합일정' })).toBeVisible();
  await page.mouse.up(); await expect(page.locator('.project-toast')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '전체 종합일정' })).toBeVisible();
});

test('여러 창이 같은 저장소를 동시에 편집하지 않는다', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByRole('textbox').first()).toBeEditable();
  await page.getByRole('textbox').first().fill('한 창만 편집');
  const second = await context.newPage(); await second.goto('/');
  await expect(second.getByRole('textbox').first()).not.toBeEditable();
  await expect(second.getByText('다른 하루결 창을 닫으면 잠시 후 편집할 수 있습니다.')).toBeVisible();
  await page.close(); await expect(second.getByRole('textbox').first()).toBeEditable();
});

test('여백 스와이프와 텍스트 편집 제스처를 구분한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox').first()).toBeEditable();
  const touch = (x: number) => ({ identifier: 1, clientX: x, clientY: 300, pageX: x, pageY: 300 });
  await page.locator('main').dispatchEvent('touchstart', { touches: [touch(500)] });
  await page.locator('main').dispatchEvent('touchend', { touches: [], changedTouches: [touch(350)] });
  await expect(page.getByRole('heading', { name: '전체 종합일정' })).toBeVisible();
  await page.locator('main').dispatchEvent('touchstart', { touches: [touch(350)] });
  await page.locator('main').dispatchEvent('touchend', { touches: [], changedTouches: [touch(500)] });
  await expect(page.getByRole('textbox').first()).toBeVisible();
  await page.getByRole('textbox').first().dispatchEvent('touchstart', { touches: [touch(500)] });
  await page.getByRole('textbox').first().dispatchEvent('touchend', { touches: [], changedTouches: [touch(350)] });
  await expect(page.getByRole('textbox').first()).toBeVisible();
});

test('잘못된 복구 파일과 손상된 기존 저장소를 덮어쓰지 않는다', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('textbox').first()).toBeEditable();
  await page.getByRole('textbox').first().fill('보존할 원문');
  await page.getByRole('button', { name: '백업과 사용법' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await expect(page.getByText('JSON 백업 파일을 선택하세요.')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[0].text)).toBe('보존할 원문');
  await page.evaluate(() => localStorage.setItem('daynote.v1', 'damaged original'));
  await page.reload();
  await expect(page.getByRole('textbox').first()).not.toBeEditable();
  await expect(page.getByRole('alert')).toContainText('원본을 덮어쓰지 않았습니다');
  expect(await page.evaluate(() => localStorage.getItem('daynote.v1'))).toBe('damaged original');
});

test('메모는 자동 등록하지 않으며 길게 눌러 선택한 줄만 추가·수정·해제한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').first().fill('26.11.11\n123플젝 문서 제출\n도면 검토\n해당 안건은 기존 123프로젝트에서 사용되었던 것으로...');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(0);
  await page.getByRole('button', { name: '메모', exact: true }).click();
  const task = page.locator('textarea').nth(1);
  const box = (await task.boundingBox())!;
  await page.mouse.move(box.x + 70, box.y + 16); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
  await expect(page.getByRole('toolbar', { name: '태스크 메뉴' })).toBeVisible();
  await page.getByRole('button', { name: '일정에 추가', exact: true }).click();
  await task.click({ button: 'right' });
  await expect(page.getByRole('button', { name: '일정에서 해제' })).toBeVisible();
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  await expect(page.locator('.event-text')).toContainText('123플젝 문서 제출');
  await page.getByRole('button', { name: '메모', exact: true }).click();
  await task.fill('123플젝 도면 수정');
  await page.locator('textarea').first().fill('261113');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  await expect(page.locator('.event-text')).toContainText('123플젝 도면 수정');
  await expect(page.locator('.event-text')).toContainText('26.11.13');
  await page.getByRole('button', { name: '메모', exact: true }).click();
  await task.click({ button: 'right' }); await page.getByRole('button', { name: '일정에서 해제' }).click();
  await expect(task).toHaveValue('123플젝 도면 수정');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(0);
  await page.reload(); await expect(page.locator('textarea').nth(1)).toHaveValue('123플젝 도면 수정');
});

test('단어 드래그로 기존 프로젝트 별칭을 연결하며 원문과 미등록 상태를 보존한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox').first().fill('26.11.11\n123프로젝트 설계\n123플젝 문서만들기\n기존 123플젝 자료를 참고해 작성');
  await createProject(page, page.locator('textarea').nth(1), '123프로젝트');
  const task = page.locator('textarea').nth(2);
  await selectPrefix(page, task, '123플젝');
  await page.getByRole('button', { name: '프로젝트', exact: true }).click();
  await page.getByRole('combobox', { name: '연결할 프로젝트' }).selectOption({ label: '123프로젝트' });
  await expect(page.getByRole('textbox', { name: '표준 프로젝트명' })).toHaveCount(0);
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(task).toHaveValue('123플젝 문서만들기');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(0);
  await page.getByRole('button', { name: '메모', exact: true }).click();
  await schedule(page, task); await schedule(page, page.locator('textarea').nth(3));
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(2);
  await expect(page.locator('.timeline-row').filter({ hasText: '123플젝 문서만들기' })).toContainText('123프로젝트');
  await expect(page.locator('.timeline-row').filter({ hasText: '기존 123플젝 자료' })).toContainText('프로젝트 미지정');
  await page.getByRole('button', { name: '123프로젝트', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!));
  expect(stored.projects).toHaveLength(1); expect(stored.projects[0].aliases).toContain('123플젝');
  expect(stored.lines[2].text).toBe('123플젝 문서만들기');
  expect(stored.lines[2].done).toBe(false);
});

test('짧은 기간 제목은 정규화되고 등록된 일정만 기간 막대로 표시한다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('261101~~~1103');
  await page.getByRole('textbox').first().press('Enter');
  await page.locator('textarea:focus').fill('기간 작업');
  await expect(page.locator('textarea').first()).toHaveValue('26.11.1~26.11.3');
  await schedule(page, page.locator('textarea').nth(1));
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.duration-bar')).toHaveCount(1);
  await expect(page.locator('.event-text')).toContainText('26.11.1 — 26.11.3');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[0].text)).toBe('261101~~~1103');
});

test('이전 저장 데이터는 한번 보존하고 새 입력은 자동 등록하지 않는다', async ({ page }) => {
  const old = { schema: 1, revision: 'legacy', updatedAt: '2026-11-13T00:00:00Z', lines: [
    { id: 'h', text: '261101', done: false, pinned: true },
    { id: 't', text: 'A프로젝트 기존 작업', done: true, pinned: false },
    { id: 'n', text: '참고: 메모 원문', done: false, pinned: false },
  ] };
  await page.addInitScript(note => { if (!localStorage.getItem('daynote.v1')) localStorage.setItem('daynote.v1', JSON.stringify(note)); }, old);
  await page.goto('/');
  await expect(page.locator('.pin-dot')).toHaveCount(1); await expect(page.locator('.done')).toHaveCount(1);
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  await page.getByRole('button', { name: '메모', exact: true }).click();
  await page.getByRole('button', { name: '계속 쓰기' }).click();
  await page.locator('textarea:focus').fill('새 메모 미등록');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  const result = await page.evaluate(() => ({ current: JSON.parse(localStorage.getItem('daynote.v1')!), old: JSON.parse(localStorage.getItem('daynote.before-schema2.v1')!) }));
  expect(result.old).toEqual(old); expect(result.current.schema).toBe(2);
  expect(result.current.lines.slice(0, 3).map(({ schedule: _s, ...row }: Record<string, unknown>) => row)).toEqual(old.lines);
  await page.reload(); await expect(page.locator('.done')).toHaveCount(1);
});

test('등록한 줄의 날짜 수정 중에는 숨겼다가 복원하고 비우기는 등록을 해제한다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('26.11.1\n등록할 작업');
  await schedule(page, page.locator('textarea').nth(1));
  await page.locator('textarea').first().fill('26.11.');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(0);
  await expect(page.getByText('등록한 1개 일정의 날짜 제목을 확인하세요.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '메모', exact: true }).click();
  await page.locator('textarea').first().fill('26.11.3');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  await expect(page.locator('.event-text')).toContainText('26.11.3');
  await page.getByRole('button', { name: '메모', exact: true }).click();
  await page.locator('textarea').nth(1).fill('');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(0);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[1].schedule)).toBeNull();
});

test('별칭과 등록은 실행 취소·다시 실행·백업 복구에 함께 포함된다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('26.11.1\n123플젝 작업');
  await createProject(page, page.locator('textarea').nth(1), '123플젝', '123프로젝트');
  await schedule(page, page.locator('textarea').nth(1));
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[1].schedule)).toBeNull();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).projects)).toHaveLength(0);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[1].schedule)).not.toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).projects)).toHaveLength(1);
  await page.getByRole('button', { name: '백업과 사용법' }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 백업 내려받기' }).click();
  const backupPath = (await (await downloaded).path())!;
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator('textarea').nth(1).fill('임시 수정');
  await page.getByRole('button', { name: '백업과 사용법' }).click();
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await page.getByRole('button', { name: '이 백업으로 교체' }).click();
  await expect(page.locator('textarea').nth(1)).toHaveValue('123플젝 작업');
  await page.getByRole('button', { name: '일정', exact: true }).click();
  await expect(page.locator('.timeline-row')).toHaveCount(1);
  await expect(page.locator('.event-text')).toContainText('123프로젝트');
});

test('터치 두 번 누르기는 완료만 바꾸고 프로젝트 메뉴를 열지 않는다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('26.11.1\n123플젝 작업');
  await page.getByRole('heading', { level: 1 }).click();
  const row = page.locator('textarea').nth(1), box = (await row.boundingBox())!;
  await page.touchscreen.tap(box.x + 40, box.y + 16); await page.touchscreen.tap(box.x + 40, box.y + 16);
  await expect(row.locator('..')).toHaveClass(/done/);
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[1].schedule)).toBeNull();
});

test('선택 메뉴는 스크롤과 키보드 영역 변경 뒤에도 선택한 표현을 유지한다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('26.11.1\n123플젝 작업');
  const row = page.locator('textarea').nth(1);
  await selectPrefix(page, row, '123플젝');
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  await expect(page.getByRole('button', { name: '프로젝트', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: 330 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
    window.visualViewport!.dispatchEvent(new Event('scroll'));
  });
  const toolbar = page.getByRole('toolbar', { name: '태스크 메뉴' });
  await expect(toolbar).toBeVisible();
  await expect.poll(async () => { const box = (await toolbar.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(330);
  await page.getByRole('button', { name: '프로젝트', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '표준 프로젝트명' })).toHaveValue('123플젝');
  await page.getByRole('button', { name: '등록', exact: true }).click();
  await expect(row).toHaveValue('123플젝 작업');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('daynote.v1')!).lines[1].schedule)).toBeNull();
});

test('터치 기본 선택을 막지 않고 네이티브 선택 변경으로 프로젝트 메뉴를 갱신한다', async ({ page }) => {
  await page.goto('/'); await page.getByRole('textbox').first().fill('26.11.1\n123플젝 작업');
  const row = page.locator('textarea').nth(1);
  await row.focus();
  await row.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0 });
  expect(await row.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
  await row.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 7 });
  // Keep React's synthetic select path out of this check: native handles can
  // change a textarea selection without the usual mouse/key event sequence.
  await page.evaluate(() => {
    document.addEventListener('selectionchange', event => event.stopImmediatePropagation(), { once: true });
    const input = document.activeElement as HTMLTextAreaElement;
    input.addEventListener('select', event => event.stopImmediatePropagation(), { once: true });
    input.setSelectionRange(0, 5);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await expect(page.getByRole('button', { name: '프로젝트', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '프로젝트', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '표준 프로젝트명' })).toHaveValue('123플젝');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await row.evaluate(element => { element.focus(); element.setSelectionRange(0, 0); });
  await expect(page.getByRole('toolbar')).toHaveCount(0);
});
