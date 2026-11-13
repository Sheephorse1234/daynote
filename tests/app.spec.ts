import { test, expect } from '@playwright/test';

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
