// 실제 앱 화면을 순서대로 녹화합니다 (로컬 서버 http://localhost:3000, 운영 서버/유료 API 호출 없음)
import { session, record, BASE, SLOW } from './rec.mjs';
const w = ms => new Promise(r => setTimeout(r, ms * SLOW));
await session(async p => {
  await p.goto(BASE + '/'); await w(1500);
  // STEP 01 표지 → 감정 색
  await record(p, 'color', async () => {
    await w(1600);
    await p.locator('.poster').click(); await w(1800);
    await p.getByRole('button', { name: '보라' }).hover(); await w(300);
    await p.getByRole('button', { name: '보라' }).click(); await w(1600);
  });
  // STEP 02 주제 + 한 줄 고민
  await p.getByRole('button', { name: '다음' }).click(); await w(900);
  await record(p, 'topic', async () => {
    await w(600);
    await p.getByRole('button', { name: /친구 관계/ }).click(); await w(800);
    await p.locator('#note').click();
    await p.locator('#note').pressSequentially('새 학기에 친구에게 먼저 말 걸기가 어려워요', { delay: 90 * SLOW }); await w(1000);
  });
  // STEP 03 카드 섞기 → 세 장 고르기
  await record(p, 'draw', async () => {
    await p.getByRole('button', { name: '카드 펼치기' }).click(); await w(2600);
    for (const i of [9, 18, 27]) { await p.locator('#fan .card').nth(i).click({ force: true }); await w(2800); }
    await w(800);
  });
  console.log('draw:', (await p.locator('#slots').innerText()).replace(/\n/g, ' '));
  // STEP 04 리딩 + 더 물어보기
  await record(p, 'reading', async () => {
    await p.getByRole('button', { name: '리딩 보기' }).click(); await w(3500);
    for (let i = 0; i < 12; i++) { await p.mouse.wheel(0, 60 / SLOW * 1); await w(40); }
    await w(900);
    await p.locator('#q').click();
    await p.locator('#q').pressSequentially('친구에게 먼저 다가가려면 어떻게 하면 좋을까요?', { delay: 70 * SLOW }); await w(400);
    await p.keyboard.press('Enter'); await w(3500);
  });
  // STEP 05 향기 추천
  await record(p, 'scent', async () => {
    await p.getByRole('button', { name: '향기 추천' }).click(); await w(4500);
  });
  // 선생님: 메뉴 → 향기 목록 편집, 도움말
  await record(p, 'teacher', async () => {
    await w(400);
    await p.locator('button', { hasText: '메뉴' }).first().click(); await w(1500);
    await p.locator('.sheet .row', { hasText: '향기 목록' }).click(); await w(2500);
    await p.locator('.sheet .sheetbox').evaluate(el => el.scrollBy({ top: 300, behavior: 'smooth' })).catch(() => {}); await w(2000);
  });
  await p.locator('.sheet').evaluate(el => el.remove()).catch(() => {});
  await record(p, 'help', async () => {
    await w(300);
    await p.locator('button', { hasText: '?' }).first().click(); await w(3500);
  });
});
