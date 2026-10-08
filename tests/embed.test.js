/* 모아랩 광장 안(틀 · iframe)에서 열기 — 보안 헤더와 확인 창 */
const test=require("node:test");
const assert=require("node:assert");
const fs=require("fs");
const path=require("path");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");

test("CSP lets only 모아랩(moakit.ai) and Vercel previews put the app in a frame",()=>{
  const v=JSON.parse(read("vercel.json"));
  const csp=v.headers.find(h=>h.source==="/(.*)").headers.find(h=>h.key==="Content-Security-Policy").value;
  const fa=(/frame-ancestors ([^;]+)/.exec(csp)||[])[1];
  assert.ok(fa,"frame-ancestors missing");
  assert.deepEqual(fa.trim().split(/\s+/).sort(),["'self'","https://*.moakit.ai","https://*.vercel.app","https://moakit.ai"].sort());
  assert.ok(!v.headers.some(h=>h.headers.some(x=>/x-frame-options/i.test(x.key))),"X-Frame-Options would block the plaza frame");
});

test("every confirm goes through askOk (a sandboxed frame without allow-modals must not freeze 다시 뽑기·처음부터)",()=>{
  const html=read("index.html");
  const calls=[...html.matchAll(/\bconfirm\((?!\))/g)].map(m=>m.index);
  const helper=html.indexOf("function askOk(");
  assert.ok(helper>0,"askOk missing");
  const body=html.slice(helper,html.indexOf("\n}",helper));
  assert.equal(calls.filter(i=>i<helper||i>helper+body.length).length,0,"raw confirm() outside askOk");
  assert.ok(/inFrame&&Date\.now\(\)-t<50/.test(body),"askOk should only skip when framed and the dialog was refused instantly");
});
