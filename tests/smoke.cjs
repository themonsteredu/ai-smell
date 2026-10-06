#!/usr/bin/env node
/* Playwright 점검 — 표지 → 색 → 주제 → 카드 3장 → 리딩(질문 1개) → 향기 → 이전 → 향기 → 처음부터
   사용법:  node tests/smoke.cjs [--base http://localhost:8091/] [--runs 3]
     (먼저 저장소를 띄워 두세요:  npx http-server . -p 8091 -s -c-1 . Vercel 미리보기 주소도 됩니다)
   - 390x844(휴대폰)와 1366x768(노트북)에서 각각 --runs 번 진행합니다. 홀수 번째 진행은
     리딩 화면에서 ☰ 메뉴 → 처음 화면 으로 나가, 다음 학생에게 앞 학생 기록이 남지 않는지 봅니다.
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

async function run(browser,vp,n){
  const label=`${vp.width}x${vp.height} #${n+1}`;
  const ctx=await browser.newContext({viewport:vp});
  const errors=[],hiddenSeen=new Set();
  await ctx.route("**/*",async route=>{
    const u=new URL(route.request().url());
    if(u.hostname==="api.anthropic.com")return route.abort();
    if(u.origin!==BASE.origin)return route.continue();
    if(u.pathname==="/api/ask")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({answer:null,reason:"NO_KEY"})});
    if(!LOCAL)return route.continue();
    const resp=await route.fetch();
    return route.fulfill({response:resp,headers:{...resp.headers(),...SITE_HEADERS}});
  });
  try{
  const page=await ctx.newPage();
  page.on("pageerror",e=>errors.push("pageerror: "+e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push("console: "+m.text())});
  page.on("request",r=>{if(isHiddenImg(new URL(r.url()).pathname.slice(1)))hiddenSeen.add(r.url())});

  const scr=sel=>page.locator("#screen"+sel);
  const primary=()=>page.locator("#screen .nav .btn.primary");
  const atStep=cls=>page.waitForSelector("#screen.content."+cls,{timeout:5000});
  const nav=async loc=>{await wait(500);await loc.click()};   // 앱은 450ms 안의 두 번째 이동을 무시함
  const domHidden=async where=>{
    const srcs=await page.$$eval("img",ims=>ims.map(i=>i.getAttribute("src")));
    const bad=srcs.filter(isHiddenImg);
    check(!bad.length,`${where}: hidden card image on screen: ${bad.join(", ")}`);
  };

  await page.goto(BASE.href,{waitUntil:"load"});
  check(await page.locator(".poster").isVisible(),"cover not shown");
  if(n===0){
    // 덱을 많이 만들어 봐도 숨긴 카드·중복이 없어야 함
    const bad=await page.evaluate(()=>{let b=0;for(let i=0;i<3000;i++){const d=makeDeck();if(d.some(c=>c.hidden)||new Set(d.map(c=>c.ko)).size!==d.length)b++}return b});
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

  // STEP 2 주제 + 한 줄 메모
  const trows=scr(" .rows .row");
  await trows.nth(Math.floor(Math.random()*await trows.count())).click();
  await page.fill("#note","스모크 테스트 메모");
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
  check((await page.textContent("#chathint")).includes("남은 질문 3개"),"hint should start at 3");
  check(await page.locator("#chatlog .msg").count()===1,"chat should start with the greeting only");
  await page.fill("#q","이 카드는 무슨 뜻이에요?");
  await page.click("#askbtn");
  await page.waitForFunction(()=>document.querySelectorAll("#chatlog .msg").length===3&&!document.querySelector("#chatlog .msg.pending"),null,{timeout:8000});
  check((await page.textContent("#chathint")).includes("남은 질문 2개"),"hint not updated after a question");

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
    await nav(page.locator("#screen .nav .btn:not(.primary)"));
    await atStep("s-reading");
    check(await page.locator("#chatlog .msg").count()===3,"chat log not replayed after 이전");
    check((await page.textContent("#chathint")).includes("남은 질문 2개"),"hint wrong after 이전");
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

  await wait(300);
  check(!hiddenSeen.size,"hidden card image requested: "+[...hiddenSeen].join(", "));
  check(!errors.length,"errors:\n  "+errors.join("\n  "));
  console.log(`ok   ${label}`);
  }finally{await ctx.close()}
}

(async()=>{
  const browser=await pw.chromium.launch();
  let failed=0;
  try{
    for(const vp of VIEWPORTS)for(let n=0;n<RUNS;n++){
      try{await run(browser,vp,n)}
      catch(e){failed++;console.log(`FAIL ${vp.width}x${vp.height} #${n+1}: ${e.message}`)}
    }
  }finally{await browser.close()}
  console.log(failed?`${failed} run(s) failed`:`all ${VIEWPORTS.length*RUNS} runs passed (${BASE.href})`);
  process.exit(failed?1:0);
})();
