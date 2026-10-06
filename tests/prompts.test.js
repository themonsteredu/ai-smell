/* prompts.js 점검: 안전 규칙이 맨 앞, 앱과 서버가 같은 안내문을 씀, 첫 질문의 카드 정보가 지워지지 않음 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const P=require("../prompts.js");
const C=require("../content.js");

const ROOT=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(ROOT,f),"utf8");
const ctx={topic:"친구 관계",color:"파랑",cards:[{ko:"바보",rev:false},{ko:"죽음",rev:true},{ko:"컵 2",rev:false}]};

test("QA system prompt starts with the safety block and has the marker and only the 4 numbers",()=>{
  assert.ok(P.QA_SYSTEM.startsWith(P.SAFETY_BLOCK));
  assert.ok(P.SAFETY_BLOCK.startsWith("[안전 규칙"));
  assert.ok(P.SAFETY_BLOCK.includes("[도움필요]"));
  for(const n of ["1388","109","117","112"])assert.ok(P.SAFETY_BLOCK.includes(n),n);
  assert.ok(!P.QA_SYSTEM.includes("1393"));
  assert.ok(!P.QA_SYSTEM.includes("흉보기"),"off-topic rule must not list 다른 사람 흉보기");
  assert.ok(P.QA_SYSTEM.includes("선생님"));
});

test("first turn is built from content.js meanings, includes color, and ends with the safety reminder",()=>{
  const t=P.firstTurn(ctx,"이 카드는 무슨 뜻이에요?");
  const 죽음=C.cards.find(c=>c.ko==="죽음");
  assert.ok(t.includes("[학생이 고른 주제] 친구 관계"));
  assert.ok(t.includes("2. 보이지 않는 영향 — 죽음 역방향 ("+죽음.down+")"));
  assert.ok(t.includes("파랑 — "+C.COLOR_MEANING["파랑"]));
  assert.ok(t.includes("이 카드는 무슨 뜻이에요?"));
  assert.ok(t.trim().endsWith("안전 규칙에 해당하면 안전 규칙을 따르세요."));
  assert.ok(!t.includes("[오늘의 리딩 요약]"),"no reading section unless given");
  assert.ok(P.firstTurn({...ctx,reading:"요약 글"},"q").includes("[오늘의 리딩 요약]\n요약 글"));
});

test("buildMessages wraps the first question with the card context and keeps it when trimming",()=>{
  const one=P.buildMessages(ctx,[],"첫 질문");
  assert.equal(one.length,1);
  assert.equal(one[0].role,"user");
  assert.ok(one[0].content.includes("첫 질문")&&one[0].content.includes("[학생이 뽑은 세 장의 카드]"));

  const h=[];for(let i=1;i<=5;i++)h.push({role:"user",content:"질문"+i},{role:"assistant",content:"답"+i});
  const m=P.buildMessages(ctx,h,"새 질문");
  assert.ok(m.length<=P.HISTORY_MAX+1,"bounded: "+m.length);
  assert.ok(m[0].content.includes("[학생이 뽑은 세 장의 카드]")&&m[0].content.includes("질문1"),"first context turn kept");
  assert.equal(m[1].content,"답1");
  assert.equal(m[m.length-1].content,"새 질문");
  m.forEach((x,i)=>assert.equal(x.role,i%2?"assistant":"user","roles alternate at "+i));
  assert.equal(h.length,10,"caller's history is not mutated");
});

test("one prompt source: no SYSTEM/buildPrompt copies left in index.html or api/ask.js; scripts load in order",()=>{
  const html=read("index.html"),api=read("api/ask.js");
  for(const [name,src] of [["index.html",html],["api/ask.js",api]]){
    assert.ok(!/const\s+SYSTEM\s*=/.test(src),name+" defines its own SYSTEM");
    assert.ok(!/function\s+buildPrompt/.test(src),name+" defines its own buildPrompt");
  }
  assert.ok(api.includes('require("../prompts.js")')&&api.includes('require("../safety.js")'));
  const order=["content.js","safety.js","prompts.js","reading.js"].map(f=>html.indexOf(`<script src="${f}"></script>`));
  assert.ok(order.every((i,k)=>i>0&&(k===0||order[k-1]<i)),"script order "+order);
  assert.ok(order[3]<html.indexOf("<script>"),"shared scripts load before the inline app script");
});

test("privacy: the student's note never reaches the reading or the AI context",()=>{
  const html=read("index.html");
  const mk=html.slice(html.indexOf("function makeReading"),html.indexOf("function readingScreen"));
  assert.ok(mk.includes("Reading.make(")&&mk.includes("state.note")&&!/state\.note(?!\?)/.test(mk),"makeReading may only pass whether a note exists, never the note");
  assert.ok(!/\bnote\b/i.test(read("reading.js")),"reading.js must never get the note text");
  const ctxFn=html.slice(html.indexOf("function chatCtx"),html.indexOf("async function ask()"));
  assert.ok(ctxFn.includes("cards")&&!ctxFn.includes("note"),"chatCtx sends the note");
  assert.ok(!/value="\$\{[^}]*apiKey/.test(html),"settings echoes the stored key into value=");
});
