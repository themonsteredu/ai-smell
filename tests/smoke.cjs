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
const HIDDEN_IMGS=CONTENT.cards.filter(c=>c.hidden).map(c=>c.img);
const FAN=Math.min(36,CONTENT.deckPool().length);

/* vercel.json 의 "/(.*)" 헤더 — 로컬 서버에서도 실제 배포와 같은 CSP 로 돌려 봄 */
const vercel=JSON.parse(fs.readFileSync(path.join(__dirname,"..","vercel.json"),"utf8"));
const SITE_HEADERS=Object.fromEntries(((vercel.headers||[]).find(h=>h.source==="/(.*)")||{headers:[]}).headers.map(h=>[h.key.toLowerCase(),h.value]));

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const isHiddenImg=src=>HIDDEN_IMGS.some(h=>String(src||"").replace(/^.*?(cards\/)/,"$1").split("?")[0]===h);
function check(cond,msg){if(!cond)throw new Error(msg)}

/* 새 브라우저 창 하나와 공통 도우미. api.reason 을 바꾸면 /api/ask 가짜 답이 바뀜(기본 NO_KEY) */
async function open(browser,vp){
  const ctx=await browser.newContext({viewport:vp});
  const errors=[],hiddenSeen=new Set(),api={reason:"NO_KEY",answer:null,calls:[]};
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

  const h={ctx,page,errors,hiddenSeen,api};
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
  const label=`${vp.width}x${vp.height} #${n+1}`;
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
    // 메뉴 → 처음 화면: 다음 학생에게 아무것도 남지 않아야 함
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
  await nav(page.locator("#screen .nav .btn",{hasText:"다시 뽑기"}));
  await atStep("s-draw");
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
  await page.click("#sheet",{position:{x:5,y:5}});
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
  }finally{await browser.close()}
  console.log(failed?`${failed} run(s) failed`:`all ${VIEWPORTS.length*(RUNS+1)} runs passed (${BASE.href})`);
  process.exit(failed?1:0);
})();
