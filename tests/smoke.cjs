#!/usr/bin/env node
/* Playwright 점검 — 표지 → 색 → 주제 → 카드 3장 → 리딩(질문 1개) → 향기 → 이전 → 향기 → 처음부터
   사용법:  node tests/smoke.cjs [--base http://localhost:8091/] [--runs 3]
     (먼저 저장소를 띄워 두세요:  npx http-server . -p 8091 -s -c-1 . Vercel 미리보기 주소도 됩니다)
   - 390x844(휴대폰)와 1366x768(노트북)에서 각각 --runs 번 진행합니다. 홀수 번째 진행은
     리딩 화면에서 ☰ 메뉴 → 처음 화면 으로 나가, 다음 학생에게 앞 학생 기록이 남지 않는지 봅니다.
   - 화면 크기마다 '안전 점검'을 한 번 더 합니다: 위험한 고민 한 줄·질문 → 도움 안내 화면(네트워크 호출 없음)
     → 같은 기기의 새 창에서도 도움 안내 → 선생님 확인 길게 누르기 → 이어서 하기(두 번 눌러도 아래 주제가 안 바뀜) / 처음부터,
     서버의 SAFETY·RATE 답, 다시 뽑기 후 남은 질문 수, 설정에서 키가 다시 보이지 않는지, AI 기능 끄기.
     준비된 답변은 질문마다 다르고 남은 질문 수를 줄이지 않음.
   - pageerror 나 console error 가 하나라도 나면 실패합니다. (Vercel 미리보기에만 붙는 도구 막대 vercel.live 가
     CSP 에 막혀 남기는 오류는 앱과 상관없어 셈하지 않아요)
   - 창(메뉴·설정 등)이 열리거나 닫힌 뒤, 도움 안내에서 이어서 하기·처음부터를 누른 뒤 0.35초 동안은 누르기를 받지 않으므로
     (두 번 누르기 방지) 그 바로 뒤에 누를 때는 sheetWait 만큼 기다려요.
   - 숨긴 카드(content.js 의 hidden:true) 그림이 요청되거나 화면 어디에(부채꼴·칸·결과) 보이면 실패합니다.
   - 화면·창 점검(ux)을 390x844 · 820x1180 · 1024x768 · 1366x768 · 1920x1080 에서 한 번씩 합니다:
     표지 그림이 늦어도 자리와 시작 버튼이 보이는지, 넓은 화면에서 색·주제·카드·향기 단계가 스크롤 없이 들어오는지,
     뒤집은 카드가 탁자 안에 다 보이는지, 리딩 글이 15px 밑으로 줄지 않는지, 설정 '저장'이 창 안에 있는지,
     Esc·바깥 누르기·고친 내용 확인, 창의 닫기를 두 번 눌러도 아래 화면이 눌리지 않는지(메뉴·그림 이야기),
     메뉴 → 향기 목록을 두 번 눌러도 입력칸에 초점이 가지 않는지, '기본값으로'가 저장 전에는 향기 목록을 지우지 않는지, 키보드로 카드 고르기,
     한글 조합 중 Enter 로 질문이 나가지 않는지.
   - 재미 요소 점검(fun)을 390x844 · 1366x768 에서 한 번씩, 읽어 주기가 없는 브라우저로 390x844 에서 한 번 더:
     소리·진동·반짝임, 카드 그림 이야기(클릭·키보드), '이걸 물어볼래요', 읽어 주기, 글씨 크게, 소리 끄기(새로고침 뒤에도).
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
const sheetWait=()=>wait(400);   // index.html 의 SHEET_GUARD(350ms)보다 조금 길게
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
    // 창(탭)을 닫는 사이 오던 요청은 그냥 버림(닫힌 창의 요청을 채우려다 점검 전체가 멈추지 않게)
    const resp=await route.fetch().catch(()=>null);
    if(resp)await route.fulfill({response:resp,headers:{...resp.headers(),...SITE_HEADERS}}).catch(()=>{});
  });
  const page=await ctx.newPage();
  page.on("pageerror",e=>errors.push("pageerror: "+e.message));
  page.on("console",m=>{if(m.type()==="error"&&!/vercel\.live/.test(m.text()))errors.push("console: "+m.text())});
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
  check((await page.textContent(".ainote")).includes("AI 도우미에게 보내져요"),"AI notice missing under the chat divider");
  check((await page.textContent("#chathint"))==="","no question counter on a device where AI cannot answer");
  check(await page.locator("#chatlog .msg").count()===1,"chat should start with the greeting only");
  check((await page.textContent("#chatlog .msg .src")).includes("안내"),"greeting should carry the 안내 tag");
  await h.askQ("이 카드는 무슨 뜻이에요?",3);
  check((await page.textContent("#chathint"))===""&&await page.evaluate(()=>askCount)===0,"a prepared (non-AI) answer must not use up a question");
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
    await sheetWait();
    await page.locator("#sheet .row",{hasText:"처음 화면"}).click();
    await wait(300);
    check(h.dialogs.length===1&&await page.locator("#screen.s-reading").count()===1,"처음 화면 should ask first and stay when cancelled");
    h.answer=true;
    await wait(500);
    await page.click(".menubtn");
    await sheetWait();
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
    check((await page.textContent("#chathint"))==="","hint wrong after 이전");
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
  // 같은 기기에서 창(탭)을 새로 열어도 도움 안내(학생이 탭을 닫았다 열어 '선생님 확인'을 건너뛰지 못하게)
  const p2=await h.ctx.newPage();
  await p2.goto(BASE.href,{waitUntil:"load"});
  check(await p2.locator("#screen.s-help .helpcard").count()===1,"a new tab on the same device should show the help card too");
  await p2.close();
  await page.click(".menubtn");
  check(await page.locator("#sheet .row",{hasText:"처음 화면"}).count()===0,"menu offers 처음 화면 while flagged");
  await sheetWait();
  await page.locator("#sheet .btn",{hasText:"닫기"}).click();
  await h.hold(300);   // 짧게 누르면 아무 일도 없음
  check(await page.locator("#helpnav .btn").count()===0,"short press dismissed the help card");
  await h.hold(1700);
  const topic=await page.evaluate(()=>state.topic);
  await page.locator("#helpnav .btn",{hasText:"이어서 하기"}).dblclick();   // 두 번째 클릭이 아래 주제 줄을 누르지 않아야 함
  await atStep("s-topic");
  await wait(450);
  check(await page.evaluate(()=>state.topic)===topic,"double-click on 이어서 하기 changed the topic underneath");
  check(await page.inputValue("#note")==="","flagged note should be cleared on resume");
  check(await flagged(),"crest cue must stay red until 확인했어요 in Settings (a student could hold 선생님 확인 too)");

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
  await sheetWait();   // 이어서 하기 직후 0.35초는 누르기를 받지 않음(두 번 누르기 방지)
  check(await page.locator("#chatlog .msg").count()===1,"chat should hold only the greeting after resume");
  check(await page.evaluate(()=>askCount)===0,"crisis question used up a question");

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
  await page.fill("#q","요즘 마음이 너무 힘들어요");   // 기기 안의 확인에는 걸리지 않고 서버(AI)만 위험하다고 본 경우
  await page.click("#askbtn");
  await helpShown("server SAFETY");
  check(await flagCount()===3,"expected 3 flag timestamps");
  await h.hold(1700);
  await nav(page.locator("#helpnav .btn",{hasText:"처음부터"}));
  await page.waitForSelector("#screen.cover",{timeout:5000});
  const st=await page.evaluate(()=>({flag:state.flag,askCount,log:chatLog.length,note:state.note}));
  check(st.flag===null&&st.askCount===0&&st.log===0&&st.note==="","처음부터 after help did not reset: "+JSON.stringify(st));
  check(await flagged(),"crest cue should stay red after 처음부터 until the log is confirmed in Settings");

  // 6) 설정: 저장된 키는 입력칸에 다시 나오지 않음, 모델 버튼이 입력 중인 키를 지우지 않음, AI 기능 끄기
  await page.evaluate(()=>localStorage.setItem("maum_tarot_cfg",JSON.stringify({apiKey:"sk-ant-api03-SECRETSECRETSECRET-abcd",model:"claude-3-haiku-20240307"})));
  await sheetWait();   // 처음부터 직후 0.35초는 누르기를 받지 않음
  await page.click(".menubtn");
  await sheetWait();
  await page.locator("#sheet .row",{hasText:"설정"}).click();
  await sheetWait();
  // 도움 안내 기록: '확인했어요'는 짧게 누르면 그대로, 1.5초 길게 눌러야 붉은 표시가 사라짐
  check((await page.textContent("#flaginfo")).includes("아직 확인하지 않은 기록 3번"),"settings should list the 3 unseen help records");
  const holdSee=async ms=>{const b=await page.locator("#seeflags").boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await wait(ms);await page.mouse.up()};
  await page.locator("#seeflags").scrollIntoViewIfNeeded();
  await holdSee(300);
  check(await flagged()&&await page.locator("#seeflags").count()===1,"a short press on 확인했어요 cleared the crest");
  await holdSee(1700);
  check(!(await flagged())&&await page.locator("#seeflags").count()===0&&!(await page.textContent("#flaginfo")).includes("아직"),"long-press on 확인했어요 should clear the crest cue");
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
  // 화면 맞춤(fit)은 크기가 바뀐 뒤 다음 그림 때(requestAnimationFrame) 다시 계산되므로, 바로 재지 말고 잠깐 자리 잡기를 기다림
  const settle=()=>page.waitForFunction(()=>document.scrollingElement.scrollHeight-innerHeight<=1,null,{timeout:1500}).catch(()=>{});
  const fits=async where=>{if(wide){await settle();const o=await overflow();check(o<=1,`${where}: page scrolls by ${o}px on a wide screen`)}};
  const cfg=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("maum_tarot_cfg")||"{}"));
  const openSheet=async name=>{await sheetWait();await page.click(".menubtn");await sheetWait();await page.locator("#sheet .row",{hasText:name}).click();await page.waitForSelector("#sheet .sheetbox[role=dialog][aria-modal=true]");await sheetWait()};
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
  // 두 번 누르기: 메뉴의 닫기를 두 번 눌러도 두 번째가 아래 주제 줄·카드 펼치기를 누르지 않음,
  // 메뉴의 '향기 목록'을 두 번 눌러도 향기 목록 창의 입력칸·고르기 칸에 초점이 가지 않음(태블릿 키보드·펼침 방지)
  const topic=await page.evaluate(()=>state.topic);
  await page.click(".menubtn");
  await sheetWait();
  await page.locator("#sheet .btn",{hasText:"닫기"}).dblclick();
  await wait(450);
  const t2=await page.evaluate(()=>({topic:state.topic,step:state.step,sheet:!!document.getElementById("sheet")}));
  check(t2.topic===topic&&t2.step===1&&!t2.sheet,"double-click on the menu's 닫기 carried into the screen below: "+JSON.stringify(t2));
  await page.click(".menubtn");
  await sheetWait();
  const sr=await page.locator("#sheet .row",{hasText:"향기 목록"}).boundingBox();
  await page.mouse.dblclick(sr.x+sr.width/2,sr.y+sr.height/2);
  await wait(450);
  const fe=await page.evaluate(()=>({tag:document.activeElement&&document.activeElement.tagName,editor:!!document.getElementById("scentedit")}));
  check(fe.editor&&fe.tag!=="INPUT"&&fe.tag!=="SELECT","double-click on 향기 목록 focused a field in the scent editor: "+JSON.stringify(fe));
  await page.keyboard.press("Escape");
  await sheetWait();
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
  await page.fill("#q","");
  // 결과 카드를 두 번 눌러도 그림 이야기 창이 열린 채(두 번째 클릭이 바깥을 눌러 바로 닫지 않음)
  await page.locator("#screen .result").first().dblclick();
  await wait(450);
  check(await page.locator("#sheet .storybox").count()===1,"double-click on a result card opened and closed its story at once");
  // 그림 이야기의 닫기를 두 번 눌러도 두 번째가 아래의 다른 카드 그림 이야기를 열지 않음
  await page.locator("#sheet .btn",{hasText:"닫기"}).dblclick();
  await wait(450);
  check(await page.locator("#sheet").count()===0,"double-click on the story's 닫기 opened another sheet underneath");
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
  // 두 번 누르기: ☰ 를 두 번 눌러도 메뉴가 열린 채, 메뉴의 '설정'을 두 번 눌러도 두 번째 클릭이 설정 창의 버튼(모델·AI 끄기)을 누르지 않음
  await wait(500);
  await page.dblclick(".menubtn");
  await wait(450);
  check(await page.locator("#sheet .row").count()>0,"double-click on ☰ should leave the menu open");
  const before2=await cfg();
  for(const [i,dx] of [-40,0,40].entries()){
    if(i){await page.keyboard.press("Escape");await sheetWait();await page.click(".menubtn");await wait(450)}
    const b=await page.locator("#sheet .row",{hasText:"설정"}).boundingBox();
    await page.mouse.dblclick(b.x+b.width/2+dx,b.y+b.height/2);
    await wait(450);
    const after2=await cfg();
    check(await page.locator("#pickrow").count()===1&&after2.model===before2.model&&after2.aiOff===before2.aiOff,`double-click (dx ${dx}) carried into the settings sheet: ${JSON.stringify(after2)}`);
  }
  await page.keyboard.press("Escape");
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

/* 재미 요소 점검 — 소리(AudioContext 를 감싸 만든 소리를 셈)·진동·반짝임, 카드 그림 이야기(클릭·Enter·스페이스),
   '이걸 물어볼래요'(질문 칸에 넣기만, 보내지 않음), 읽어 주기(speechSynthesis 를 가짜로 바꿔 읽은 글을 셈),
   글씨 크게(계산된 글씨 크기 1.2배), 소리 끄기·글씨 크게가 새로고침 뒤에도 남는지, 소리를 끄면 소리·진동이 전혀 없는지,
   '동작 줄이기'면 반짝임이 없는지. tts=false: 읽어 주기가 없는 브라우저 — 🔊 버튼이 하나도 없어야 함 */
async function funRun(browser,vp,tts){
  const label=`${vp.width}x${vp.height} fun${tts?"":" (no speech)"}`;
  const h=await open(browser,vp);
  const {page,scr,primary,atStep,nav,api}=h;
  await page.addInitScript(tts=>{
    const fx=window.__fx={ctx:0,osc:0,noise:0,vib:0,spoken:[],cancel:0};
    const A=window.AudioContext;
    if(A)window.AudioContext=class extends A{
      constructor(...a){super(...a);fx.ctx++}
      createOscillator(){fx.osc++;return super.createOscillator()}
      createBiquadFilter(){fx.noise++;return super.createBiquadFilter()}};
    navigator.vibrate=()=>{fx.vib++;return true};
    if(!tts){delete window.speechSynthesis;delete window.SpeechSynthesisUtterance}
    else if(window.speechSynthesis){
      speechSynthesis.speak=u=>fx.spoken.push({text:u.text,lang:u.lang,rate:u.rate});
      const c=speechSynthesis.cancel.bind(speechSynthesis);speechSynthesis.cancel=()=>{fx.cancel++;c()};
    }
  },tts);
  const fx=()=>page.evaluate(()=>window.__fx);
  const cfg=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("maum_tarot_cfg")||"{}"));
  const speaks=()=>page.locator(".speak").count();
  const toDraw=async()=>{
    await page.locator(".poster .start").click();   // 진짜 클릭 — 이때 소리가 깨어남(iOS 방식)
    await atStep("s-color");
    await scr(" .rows .row").nth(3).click();
    await nav(primary());
    await atStep("s-topic");
    await scr(" .rows .row").nth(2).click();
    await nav(primary());
    await atStep("s-draw");
    await page.waitForFunction(()=>!document.getElementById("fan").classList.contains("locked"),null,{timeout:5000});
  };
  const pick3=async()=>{
    for(let k=0;k<3;k++){
      await page.locator("#fan .card:not(.hide)").nth(2+k).dispatchEvent("click");
      await page.waitForFunction(k=>document.querySelectorAll("#slots .slot.filled").length===k+1&&!document.querySelector("#fan .card.chosen"),k,{timeout:6000});
    }
  };
  const fontOf=sel=>page.evaluate(sel=>parseFloat(getComputedStyle(document.querySelector(sel)).fontSize),sel);
  try{
  await page.goto(BASE.href,{waitUntil:"load"});
  check(await page.getAttribute("#sndbtn","aria-pressed")==="true"&&(await page.textContent("#sndbtn")).includes("🔈"),"sound should default to on");
  check(await page.getAttribute("#fsbtn","aria-pressed")==="false","big text should default to off");
  check((await fx()).ctx===0,"AudioContext created before any tap");

  // 1) 소리·진동·반짝임: 섞기 3번(잡음), 뒤집기 3번(종 2음 + 진동), 세 장째 '도미솔도' 4음 + 반짝임
  await toDraw();
  let f=await fx();
  check(f.ctx===1&&f.noise>=3,"shuffle should make the riffle sound once the first tap unlocked audio: "+JSON.stringify(f));
  await pick3();
  check(await page.locator(".tarot-room .sparks .spark").count()===16,"no sparkle burst when the third card landed");
  f=await fx();
  check(f.osc===3*2+4&&f.vib===3,"bell+vibrate per flip and the 4-note arpeggio at the third card: "+JSON.stringify({osc:f.osc,vib:f.vib}));
  await nav(page.locator("#go"));
  await atStep("s-reading");
  const draw=await page.evaluate(()=>state.draw.map(d=>({ko:d.ko,rev:!!d.rev})));
  const card=i=>CONTENT.cards.find(c=>c.ko===draw[i].ko);

  // 2) 카드 그림 이야기: 클릭으로 열기 · 큰 그림(역방향이면 돌림) · 이야기 · 상징 버튼 · Esc 로 닫으면 그 카드로 초점
  const res=page.locator("#screen .result");
  check(await res.count()===3&&(await res.evaluateAll(rs=>rs.every(r=>r.getAttribute("role")==="button"&&r.tabIndex===0))),"result cards should be role=button and focusable");
  await res.nth(0).click();
  await page.waitForSelector("#sheet .storybox");
  await sheetWait();
  const s0=await page.evaluate(()=>({h:document.querySelector("#sheet h3").textContent,story:document.getElementById("storytext").textContent,
    rev:document.querySelector("#sheet .storybox img").classList.contains("rev"),src:document.querySelector("#sheet .storybox img").getAttribute("src"),
    chips:[...document.querySelectorAll("#sheet .lookchip")].map(b=>b.textContent),shown:[...document.querySelectorAll("#sheet .lookmean")].filter(m=>!m.hidden).length,
    ask:(document.getElementById("storyask")||{}).textContent}));
  check(s0.h===draw[0].ko&&s0.story===card(0).story&&s0.rev===draw[0].rev&&s0.src===card(0).img&&s0.ask===card(0).ask,"card story sheet content: "+JSON.stringify(s0));
  check(JSON.stringify(s0.chips)===JSON.stringify(card(0).look.map(l=>l[0]))&&s0.shown===0,"symbol chips should match look[] with meanings hidden: "+JSON.stringify(s0.chips));
  await page.locator("#sheet .lookchip").nth(1).click();
  const m1=await page.evaluate(()=>{const b=document.querySelectorAll("#sheet .lookchip")[1],m=document.getElementById(b.getAttribute("aria-controls"));return {exp:b.getAttribute("aria-expanded"),hidden:m.hidden,text:m.textContent}});
  check(m1.exp==="true"&&!m1.hidden&&m1.text.includes(card(0).look[1][1]),"tapping a symbol should reveal its meaning: "+JSON.stringify(m1));
  await page.locator("#sheet .lookchip").nth(1).click();
  check(await page.evaluate(()=>document.getElementById("lm1").hidden),"tapping the symbol again should hide the meaning");
  await page.keyboard.press("Escape");
  check(await page.locator("#sheet").count()===0,"Escape should close the card story");
  check(await page.evaluate(()=>document.activeElement===document.querySelectorAll("#screen .result")[0]),"focus should return to the card after closing its story");
  // 키보드: Enter · 스페이스
  await res.nth(1).focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#sheet .storybox");
  check(await page.textContent("#sheet h3")===draw[1].ko,"Enter on the 2nd card should open its story");
  await page.keyboard.press("Escape");
  await res.nth(2).focus();
  await page.keyboard.press(" ");
  await page.waitForSelector("#sheet .storybox");
  check(await page.textContent("#sheet h3")===draw[2].ko,"Space on the 3rd card should open its story");
  if(tts)check(await page.locator("#sheet .speak").count()===1,"story sheet should offer read-aloud");
  // 3) '이걸 물어볼래요': 창을 닫고 '카드 이름 카드: 질문'을 질문 칸에 넣기만(보내지 않음, 남은 질문 수 그대로)
  const calls=api.calls.length;
  await sheetWait();
  await page.locator("#sheet .askbox .btn",{hasText:"이걸 물어볼래요"}).click();
  check(await page.locator("#sheet").count()===0,"이걸 물어볼래요 should close the sheet");
  check(await page.inputValue("#q")===`${draw[2].ko} 카드: ${card(2).ask}`&&await page.evaluate(()=>document.activeElement.id)==="q","the question should land in the chat input (focused)");
  await wait(600);
  check(await page.locator("#chatlog .msg").count()===1&&api.calls.length===calls&&await page.evaluate(()=>askCount)===0,"이걸 물어볼래요 must not send the question");
  await page.fill("#q","");

  // 4) 읽어 주기 (지원하면 리딩·답·향기 카드에 🔊, 아니면 하나도 없음)
  if(tts){
    check(await speaks()===2,"expected 🔊 on the reading and on the greeting bubble, got "+await speaks());
    await page.click("#readspeak");
    f=await fx();
    const paras=await page.locator("#reading p").count();
    check(f.spoken.length===paras&&f.spoken.every(u=>u.lang==="ko-KR"&&Math.abs(u.rate-.95)<.01)&&f.spoken[1].text.includes(draw[0].ko)&&!f.spoken.some(u=>u.text.includes("—")),
      "reading read-aloud: one ko-KR utterance per paragraph at rate .95: "+JSON.stringify(f.spoken.slice(0,2)));
    check(await page.getAttribute("#readspeak","aria-pressed")==="true","the reading button should show it is speaking");
    await page.click("#readspeak");
    check(await page.getAttribute("#readspeak","aria-pressed")==="false"&&(await fx()).spoken.length===paras,"pressing again should stop, not restart");
    await h.askQ("이 카드는 무슨 뜻이에요?",3);
    const ans=page.locator("#chatlog .msg.ai").last();
    check(await ans.locator(".speak").count()===1&&await page.locator("#chatlog .msg.me .speak").count()===0,"answer bubbles get 🔊, the student's own bubble does not");
    await ans.locator(".speak").click();
    const said=(await fx()).spoken.slice(paras).map(u=>u.text).join(" ");
    const shown=await ans.locator(".bubble").evaluate(b=>[...b.childNodes].filter(n=>!(n.classList&&n.classList.contains("src"))).map(n=>n.textContent).join(""));
    check(said.length>10&&!said.includes("준비된 답변")&&shown.replace(/\s+/g," ").trim().startsWith(said.slice(0,20)),"bubble read-aloud should read the answer without its tag: "+said);
  }else check(await speaks()===0&&await page.locator("#readspeak").count()===0,"🔊 buttons shown although speechSynthesis is missing");

  // 5) 글씨 크게: 계산된 글씨 크기가 1.2배, 다시 누르면 원래대로, 새로고침 뒤에도 남음
  const r0=await fontOf(".reading p"),b0=await fontOf(".bubble"),l0=await fontOf(".result h3");
  await page.click("#fsbtn");
  const r1=await fontOf(".reading p"),b1=await fontOf(".bubble"),l1=await fontOf(".result h3");
  check(Math.abs(r1/r0-1.2)<.02&&Math.abs(b1/b0-1.2)<.02&&Math.abs(l1/l0-1.2)<.02,`font toggle should scale text by 1.2: ${r0}→${r1}, ${b0}→${b1}, ${l0}→${l1}`);
  check(await page.getAttribute("#fsbtn","aria-pressed")==="true"&&(await cfg()).big===true,"big text not saved");

  // 6) 향기 카드 🔊, 화면이 바뀌면 읽기를 멈춤(cancel)
  await nav(primary());
  await atStep("s-scent");
  if(tts){
    check(await page.locator(".scent .speak").count()===3,"each scent card should have 🔊");
    const before=(await fx()).spoken.length;
    await page.locator(".scent .speak").first().click();
    f=await fx();
    const name=await page.textContent(".scent h3");
    check(f.spoken.length>before&&f.spoken[before].text.includes(name),"scent read-aloud should start with the scent name");
    const c0=f.cancel;
    await nav(page.locator("#screen .nav .btn:not(.primary)"));
    await atStep("s-reading");
    check((await fx()).cancel>c0,"render() should cancel speech");
  }else check(await speaks()===0,"🔊 on scent cards although speechSynthesis is missing");

  // 7) 소리 끄기 → 새로고침해도 꺼짐 · 소리·진동이 전혀 없음 · 글씨 크게도 남음 · '동작 줄이기'면 반짝임 없음
  await page.click("#sndbtn");
  check(await page.getAttribute("#sndbtn","aria-pressed")==="false"&&(await page.textContent("#sndbtn")).includes("🔇")&&(await cfg()).sound===false,"sound toggle not saved");
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.reload({waitUntil:"load"});
  check(await page.getAttribute("#sndbtn","aria-pressed")==="false"&&(await page.textContent("#sndbtn")).includes("🔇"),"sound off should survive a reload");
  check(await page.evaluate(()=>document.documentElement.classList.contains("big"))&&await page.getAttribute("#fsbtn","aria-pressed")==="true","big text should survive a reload");
  await toDraw();
  await pick3();
  f=await fx();
  check(f.ctx===0&&f.osc===0&&f.noise===0&&f.vib===0,"sound off: no audio and no vibration: "+JSON.stringify({ctx:f.ctx,osc:f.osc,noise:f.noise,vib:f.vib}));
  check(await page.locator(".tarot-room .spark").count()===0,"no sparkle under prefers-reduced-motion");
  await page.click("#fsbtn");
  check(!(await page.evaluate(()=>document.documentElement.classList.contains("big")))&&(await cfg()).big===false,"big text should turn off again");
  await page.click("#sndbtn");
  check((await cfg()).sound===true&&(await fx()).ctx===1,"turning sound on should wake audio right away (tap = user gesture)");

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
      try{await funRun(browser,vp,true)}
      catch(e){failed++;console.log(`FAIL ${vp.width}x${vp.height} fun: ${e.message}`)}
    }
    try{await funRun(browser,VIEWPORTS[0],false)}
    catch(e){failed++;console.log(`FAIL ${VIEWPORTS[0].width}x${VIEWPORTS[0].height} fun (no speech): ${e.message}`)}
    for(const vp of UX_VIEWPORTS){
      try{await uxRun(browser,vp)}
      catch(e){failed++;console.log(`FAIL ${vp.width}x${vp.height} ux: ${e.message}`)}
    }
  }finally{await browser.close()}
  console.log(failed?`${failed} run(s) failed`:`all ${VIEWPORTS.length*(RUNS+2)+1+UX_VIEWPORTS.length} runs passed (${BASE.href})`);
  process.exit(failed?1:0);
})();
