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
  const ctxFn=html.slice(html.indexOf("function chatCtx"),html.indexOf("async function ask("));
  assert.ok(ctxFn.includes("cards")&&!ctxFn.includes("note"),"chatCtx sends the note");
  assert.ok(!/value="\$\{[^}]*apiKey/.test(html),"settings echoes the stored key into value=");
});

/* ── AI 리딩 ── */
const vm=require("vm");
const S=require("../safety.js");
const cardsOf=(...l)=>l.map(([ko,rev])=>({ko,rev}));
const draw=cardsOf(["바보",false],["죽음",true],["컵 2",false]);
const good=`■ 현재 상황 — 바보 정방향
바보 카드는 새로운 시작을 떠올리게 해요. 한번 해 볼까 하는 마음일 수 있어요.
■ 보이지 않는 영향 — 죽음 역방향
거꾸로 나온 죽음은 바뀌는 게 조금 싫은 마음일 수 있어요. 천천히 살펴보세요.
■ 앞으로 취할 태도 — 컵 2 정방향
컵 2는 서로를 이해하는 마음이에요. 먼저 마음을 나눠 보면 어떨까요?
■ 세 카드의 흐름
세 카드가 하나의 이야기처럼 이어져요. 처음에 고른 파랑처럼 차분히 생각해 보세요.`;

test("READING_SYSTEM is byte-identical across fresh builds and in a browser-like context",()=>{
  const files=["../content.js","../safety.js","../prompts.js"].map(f=>require.resolve(f));
  const fresh=()=>{files.forEach(f=>delete require.cache[f]);return require("../prompts.js").READING_SYSTEM};
  const a=fresh(),b=fresh();
  assert.equal(a,b);
  assert.equal(a,P.READING_SYSTEM);
  const win={},box=vm.createContext({window:win});
  for(const f of ["content.js","safety.js","prompts.js"])vm.runInContext(read(f),box,{filename:f});
  assert.equal(win.Prompts.READING_SYSTEM,a,"browser build differs from node build");
  assert.ok(!/Date|Math\.random|localeCompare/.test(read("prompts.js").slice(read("prompts.js").indexOf("const READING_SYSTEM"),read("prompts.js").indexOf("function studentBlock"))),
    "READING_SYSTEM must not depend on time, randomness or locale");
});

test("READING_SYSTEM: safety block first, every card (hidden ones too, sorted by code point), every color, the 4-section format",()=>{
  const R=P.READING_SYSTEM;
  assert.ok(R.startsWith(P.SAFETY_BLOCK));
  assert.ok(!R.includes("흉보기"));
  for(const c of C.cards)assert.ok(R.includes(`- ${c.ko} — 정방향: ${c.up} / 역방향: ${c.down}`),c.ko);
  for(const [n] of C.colors)assert.ok(R.includes(`- ${n}: ${C.COLOR_MEANING[n]}`),n);
  const dict=R.slice(R.lastIndexOf("[카드 사전]")).split("\n").filter(l=>l.startsWith("- ")).map(l=>l.slice(2).split(" — ")[0]);
  assert.deepEqual(dict,[...dict].sort((a,b)=>a<b?-1:a>b?1:0));
  assert.equal(dict.length,C.cards.length);
  for(const t of P.READING_TITLES)assert.ok(R.includes("■ "+t));
  assert.deepEqual(P.READING_TITLES,[...C.roles,"세 카드의 흐름"]);
  // 예시에는 숨긴 카드가 나오지 않음
  const ex=R.slice(R.indexOf("[예시]"),R.indexOf("[감정 색 사전]"));
  for(const c of C.cards.filter(c=>c.hidden))assert.ok(!ex.includes(c.ko),"hidden card in the example: "+c.ko);
  assert.equal(P.READING_MAX_TOKENS,1200);
  assert.equal(P.EXTRAS_MAX_TOKENS,500);
});

test("buildReadingUser carries only color, topic and the three cards (no note), deterministically",()=>{
  const ctx={color:"파랑",topic:"친구 관계",cards:draw};
  const u=P.buildReadingUser(ctx);
  assert.equal(u,P.buildReadingUser({...ctx}));
  assert.ok(u.includes("[학생이 고른 감정 색] 파랑 — "+C.COLOR_MEANING["파랑"]));
  assert.ok(u.includes("[학생이 고른 주제] 친구 관계 — 관계에서 느끼는 거리와 기대"));
  assert.ok(u.includes("2. 보이지 않는 영향 — 죽음 역방향 ("+C.cards.find(c=>c.ko==="죽음").down+")"));
  assert.ok(!P.buildReadingUser({...ctx,note:"비밀 메모"}).includes("비밀"),"extra fields (a note) must never be copied in");
  assert.equal(P.buildReadingUser.length,1);
  const html=read("index.html");
  const ai=html.slice(html.indexOf("async function startAiReading"),html.indexOf("/* ══════════════ 추가 질문"));
  assert.ok(ai.includes("Prompts.buildReadingUser")&&ai.includes("Prompts.buildExtrasUser")&&!/\bnote\b/.test(ai),"AI reading/extras requests must not touch the note");
});

test("parseReading splits sections (also mid-stream) and readingOk checks titles, cards, orientation and count",()=>{
  const secs=P.parseReading(good);
  assert.equal(secs.length,4);
  assert.ok(P.readingOk(secs,draw));
  assert.ok(secs[1].body.startsWith("거꾸로 나온 죽음은"));
  // 스트리밍 도중: 제목 줄만 왔어도 그 부분이 생김
  assert.deepEqual(P.parseReading("■ 현재 상황 — 바보 정방향\n바보 카드는").map(s=>s.body),["바보 카드는"]);
  assert.equal(P.parseReading("[도움필요] 말해 줘서 고마워요").length,0,"text before the first ■ is not a section");
  // 마크다운이 섞여도 읽음
  assert.ok(P.readingOk(P.parseReading(good.replace(/■ (.+)/g,"**■ $1**")),draw));
  assert.ok(!P.readingOk(secs.slice(0,3),draw),"3 sections");
  assert.ok(!P.readingOk([...secs,{head:"덧붙임",body:"다섯 번째 부분은 약속에 없어요."}],draw),"5 sections");
  assert.ok(!P.readingOk(P.parseReading(good.replace("죽음 역방향","죽음 정방향")),draw),"wrong orientation");
  assert.ok(!P.readingOk(P.parseReading(good.replace("— 바보","— 탑")),draw),"wrong card");
  assert.ok(!P.readingOk(P.parseReading(good.replace("■ 보이지 않는 영향","■ 숨은 영향")),draw),"wrong title");
  assert.ok(!P.readingOk(P.parseReading(good.replace("컵 2는 서로를 이해하는 마음이에요. 먼저 마음을 나눠 보면 어떨까요?","좋아요.")),draw),"empty body");
});

test("badReading catches fortune-telling and diagnosis words but not the card name 운명의 수레바퀴",()=>{
  for(const t of ["넌 반드시 시험에 붙을 거예요.","틀림없이 좋은 일이 생겨요.","이건 운명이에요.","곧 헤어지게 될 거예요.","시험에 실패할 거예요.",
    "우울증일 수 있어요.","ADHD 같아요.","정신과에 가 보세요.","불길한 카드예요.","100% 맞아요."])assert.ok(P.badReading(t),t);
  for(const t of ["운명의 수레바퀴는 변화를 뜻해요.","운명의수레바퀴 카드예요.",good,"반드시 정답이 있는 건 아니에요.","천천히 해 보면 어떨까요?"])assert.ok(!P.badReading(t),t);
});

test("parseExtras keeps only valid fields for the app's own scents and safe short questions",()=>{
  const names=["레몬","라벤더","편백"];
  const ok={scents:[{name:"레몬",reason:"바보 카드의 새 시작과 어울리는 상큼한 향기예요.",smell_question:"어떤 장소가 떠오르나요?"},
    {name:"라벤더",reason:"x".repeat(61),smell_question:"차분해지는 곳은 어디예요?"},
    {name:"장미",reason:"목록에 없는 향기",smell_question:"버려져요"},
    {name:"편백 ",reason:"이름이 조금 달라요",smell_question:"버려져요"}],
    questions:["친구에게 먼저 말해도 될까요?","이 질문은 스물다섯 글자를 훨씬 넘어서 너무 길어서 버려져요","죽고 싶어요","친구에게 먼저 말해도 될까요?","오늘 뭘 해 보면 좋을까요?","왜 거꾸로 나왔어요?","네 번째는 버려져요"]};
  const r=P.parseExtras("결과예요:\n```json\n"+JSON.stringify(ok)+"\n```",names);
  assert.deepEqual(Object.keys(r.scents),["레몬","라벤더"]);
  assert.equal(r.scents["레몬"].reason,ok.scents[0].reason);
  assert.equal(r.scents["라벤더"].reason,undefined,"reason over 60 chars is dropped");
  assert.equal(r.scents["라벤더"].ask,"차분해지는 곳은 어디예요?");
  assert.deepEqual(r.questions,["친구에게 먼저 말해도 될까요?","오늘 뭘 해 보면 좋을까요?","왜 거꾸로 나왔어요?"]);
  for(const bad of ["","그냥 글이에요","{깨진 json","[1,2,3]",JSON.stringify({scents:"x",questions:"y"}),"null"])
    assert.deepEqual(P.parseExtras(bad,names),{scents:{},questions:[]},bad);
  assert.ok(!S.check(C.CHAT_CHIPS.join(" "))&&C.CHAT_CHIPS.every(q=>q.length<=25),"static chips are short and safe");
});

test("extras prompt: safety first, the app's scents by name, no note; cost estimate counts every prompt",()=>{
  assert.ok(P.EXTRAS_SYSTEM.startsWith(P.SAFETY_BLOCK));
  const u=P.buildExtrasUser({color:"파랑",topic:"친구 관계",cards:draw},[{name:"레몬",mood:"bright",desc:"",from:0},{name:"라벤더",mood:"calm",desc:"보랏빛",from:1},{name:"코튼",mood:"calm",desc:"",from:null}]);
  assert.ok(u.includes("1. 레몬 — "+C.MOOD_DESC.bright+" (현재 상황 자리의 바보 카드에서 이어짐)"));
  assert.ok(u.includes("2. 라벤더 — 보랏빛 (보이지 않는 영향 자리의 죽음 카드에서 이어짐)"));
  assert.ok(u.includes("3. 코튼 — "+C.MOOD_DESC.calm+"\n"));
  const t=P.studentTokens();
  assert.ok(t.input>P.READING_SYSTEM.length+P.EXTRAS_SYSTEM.length+3*P.QA_SYSTEM.length&&t.output>=1500,JSON.stringify(t));
});
