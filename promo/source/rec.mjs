import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2';
const DPR = Number(process.env.DPR || 1);
const SEED = Number(process.env.SEED || 7);
const BASE = 'http://localhost:3000';
// 화면 캡처가 느려서(약 8fps) 앱의 타이머·애니메이션을 SLOW배 느리게 돌려 녹화하고, 편집에서 SLOW배속으로 되돌립니다.
export const SLOW = Number(process.env.SLOW || 1);
// 앱의 제목 글꼴(BMDOHYEON)은 그대로 두고, 본문 글꼴만 Pretendard로 맞춥니다.
const FONT = `:root{--sans:"Pretendard","Noto Sans CJK KR",sans-serif !important;--serif:'BMDOHYEON',"Pretendard",sans-serif !important}`;
export async function session(fn) {
  const b = await chromium.launch({ args: [] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  // 카드 섞기를 매번 같게(시드 고정 난수) — 앱 로직은 그대로
  await ctx.addInitScript(seed => { let s = seed >>> 0; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }, SEED);
  await ctx.addInitScript(css => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }); }, FONT);
  await ctx.addInitScript(k => { if (k === 1) return; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, (ms || 0) * k, ...a); }, SLOW);
  const page = await ctx.newPage();
  if (SLOW !== 1) { const c = await ctx.newCDPSession(page); await c.send('Animation.enable'); await c.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW }); }
  try { await fn(page); } finally { await b.close(); }
}
export async function record(page, name, actions) {
  const dir = `clips/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async f => {
    const i = frames.length; frames.push(f.metadata.timestamp);
    fs.writeFileSync(`${dir}/${String(i).padStart(5,'0')}.jpg`, Buffer.from(f.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1600*DPR, maxHeight: 900*DPR, everyNthFrame: 1 });
  const start = Date.now() / 1000;
  await actions();
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  let list = '';
  frames.forEach((t, i) => { const next = i + 1 < frames.length ? frames[i + 1] : end; list += `file '${String(i).padStart(5,'0')}.jpg'\nduration ${Math.max(0.001, next - t).toFixed(4)}\n`; });
  list += `file '${String(frames.length - 1).padStart(5,'0')}.jpg'\n`;
  fs.writeFileSync(`${dir}/list.txt`, list);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`, '-vf', `fps=30,scale=${1600*DPR}:${900*DPR}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', `clips/${name}.mp4`]);
  console.log(name, frames.length, 'frames', (end - start).toFixed(1), 's');
}
export { BASE };
