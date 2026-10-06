#!/usr/bin/env node
/* Playwright 점검 — 표지 → 색 → 주제 → 카드 3장 → 리딩(질문 1개) → 향기 → 이전 → 향기 → 처음부터
   사용법:  node tests/smoke.cjs [--base http://localhost:8091/] [--runs 3]
     (먼저 저장소를 띄워 두세요:  npx http-server . -p 8091 -s -c-1 . Vercel 미리보기 주소도 됩니다)
   - 390x844(휴대폰)와 1366x768(노트북)에서 각각 --runs 번 진행합니다. 홀수 번째 진행은
     리딩 화면에서 ☰ 메뉴 → 처음 화면 으로 나가, 다음 학생에게 앞 학생 기록이 남지 않는지 봅니다.
   - 화면 크기마다 '안전 점검'을 한 번 더 합니다: 위험한 고민 한 줄·질문 → 도움 안내 화면(네트워크 호출 없음)
     → 선생님 확인 길게 누르기 → 이어서 하기 / 처음부터, 서버의 SAFETY·RATE 답, 다시 뽑기 후 남은 질문 수,
     설정에서 키가 다시 보이지 않는지, AI 기능 끄기. 준비된 답변은 질문마다 다르고 남은 질문 수를 줄이지 않음.
   - pageerror 나 console error 가 하나라도 나면 실패합니다.
   - 숨긴 카드(content.js 의 hidden:true) 그림이 요청되거나 화면 어디에(부채꼴·칸·결과) 보이면 실패합니다.
   - 화면·창 점검(ux)을 390x844 · 820x1180 · 1024x768 · 1366x768 · 1920x1080 에서 한 번씩 합니다:
     표지 그림이 늦어도 자리와 시작 버튼이 보이는지, 넓은 화면에서 색·주제·카드·향기 단계가 스크롤 없이 들어오는지,
     뒤집은 카드가 탁자 안에 다 보이는지, 리딩 글이 15px 밑으로 줄지 않는지, 설정 '저장'이 창 안에 있는지,
     Esc·바깥 누르기·고친 내용 확인, '기본값으로'가 저장 전에는 향기 목록을 지우지 않는지, 키보드로 카드 고르기,
     한글 조합 중 Enter 로 질문이 나가지 않는지.
   - 주소가 localhost 면 vercel.json 의 보안 헤더(CSP 등)를 똑같이 붙여서 확인합니다.
   - /api/ask 는 NO_KEY 로 대신 답하고 api.anthropic.com 은 막습니다(요금이 드는 호출 없음). */
let pw;
try{pw=require("playwright")}catch(e){pw=require("/opt/node22/lib/node_modules/playwright")}
const fs=require("fs");
const path=require("path");
const CONTENT=require("../content.js");

const arg=(name,def)=>{const i=process.argv.indexOf("--"+name);return i>0&&process.argv[i+1]?process.argv[i+1]:def};
const BASE=new URL(arg("base","http://localhost:8091/"));
const RUNS=Math.max(1,parseInt(arg("runs","3"),10)||3);
const LOCAL=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(BASE.hostname);
const VIEWPORTS=[{width:390,height:844},{width:1366,height:768}];
const UX_VIEWPORTS=[{width:390,height:844},{width:820,height:1180},{width:1024,height:768},{width:1366,height:768},{width:1920,height:1080}];
const HIDDEN_IMGS=CONTENT.cards.filter(c=>c.hidden).map(c=>c.img);
/* 펼치는 장수: 휴대폰(700px 이하) 15장, 그 밖 36장 — 숨기지 않은 카드 수를 넘지 않음 */
const fanFor=vp=>Math.min(vp.width<=700?15:36,CONTENT.deckPool().length);

/* vercel.json 의 "/(.*)" 헤더 — 로컬 서버에서도 실제 배포와 같은 CSP 로 돌려 봄 */
const vercel=JSON.parse(fs.readFileSync(path.join(__dirname,"..","vercel.json"),"utf8"));
const SITE_HEADERS=Object.fromEntries(((vercel.headers||[]).find(h=>h.source==="/(.*)")||{headers:[]}).headers.map(h=>[h.key.toLowerCase(),h.value]));

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const isHiddenImg=src=>HIDDEN_IMGS.some(h=>String(src||"").replace(/^.*?(cards\/)/,"$1").split("?")[0]===h);
function check(cond,msg){if(!cond)throw new Error(msg)}

/* 새 브라우저 창 하나와 공통 도우미. api.reason 을 바꾸면 /api/ask 가짜 답이 바뀜(기본 NO_KEY) */
async function open(browser,vp){
  const ctx=await browser.newContext({viewport:vp});
  const errors=[],hiddenSeen=new Set(),api={reason:"NO_KEY",answer:null,calls:[]},dialogs=[];
  await ctx.route("**/*",async route=>{
    const u=new URL(route.request().url());
    if(u.hostname==="api.anthropic.com")return route.abort();
    if(u.origin!==BASE.origin)return route.continue();
    if(u.pathname==="/api/ask"){
      api.calls.push(JSON.parse(route.request().postData()||"null"));
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({answer:api.answer,reason:api.reason})});
    }
    if(!LOCAL)return route.continue();
    const resp=await route.fetch();
    return route.fulfill({response:resp,headers:{...resp.headers(),...SITE_HEADERS}});
  });
  const page=await ctx.newPage();
  page.on("pageerror",e=>errors.push("pageerror: "+e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push("console: "+m.text())});
  page.on("request",r=>{if(isHiddenImg(new URL(r.url()).pathname.slice(1)))hiddenSeen.add(r.url())});
  /* 확인 창(confirm): 다시 뽑기·처음부터·저장 안 하고 닫기. 기본은 '확인', h.answer=false 면 '취소' */
  const h={ctx,page,errors,hiddenSeen,api,dialogs,answer:true};
  page.on("dialog",d=>{dialogs.push(d.message());h.answer?d.accept():d.dismiss()});
  h.scr=sel=>page.locator("#screen"+sel);
  h.primary=()=>page.locator("#screen .nav .btn.primary");
  h.atStep=cls=>page.waitForSelector("#screen.content."+cls,{timeout:5000});
  h.nav=async loc=>{await wait(500);await loc.click()};   // 앱은 450ms 안의 두 번째 이동을 무시함
  h.domHidden=async where=>{
    const srcs=await page.$$eval("img",ims=>ims.map(i=>i.getAttribute("src")));
    const bad=srcs.filter(isHiddenImg);
    check(!bad.length,`${where}: hidden card image on screen: ${bad.join(", ")}`);
  };
  /* 카드 세 장 뽑고 리딩 화면까지 */
  h.drawThree=async()=>{
    await page.waitForFunction(()=>!document.getElementById("fan").classList.contains("locked"),null,{timeout:5000});
    for(let k=0;k<3;k++){
      const idx=await page.evaluate(()=>{const c=[...document.querySelectorAll("#fan .card")].map((el,i)=>[el,i]).filter(([el])=>!el.classList.contains("hide"));return c[Math.floor(Math.random()*c.length)][1]});
      await page.locator("#fan .card").nth(idx).dispatchEvent("click");
      await page.waitForFunction(k=>document.querySelectorAll("#slots .slot.filled").length===k+1&&!document.querySelector("#fan .card.chosen"),k,{timeout:6000});
    }
    await h.nav(page.locator("#go"));
    await h.atStep("s-reading");
  };
  /* 질문 하나 보내고 말풍선이 n개가 될 때까지 기다림 */
  h.askQ=async(q,n)=>{
    await page.fill("#q",q);
    await page.click("#askbtn");
    await page.waitForFunction(n=>document.querySelectorAll("#chatlog .msg").length===n&&!document.querySelector("#chatlog .msg.pending"),n,{timeout:8000});
  };
  /* '선생님 확인' 버튼을 ms 동안 누르고 있다가 뗌 */
  h.hold=async ms=>{
    await wait(400);   // 화면 전환 때의 부드러운 스크롤이 끝나길 기다림
    await page.locator("#teach").scrollIntoViewIfNeeded();
    const b=await page.locator("#teach").boundingBox();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
    await page.mouse.down();await wait(ms);await page.mouse.up();
  };
  h.finish=async label=>{
    await wait(300);
    check(!hiddenSeen.size,"hidden card image requested: "+[...hiddenSeen].join(", "));
    check(!errors.length,"errors:\n  "+errors.join("\n  "));
    console.log(`ok   ${label}`);
  };
  return h;
}

async function run(browser,vp,n){
  const label=`${vp.width}x${vp.height} #${n+1}`,FAN=fanFor(vp);
  const h=await open(browser,vp);
  const {page,scr,primary,atStep,nav,domHidden}=h;
  try{
  await page.goto(BASE.href,{waitUntil:"load"});
  check(await page.locator(".poster").isVisible(),"cover not shown");
  if(n===0){
    // 덱을 많이 만들어 봐도 숨긴 카드·중복이 없어야 함
    const bad=await page.evaluate(()=>{let b=0;for(let i=0;i<3000;i++){const d=Reading.makeDeck();if(d.some(c=>c.hidden)||new Set(d.map(c=>c.ko)).size!==d.length)b++}return b});
    check(bad===0,`makeDeck produced ${bad} bad decks`);
  }
  await page.locator(".poster .start").click();
  await atStep("s-color");

  // STEP 1 색
  const rows=scr(" .rows .row");
  await rows.nth(Math.floor(Math.random()*await rows.count())).click();
  check(await page.locator("#screen .row.sel").count()===1,"color not selected");
  await nav(primary());
  await atStep("s-topic");

  // STEP 2 주제 + 한 줄 메모 (HTML 처럼 보이는 글도 글자로만 다뤄지고, 리딩에 다시 나오면 안 됨)
  const trows=scr(" .rows .row");
  await trows.nth(Math.floor(Math.random()*await trows.count())).click();
  check(await page.getAttribute("#note","maxlength")==="100","note maxlength should be 100");
  const NOTE='메모글 <b id="inj">x</b><img src=x onerror="window.__xss=1">';
  await page.fill("#note",NOTE);
  await trows.nth(0).click();   // 주제를 바꿔 다시 그려도 메모가 그대로, 태그가 실행되지 않음
  check(await page.inputValue("#note")===NOTE,"note not kept as plain text after re-render");
  await nav(primary());
  await atStep("s-draw");

  // STEP 3 카드
  check(await page.locator("#drawback").isDisabled(),"이전 should be disabled while shuffling");
  await page.waitForFunction(()=>!document.getElementById("fan").classList.contains("locked"),null,{timeout:5000});
  const dk=await page.evaluate(()=>({n:deck.length,hidden:deck.filter(c=>c.hidden).length,uniq:new Set(deck.map(c=>c.ko)).size}));
  check(dk.n===FAN&&dk.hidden===0&&dk.uniq===dk.n,`bad deck ${JSON.stringify(dk)} (expected ${FAN} unique visible)`);
  check((await page.textContent("#counter")).includes(`${FAN}장 중 0 / 3`),"counter wrong at start");
  check(await page.locator("#go").isDisabled(),"리딩 보기 enabled too early");
  for(let k=0;k<3;k++){
    const idx=await page.evaluate(()=>{const c=[...document.querySelectorAll("#fan .card")].map((el,i)=>[el,i]).filter(([el])=>!el.classList.contains("hide"));return c[Math.floor(Math.random()*c.length)][1]});
    await page.locator("#fan .card").nth(idx).dispatchEvent("click");
    await wait(150);
    check(await page.locator("#drawback").isDisabled()&&await page.locator("#reshuffle").isDisabled(),"이전/다시 섞기 should be disabled while a card flips");
    await page.waitForFunction(k=>document.querySelectorAll("#slots .slot.filled").length===k+1&&!document.querySelector("#fan .card.chosen"),k,{timeout:6000});
    await domHidden(`after pick ${k+1}`);
  }
  check((await page.textContent("#counter")).includes("3 / 3"),"counter wrong after 3 picks");
  const gone=await page.$$eval("#fan .card.hide",cs=>cs.map(c=>c.tabIndex===-1&&c.getAttribute("aria-hidden")==="true"));
  check(gone.length===3&&gone.every(Boolean),"picked cards should leave the tab order");
  await wait(800);   // 세 장째 뒤 리딩 보기 버튼이 보이게 스크롤됨
  const goBox=await page.evaluate(()=>{const r=document.getElementById("go").getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:innerHeight}});
  check(goBox.top>=0&&goBox.bottom<=goBox.h+1,"리딩 보기 is off-screen after the third card: "+JSON.stringify(goBox));
  check(await page.locator("#go").isEnabled(),"리딩 보기 not enabled after 3 cards");
  await nav(page.locator("#go"));
  await atStep("s-reading");

  // STEP 4 리딩 + 질문 1개
  check(await page.locator(".result").count()===3,"expected 3 result cards");
  check(await page.locator(".reading p").count()>=4,"reading too short");
  await domHidden("reading");
  check(!(await page.textContent(".reading")).includes("메모글"),"the note was echoed into the reading");
  check(await page.evaluate(()=>!document.getElementById("inj")&&window.__xss===undefined),"note markup was rendered/executed");
  check((await page.textContent(".ainote")).includes("AI에게 보내져요"),"AI notice missing under the chat divider");
  check((await page.textContent("#chathint")).includes("남은 질문 3개"),"hint should start at 3");
  check(await page.locator("#chatlog .msg").count()===1,"chat should start with the greeting only");
  check((await page.textContent("#chatlog .msg .src")).includes("안내"),"greeting should carry the 안내 tag");
  await h.askQ("이 카드는 무슨 뜻이에요?",3);
  check((await page.textContent("#chathint")).includes("남은 질문 3개"),"a prepared (non-AI) answer must not use up a question");
  check((await page.locator("#chatlog .msg.ai .src").last().textContent()).includes("준비된 답변"),"NO_KEY answer should be tagged 준비된 답변");
  // 준비된 답변도 질문에 따라 달라야 함(예전에는 세 질문 모두 같은 문단)
  await h.askQ("역방향은 나쁜 건가요?",5);
  const local=await page.$$eval("#chatlog .msg.ai .bubble",bs=>bs.slice(-2).map(b=>b.textContent));
  check(local[0]!==local[1],"two different questions got the same prepared answer");
  check(!/undefined|NaN|\[object/.test(local.join(" ")),"bad text in a prepared answer: "+local.join(" | "));
  const rd=await page.textContent(".reading");
  check(!/undefined|NaN|\[object|관계’?이라는|색 색|습니다/.test(rd),"reading text problem: "+rd);
  const sent=h.api.calls[h.api.calls.length-1];
  check(sent&&Array.isArray(sent.cards)&&sent.cards.every(c=>Object.keys(c).sort().join()==="ko,rev")&&!("reading" in sent)&&!JSON.stringify(sent).includes("메모글"),
    "/api/ask body must carry only {ko,rev} cards, no reading, no note: "+JSON.stringify(sent));

  if(n%2===1){
    // 메뉴 → 처음 화면: 리딩이 있으니 한 번 묻고(취소하면 그대로), 확인하면 다음 학생에게 아무것도 남지 않아야 함
    await wait(500);
    h.answer=false;
    await page.click(".menubtn");
    await page.locator("#sheet .row",{hasText:"처음 화면"}).click();
    await wait(300);
    check(h.dialogs.length===1&&await page.locator("#screen.s-reading").count()===1,"처음 화면 should ask first and stay when cancelled");
    h.answer=true;
    await wait(500);
    await page.click(".menubtn");
    await page.locator("#sheet .row",{hasText:"처음 화면"}).click();
    await page.waitForSelector("#screen.cover",{timeout:5000});
    const st=await page.evaluate(()=>({s:state,deck,askCount,chat:chatHistory.length,log:chatLog.length}));
    check(st.s.color===null&&st.s.topic===null&&st.s.note===""&&st.s.draw.length===0&&st.deck===null&&st.askCount===0&&st.chat===0&&st.log===0,"menu → 처음 화면 did not reset: "+JSON.stringify(st));
    await nav(page.locator(".poster .start"));
    await atStep("s-color");
    check(await page.locator("#screen .row.sel").count()===0,"previous color still selected");
    check(await primary().isDisabled(),"다음 enabled without a color");
  }else{
    // STEP 5 향기 → 이전(대화가 그대로) → 향기(두 번 눌러도 한 단계만) → 처음부터
    await nav(primary());
    await atStep("s-scent");
    check(await page.locator(".scent").count()===3,"expected 3 scents");
    check(await page.locator(".scent .from").count()===3,"each scent should say which card it goes with");
    const nt=await page.textContent("#screen .notice");
    for(const w of ["부채질","피부","먹지","알레르기","선생님"])check(nt.includes(w),"smell-safety note missing "+w);
    await nav(page.locator("#screen .nav .btn:not(.primary)"));
    await atStep("s-reading");
    check(await page.locator("#chatlog .msg").count()===5,"chat log not replayed after 이전");
    check((await page.textContent("#chathint")).includes("남은 질문 3개"),"hint wrong after 이전");
    await domHidden("reading again");
    await wait(500);
    await primary().dblclick();
    await wait(700);
    check(await page.locator("#screen.s-scent").count()===1,"double-click on 향기 추천 did not stay on the scent step");
    await nav(primary());
    await page.waitForSelector("#screen.cover",{timeout:5000});
    const st=await page.evaluate(()=>({draw:state.draw.length,note:state.note,deck,log:chatLog.length}));
    check(st.draw===0&&st.note===""&&st.deck===null&&st.log===0,"처음부터 did not reset: "+JSON.stringify(st));
  }

  await h.finish(label);
  }finally{await h.ctx.close()}
}

/* 안전 점검 — 화면 크기마다 한 번 */
async function safetyRun(browser,vp){
  const label=`${vp.width}x${vp.height} safety`;
  const h=await open(browser,vp);
  const {page,scr,primary,atStep,nav,api}=h;
  const flagged=()=>page.evaluate(()=>document.body.classList.contains("flagged"));
  const flagCount=()=>page.evaluate(()=>{try{return JSON.parse(localStorage.getItem("maum_tarot_flags")).log.length}catch(e){return 0}});
  const helpShown=async where=>{
    await page.waitForSelector("#screen.s-help .helpcard",{timeout:5000});
    const t=await page.textContent(".helpcard");
    for(const n of ["1388","109","117","112","선생님"])check(t.includes(n),`${where}: help card missing ${n}`);
    check(await flagged(),`${where}: crest cue not shown`);
  };
  try{
  await page.goto(BASE.href,{waitUntil:"load"});
  await page.locator(".poster .start").click();
  await atStep("s-color");
  await scr(" .rows .row").first().click();
  await nav(primary());
  await atStep("s-topic");
  await scr(" .rows .row").nth(1).click();

  // 1) 위험한 고민 한 줄 → 카드로 넘어가지 않고 도움 안내, 네트워크 호출 없음
  await page.fill("#note","요즘 그냥 죽 고 싶어요");
  await nav(primary());
  await helpShown("note");
  check(api.calls.length===0,"crisis note caused a network call");
  check(await flagCount()===1,"flag timestamp not logged");
  check(!(await page.evaluate(()=>localStorage.getItem("maum_tarot_flags"))).includes("죽"),"flag log must hold no text");
  check(await page.locator("#screen .btn").count()===0,"student-visible nav buttons on the help card");
  await page.click(".menubtn");
  check(await page.locator("#sheet .row",{hasText:"처음 화면"}).count()===0,"menu offers 처음 화면 while flagged");
  await page.locator("#sheet .btn",{hasText:"닫기"}).click();
  await h.hold(300);   // 짧게 누르면 아무 일도 없음
  check(await page.locator("#helpnav .btn").count()===0,"short press dismissed the help card");
  await h.hold(1700);
  await page.locator("#helpnav .btn",{hasText:"이어서 하기"}).click();
  await atStep("s-topic");
  check(await page.inputValue("#note")==="","flagged note should be cleared on resume");
  check(!(await flagged()),"crest cue should clear after the teacher confirmed");

  // 2) 리딩까지 가서 위험한 질문 → 도움 안내, 질문은 보내지도 기록되지도 않음, 남은 질문 수 그대로
  await page.fill("#note","시험이 걱정돼요");
  await nav(primary());
  await atStep("s-draw");
  await h.drawThree();
  await page.fill("#q","아빠가 매일 때려요");
  await page.click("#askbtn");
  await helpShown("chat");
  check(api.calls.length===0,"crisis question was sent to /api/ask");
  check(await page.evaluate(()=>chatLog.every(m=>!m.text.includes("때려"))&&chatHistory.length===0&&askCount===0),"crisis question was recorded or counted");
  await h.hold(1700);
  await page.locator("#helpnav .btn",{hasText:"이어서 하기"}).click();
  await atStep("s-reading");
  check(await page.locator("#chatlog .msg").count()===1,"chat should hold only the greeting after resume");
  check((await page.textContent("#chathint")).includes("남은 질문 3개"),"crisis question used up a question");

  // 3) AI가 답한 질문 1개 → 다시 뽑기 → 남은 질문 수는 그대로(같은 학생)
  api.reason="OK";api.answer="AI가 쓴 답이에요.";
  await h.askQ("이 카드는 무슨 뜻이에요?",3);
  check((await page.locator("#chatlog .msg.ai .src").last().textContent()).includes("AI 답변"),"server OK answer should be tagged AI 답변");
  check((await page.textContent("#chathint")).includes("남은 질문 2개"),"an AI answer should use up a question");
  await nav(page.locator("#screen .nav .btn",{hasText:"다시 뽑기"}));   // 한 번 묻고(확인) 다시 뽑기
  await atStep("s-draw");
  check(h.dialogs.length>=1,"다시 뽑기 should ask before wiping the reading");
  await h.drawThree();
  check((await page.textContent("#chathint")).includes("남은 질문 2개"),"다시 뽑기 refilled the question count");

  // 4) 서버가 RATE → 준비된 답변 + 한 줄 안내(한 번만), 남은 질문 수는 그대로
  api.reason="RATE";api.answer=null;
  await h.askQ("역방향은 나쁜 건가요?",4);
  check((await page.textContent("#chatlog")).includes("지금은 AI가 답할 수 없어서"),"no notice when AI is unavailable");
  check((await page.textContent("#chathint")).includes("남은 질문 2개"),"a prepared answer after RATE used up a question");

  // 5) 서버가 SAFETY(AI가 [도움필요]로 판단) → 도움 안내 → 처음부터는 전부 지움
  api.reason="SAFETY";api.answer="말해 줘서 고마워요. 1388";
  await page.fill("#q","요즘 집에 가기가 무서워요");
  await page.click("#askbtn");
  await helpShown("server SAFETY");
  check(await flagCount()===3,"expected 3 flag timestamps");
  await h.hold(1700);
  await nav(page.locator("#helpnav .btn",{hasText:"처음부터"}));
  await page.waitForSelector("#screen.cover",{timeout:5000});
  const st=await page.evaluate(()=>({flag:state.flag,askCount,log:chatLog.length,note:state.note}));
  check(st.flag===null&&st.askCount===0&&st.log===0&&st.note==="","처음부터 after help did not reset: "+JSON.stringify(st));
  check(!(await flagged()),"crest cue still on after the teacher confirmed");

  // 6) 설정: 저장된 키는 입력칸에 다시 나오지 않음, 모델 버튼이 입력 중인 키를 지우지 않음, AI 기능 끄기
  await page.evaluate(()=>localStorage.setItem("maum_tarot_cfg",JSON.stringify({apiKey:"sk-ant-api03-SECRETSECRETSECRET-abcd",model:"claude-3-haiku-20240307"})));
  await page.click(".menubtn");
  await page.locator("#sheet .row",{hasText:"설정"}).click();
  check(await page.inputValue("#apikey")===""&&await page.getAttribute("#apikey","value")===null,"stored key echoed into the input");
  const ks=await page.textContent("#keystate");
  check(ks.includes("sk-ant-…abcd")&&!ks.includes("SECRET"),"key state should show only the masked key: "+ks);
  check(!(await page.content()).includes("SECRETSECRET"),"stored key found in the DOM");
  await page.fill("#apikey","sk-ant-typing");
  await page.locator("#pickrow button").nth(1).click();
  check(await page.inputValue("#apikey")==="sk-ant-typing","model button wiped the typed key");
  check(await page.evaluate(()=>loadCfg().model)==="claude-sonnet-5-5","model pick not saved");
  await page.check("#aioff");
  check(await page.evaluate(()=>loadCfg().aiOff===true),"AI off not saved");
  await page.locator("#sheet .btn",{hasText:"저장"}).click();
  check(await page.evaluate(()=>loadCfg().apiKey)==="sk-ant-typing","저장 did not store the new key");
  check(await page.locator("#sheet").count()===0,"저장 should close the settings sheet");
  await nav(page.locator(".poster .start"));
  await atStep("s-color");
  await scr(" .rows .row").first().click();
  await nav(primary());
  await atStep("s-topic");
  await scr(" .rows .row").first().click();
  await nav(primary());
  await atStep("s-draw");
  await h.drawThree();
  check(await page.locator("#screen .chat").count()===0&&await page.locator("#q").count()===0,"chat shown although AI is off");
  check(await page.evaluate(()=>performance.getEntriesByType("resource").every(e=>!e.name.includes("anthropic.com")))&&api.calls.length===3,"AI call made although AI is off: "+api.calls.length);

  await h.finish(label);
  }finally{await h.ctx.close()}
}

/* 화면·창 점검 — 화면 크기마다 한 번 */
async function uxRun(browser,vp){
  const label=`${vp.width}x${vp.height} ux`,wide=vp.width>=900;
  const h=await open(browser,vp);
  const {page,scr,primary,atStep,nav}=h;
  const overflow=()=>page.evaluate(()=>Math.max(0,document.scrollingElement.scrollHeight-innerHeight));
  const scale=()=>page.evaluate(()=>{const m=(document.querySelector(".shell").style.transform||"").match(/scale\(([\d.]+)\)/);return m?+m[1]:1});
  const fits=async where=>{if(wide){const o=await overflow();check(o<=1,`${where}: page scrolls by ${o}px on a wide screen`)}};
  const cfg=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("maum_tarot_cfg")||"{}"));
  const openSheet=async name=>{await page.click(".menubtn");await page.locator("#sheet .row",{hasText:name}).click();await page.waitForSelector("#sheet .sheetbox[role=dialog][aria-modal=true]")};
  try{
  // 1) 표지 그림이 늦게 와도 자리가 잡혀 있고 진짜 '시작하기' 버튼이 보임
  let release;const held=new Promise(r=>release=r);
  await h.ctx.route("**/cards/cover.jpg",async r=>{await held;return r.fallback()});
  await page.goto(BASE.href,{waitUntil:"domcontentloaded"});
  await page.waitForSelector(".poster .start");
  const early=await page.evaluate(()=>{const p=document.querySelector(".poster").getBoundingClientRect(),b=document.querySelector(".poster .start"),r=b.getBoundingClientRect();
    return {ratio:p.height/p.width,bw:r.width,bh:r.height,color:getComputedStyle(b).color,loaded:document.querySelector(".poster").classList.contains("loaded"),text:b.textContent}});
  check(Math.abs(early.ratio-1.5)<.02&&early.bw>80&&early.bh>20&&!early.loaded&&early.text.includes("시작하기")&&!/rgba\(0, 0, 0, 0\)/.test(early.color),"cover not ready before its image: "+JSON.stringify(early));
  release();
  await page.waitForSelector(".poster.loaded",{timeout:8000});
  await fits("cover");

  // 2) 색 · 주제: aria-pressed, 넓은 화면은 스크롤 없음, 세운 태블릿·휴대폰은 축소 없음
  await page.locator(".poster .start").click();
  await atStep("s-color");
  check(await primary().isDisabled()&&(await primary().textContent()).includes("골라"),"disabled 다음 should say what to do");
  await scr(" .rows .row").nth(5).click();
  check(await page.locator("#screen .row[aria-pressed=true]").count()===1,"selected color row lacks aria-pressed");
  if(!wide)check(await scale()===1,"tablet/phone should not be scaled");
  await fits("color");
  await nav(primary());
  await atStep("s-topic");
  check(await page.evaluate(()=>document.activeElement&&document.activeElement.tagName==="H2"),"focus should move to the step heading");
  await scr(" .rows .row").nth(1).click();
  await fits("topic");
  await nav(primary());
  await atStep("s-draw");
  check(await page.getAttribute("#status","aria-live")==="polite","#status should be a live region");
  await page.waitForFunction(()=>!document.getElementById("fan").classList.contains("locked"),null,{timeout:5000});
  await wait(500);
  await fits("draw");

  // 3) 부채꼴이 탁자 안에, 뒤집은 카드도 탁자 안에, 안내 글은 카드를 가리지 않음
  const fanBox=await page.evaluate(()=>{const r=document.querySelector(".tarot-room").getBoundingClientRect();const cs=[...document.querySelectorAll("#fan .card")].map(c=>c.getBoundingClientRect());
    return {l:Math.min(...cs.map(c=>c.left))-r.left,r:r.right-Math.max(...cs.map(c=>c.right))}});
  check(fanBox.l>=-1&&fanBox.r>=-1,"fan cards stick out of the room: "+JSON.stringify(fanBox));
  // 키보드로 고르기: Enter → 뒤집기, 끝나면 그 카드는 Tab 에서 빠지고 초점은 옆 카드로, 탁자는 스크롤되지 않음
  await page.locator("#fan .card").nth(4).focus();
  await page.keyboard.press("Enter");
  await wait(1250);
  const rev=await page.evaluate(()=>{const room=document.querySelector(".tarot-room").getBoundingClientRect(),c=document.querySelector("#fan .card.chosen").getBoundingClientRect(),st=document.getElementById("status").getBoundingClientRect();
    return {top:c.top-room.top,bottom:room.bottom-c.bottom,stTop:st.top,cardBottom:c.bottom,revealing:document.querySelector(".tarot-room").classList.contains("revealing")}});
  check(rev.top>=0&&rev.revealing&&rev.stTop>=rev.cardBottom-2,"revealed card clipped or covered by the status: "+JSON.stringify(rev));
  await page.waitForFunction(()=>document.querySelectorAll("#slots .slot.filled").length===1&&!document.querySelector("#fan .card.chosen"),null,{timeout:6000});
  const kb=await page.evaluate(()=>({t:document.querySelectorAll("#fan .card")[4].tabIndex,a:document.activeElement.classList.contains("card")&&!document.activeElement.classList.contains("hide"),s:document.querySelector(".tarot-room").scrollTop}));
  check(kb.t===-1&&kb.a&&kb.s===0,"keyboard pick: "+JSON.stringify(kb));
  await page.keyboard.press("Enter");   // 옆 카드로 옮겨 간 초점에서 바로 두 번째 카드
  await page.waitForFunction(()=>document.querySelectorAll("#slots .slot.filled").length===2&&!document.querySelector("#fan .card.chosen"),null,{timeout:6000});
  await page.locator("#fan .card:not(.hide)").first().dispatchEvent("click");
  await page.waitForFunction(()=>document.querySelectorAll("#slots .slot.filled").length===3&&!document.querySelector("#fan .card.chosen"),null,{timeout:6000});
  await wait(800);
  await fits("draw after 3 cards");
  await nav(page.locator("#go"));
  await atStep("s-reading");

  // 4) 리딩: 글씨가 15px 밑으로 줄지 않음, 대화는 role=log, 한글 조합 중 Enter 는 보내지 않음
  const eff=await page.evaluate(()=>{const m=(document.querySelector(".shell").style.transform||"").match(/scale\(([\d.]+)\)/),s=m?+m[1]:1;
    return {reading:parseFloat(getComputedStyle(document.querySelector(".reading p")).fontSize)*s,bubble:parseFloat(getComputedStyle(document.querySelector(".bubble")).fontSize)*s}});
  if(vp.width>700)check(eff.reading>=14.9&&eff.bubble>=14.9,"reading text too small: "+JSON.stringify(eff));
  check(await page.getAttribute("#chatlog","role")==="log","#chatlog should be role=log");
  await page.fill("#q","한글 입력 중");
  await page.dispatchEvent("#q","keydown",{key:"Enter",isComposing:true});
  await wait(200);
  check(await page.inputValue("#q")==="한글 입력 중"&&await page.locator("#chatlog .msg").count()===1,"Enter during IME composition sent the question");
  // 다시 뽑기를 취소하면 리딩이 그대로
  h.answer=false;
  await nav(page.locator("#screen .nav .btn",{hasText:"다시 뽑기"}));
  await wait(300);
  check(await page.locator("#screen.s-reading").count()===1,"cancelled 다시 뽑기 still wiped the reading");
  h.answer=true;
  await nav(primary());
  await atStep("s-scent");
  await fits("scent");

  // 5) 설정 창: 진짜 대화상자, '저장'이 창 안에서 눌림, Esc 로 닫히고 초점이 메뉴 버튼으로 돌아감
  await openSheet("설정");
  const sv=await page.evaluate(()=>{const box=document.querySelector("#sheet .sheetbox"),b=[...box.querySelectorAll(".btn")].find(x=>x.textContent.trim()==="저장");
    b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {over:box.scrollWidth-box.clientWidth,hit:!!hit&&(hit===b||b.contains(hit)),inBox:r.right<=box.getBoundingClientRect().right}});
  check(sv.over<=0&&sv.hit&&sv.inBox,"settings 저장 not reachable: "+JSON.stringify(sv));
  check(await page.evaluate(()=>document.querySelector(".app").inert===true),"background should be inert while a sheet is open");
  await page.keyboard.press("Escape");
  check(await page.locator("#sheet").count()===0,"Escape did not close a clean sheet");
  check(await page.evaluate(()=>document.activeElement&&document.activeElement.classList.contains("menubtn")),"focus not returned to the menu button");
  // 고친 내용(새 키)이 있으면 바깥을 눌러도 닫히지 않고, 닫기는 물어봄(취소하면 그대로, 확인하면 저장 없이 닫힘)
  await openSheet("설정");
  await page.fill("#apikey","sk-ant-unsaved");
  await page.mouse.click(4,4);
  check(await page.locator("#sheet").count()===1,"backdrop click closed a sheet with unsaved changes");
  h.answer=false;
  const before=h.dialogs.length;
  await page.keyboard.press("Escape");
  check(h.dialogs.length===before+1&&await page.locator("#sheet").count()===1,"Escape on a dirty sheet should ask and stay open when cancelled");
  h.answer=true;
  await page.locator("#sheet .btn",{hasText:"닫기"}).click();
  check(await page.locator("#sheet").count()===0&&!(await cfg()).apiKey,"닫기 after confirm should close without saving the key");
  // Tab 은 창 안에서만 돔
  await openSheet("도움말");
  for(let i=0;i<4;i++)await page.keyboard.press("Tab");
  check(await page.evaluate(()=>document.getElementById("sheet").contains(document.activeElement)),"Tab left the dialog");
  await page.keyboard.press("Escape");

  // 6) 향기 목록: '기본값으로'는 저장을 눌러야 적용, 닫기를 누르면 원래 목록 그대로
  await page.evaluate(()=>localStorage.setItem("maum_tarot_cfg",JSON.stringify({scents:[{name:"테스트향",mood:"calm",desc:""}]})));
  await openSheet("향기 목록");
  check(await page.locator("#scentedit .srow").count()===1,"custom scent list not loaded");
  const sb=await page.evaluate(()=>{const box=document.querySelector("#sheet .sheetbox");return box.scrollWidth-box.clientWidth});
  check(sb<=0,"scent editor overflows sideways by "+sb);
  await page.locator("#sheet .btn",{hasText:"기본값으로"}).click();
  check(await page.locator("#scentedit .srow").count()===CONTENT.DEFAULT_SCENTS.length,"기본값으로 did not fill the editor");
  check(((await cfg()).scents||[]).length===1,"기본값으로 changed the saved list before 저장");
  await page.locator("#sheet .btn",{hasText:"닫기"}).click();
  check(await page.locator("#sheet").count()===0&&((await cfg()).scents||[]).length===1,"닫기 after 기본값으로 lost the custom list");
  await openSheet("향기 목록");
  await page.locator("#sheet .btn",{hasText:"기본값으로"}).click();
  await page.locator("#sheet .btn",{hasText:"저장"}).click();
  check(await page.locator("#sheet").count()===0&&(await cfg()).scents===null,"기본값으로 + 저장 should store the default list (null)");

  await h.finish(label);
  }finally{await h.ctx.close()}
}

(async()=>{
  const browser=await pw.chromium.launch();
  let failed=0;
  try{
    for(const vp of VIEWPORTS){
      for(let n=0;n<RUNS;n++){
        try{await run(browser,vp,n)}
        catch(e){failed++;console.log(`FAIL ${vp.width}x${vp.height} #${n+1}: ${e.message}`)}
      }
      try{await safetyRun(browser,vp)}
      catch(e){failed++;console.log(`FAIL ${vp.width}x${vp.height} safety: ${e.message}`)}
    }
    for(const vp of UX_VIEWPORTS){
      try{await uxRun(browser,vp)}
      catch(e){failed++;console.log(`FAIL ${vp.width}x${vp.height} ux: ${e.message}`)}
    }
  }finally{await browser.close()}
  console.log(failed?`${failed} run(s) failed`:`all ${VIEWPORTS.length*(RUNS+1)+UX_VIEWPORTS.length} runs passed (${BASE.href})`);
  process.exit(failed?1:0);
})();
