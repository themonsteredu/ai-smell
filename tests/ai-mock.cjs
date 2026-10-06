#!/usr/bin/env node
/* AI 맞춤 리딩 점검 — 가짜 Anthropic 으로 돌려서 진짜 AI를 부르지 않아요(요금 없음).
   사용법:  node tests/ai-mock.cjs [--port 8095]
   - 이 스크립트가 저장소를 직접 띄웁니다(정적 파일 + 가짜 /v1/messages + /api/ask 는 NO_KEY, vercel.json 의 보안 헤더 그대로).
   - 브라우저 안에서 https://api.anthropic.com/… 로 가는 fetch 를 같은 서버의 가짜 주소(/__mock/<장면>/…)로 돌립니다.
     글자가 조금씩 오는 SSE 를 진짜처럼 흉내 내려고요(Playwright 의 route.fulfill 은 답을 한꺼번에만 줘요).
     그래도 진짜 api.anthropic.com 으로 나가는 요청이 생기면 막고 실패로 칩니다.
   - 장면(동시에 몇 개씩 돌려요):
     stream   세 번째 카드에서 리딩 요청 시작 · 네 부분이 차례로 나타남 · 'AI가 쓴 풀이' · 하이쿠는 thinking 없음 ·
              안내문이 prompts.js 와 글자 하나까지 같음 · 정리(JSON) → 질문 버튼·향기 까닭 · 대화 답이 말풍선 하나에 흘러 들어옴 ·
              AI 답만 남은 질문 수를 줄임(500 → 준비된 답변은 안 줄임) · 다 쓰면 더 보내지 않음
     fail500  리딩 500 → 준비된 풀이 + '준비된 풀이' 표시, 정리 요청 없음
     refusal · maxTokens   네 부분이 다 와도 stop_reason 이 refusal·max_tokens → 준비된 풀이(앞서 보인 글은 사라짐)
     marker   리딩 답에 [도움필요] → 도움 안내 + 붉은 표시, 이어서 하기 뒤 대화 답의 [도움필요]도 도움 안내(질문은 기록에서 지움)
     slow     8초 넘게 첫 글자가 없음 → 기다림 표시 뒤 준비된 풀이(늦게 온 답은 무시)
     stale    리딩·대화가 오는 중에 처음 화면 → 요청이 끊기고, 다음 학생 화면에 앞 학생 글이 한 글자도 안 나옴
     sonnet   소넷: thinking between_tools + fallbacks:'default' + 베타 머리글, 400 이면 둘만 빼고 한 번 더(중간 fallback 블록도 읽음)
     nokey    키 없음: AI 요청 0번, 표시 없음, 기본 질문 버튼 → 준비된 답변
     total    30초 안에 끝 표시가 없음: 네 부분이 다 왔으면 그대로 두고, 덜 왔으면 준비된 풀이(두 장면)
   - 모든 요청 본문에 학생의 한 줄 메모가 없어야 하고, pageerror·console error 가 없어야 합니다. */
let pw;
try{pw=require("playwright")}catch(e){pw=require("/opt/node22/lib/node_modules/playwright")}
const http=require("http");
const fs=require("fs");
const path=require("path");
const C=require("../content.js");
const P=require("../prompts.js");

const ROOT=path.join(__dirname,"..");
const arg=(name,def)=>{const i=process.argv.indexOf("--"+name);return i>0&&process.argv[i+1]?process.argv[i+1]:def};
const PORT=+arg("port","8095");
const BASE=`http://localhost:${PORT}/`;
const NOTE="비밀메모XYZ 친구랑 다퉜어요";
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function check(cond,msg){if(!cond)throw new Error(msg)}

/* ── 서버: 정적 파일 + 가짜 Anthropic ── */
const vercel=JSON.parse(fs.readFileSync(path.join(ROOT,"vercel.json"),"utf8"));
const SITE_HEADERS=Object.fromEntries(((vercel.headers||[]).find(h=>h.source==="/(.*)")||{headers:[]}).headers.map(h=>[h.key,h.value]));
const TYPES={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css",".svg":"image/svg+xml",
  ".jpg":"image/jpeg",".png":"image/png",".woff2":"font/woff2",".json":"application/json"};
const scenes=new Map();   // 장면 이름 → {handler, calls:[]}

function serveFile(req,res){
  let p=decodeURIComponent(new URL(req.url,BASE).pathname);
  if(p.endsWith("/"))p+="index.html";
  const f=path.normalize(path.join(ROOT,p));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404,SITE_HEADERS);return res.end()}
  res.writeHead(200,{...SITE_HEADERS,"content-type":TYPES[path.extname(f)]||"application/octet-stream","cache-control":"no-store"});
  fs.createReadStream(f).pipe(res);
}
async function serveMock(req,res,sid){
  const sc=scenes.get(sid);
  let raw="";for await(const ch of req)raw+=ch;
  const body=JSON.parse(raw);
  const kind=body.stream?(Array.isArray(body.system)?"reading":"chat"):body.max_tokens===10?"test":"extras";
  const call={kind,body,raw,headers:req.headers,t:Date.now(),closedEarly:false,done:false};
  sc.calls.push(call);
  res.on("close",()=>{if(!call.done)call.closedEarly=true});
  const plan=sc.handler(call,sc.calls.filter(c=>c.kind===kind).length-1)||{status:500,json:{type:"error",error:{type:"api_error",message:"no plan"}}};
  if(plan.first)await wait(plan.first);
  if(call.closedEarly)return;
  if(plan.json){
    res.writeHead(plan.status||200,{"content-type":"application/json"});
    call.done=true;return res.end(JSON.stringify(plan.json));
  }
  res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});
  let k=0;
  for(const [name,data] of plan.sse){
    if(call.closedEarly)return;
    const s=`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    if(k++%3===1){const h=s.length>>1;res.write(s.slice(0,h));await wait(5);res.write(s.slice(h))}   // 사건 하나를 두 조각으로(버퍼 처리 점검)
    else res.write(s);
    await wait(plan.gap||30);
  }
  if(plan.hang)return;   // 끝 표시 없이 연결만 열어 둠
  call.done=true;res.end();
}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,BASE);
  const m=/^\/__mock\/([^/]+)\/v1\/messages$/.exec(u.pathname);
  if(m&&req.method==="POST")return serveMock(req,res,m[1]).catch(e=>{console.log("mock error",e);res.destroy()});
  if(u.pathname==="/api/ask"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({answer:null,reason:"NO_KEY"}))}
  serveFile(req,res);
});

/* ── 가짜 답 만들기 ── */
const msgStart={type:"message_start",message:{id:"msg_mock",type:"message",role:"assistant",content:[],model:"mock",stop_reason:null,usage:{input_tokens:10,output_tokens:1}}};
/* 글을 n 글자씩 나눠 text_delta 로. stop=null 이면 message_delta 없이, end=false 면 message_stop 도 없이 */
function sse(text,{stop="end_turn",n=12,end=true,pre=[]}={}){
  const ev=[["message_start",msgStart],["ping",{type:"ping"}],...pre];
  const idx=pre.length?1:0;
  ev.push(["content_block_start",{type:"content_block_start",index:idx,content_block:{type:"text",text:""}}]);
  for(let i=0;i<text.length;i+=n)ev.push(["content_block_delta",{type:"content_block_delta",index:idx,delta:{type:"text_delta",text:text.slice(i,i+n)}}]);
  ev.push(["content_block_stop",{type:"content_block_stop",index:idx}]);
  if(stop)ev.push(["message_delta",{type:"message_delta",delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:120}}]);
  if(end)ev.push(["message_stop",{type:"message_stop"}]);
  return ev;
}
const apiError=(status,type="api_error")=>({status,json:{type:"error",error:{type,message:"mock "+status}}});
const msgJson=text=>({json:{id:"msg_mock",type:"message",role:"assistant",model:"mock",content:[{type:"text",text}],stop_reason:"end_turn",usage:{input_tokens:10,output_tokens:10}}});
/* 요청 안의 카드 줄(1. 현재 상황 — 바보 정방향 (…))로 약속한 네 부분 리딩을 만듦 */
function cardsIn(call){
  return [...call.body.messages[0].content.matchAll(/^\d\. (.+?) — (.+?) (정방향|역방향) \(/gm)].map(m=>({role:m[1],ko:m[2],ori:m[3]}));
}
function readingFor(call,tag,parts=4){
  const secs=cardsIn(call).map((c,i)=>`■ ${c.role} — ${c.ko} ${c.ori}\n${tag}${i+1}: ${c.ko} 카드는 지금 마음을 비춰 주는 그림일 수 있어요. 천천히 생각해 보면 어떨까요?`);
  secs.push(`■ 세 카드의 흐름\n${tag}4: 세 카드가 하나의 이야기처럼 이어져요. 오늘 할 수 있는 작은 일 하나를 골라 보세요.`);
  return secs.slice(0,parts).join("\n");
}
const scentNames=call=>[...call.body.messages[0].content.matchAll(/^\d\. (.+?) — /gm)].map(m=>m[1]).filter(n=>!cardsIn(call).some(c=>c.role===n));
const EXTRA_QS=["친구에게 먼저 말해도 될까요?","이 마음은 왜 생길까요?","오늘 뭘 해 보면 좋을까요?","네 번째 질문은 버려져요"];
function extrasFor(call){
  const names=scentNames(call);
  return msgJson("다음은 결과예요.\n```json\n"+JSON.stringify({
    scents:[...names.map((name,i)=>({name,reason:`AI까닭${i+1}: 이 향기는 카드의 마음과 어울려요`,smell_question:`AI질문${i+1}: 어떤 장소가 떠오르나요?`})),
      {name:"목록에없는향",reason:"버려져야 해요",smell_question:"버려져요"}],
    questions:EXTRA_QS})+"\n```");
}

/* ── 브라우저 한 창(장면 하나) ── */
async function open(browser,sid,{vp={width:1366,height:768},cfg=null,handler}){
  scenes.set(sid,{handler,calls:[]});
  const ctx=await browser.newContext({viewport:vp});
  const errors=[],real=[],dialogs=[];
  await ctx.route("https://api.anthropic.com/**",r=>{real.push(r.request().url());return r.abort()});
  await ctx.addInitScript(([sid,cfg])=>{
    const f=window.fetch;
    window.fetch=(u,o)=>{const s=String(u);return f(s.startsWith("https://api.anthropic.com/")?"/__mock/"+sid+"/"+s.slice(26):u,o)};
    if(cfg&&!localStorage.getItem("maum_tarot_cfg"))localStorage.setItem("maum_tarot_cfg",JSON.stringify(cfg));
  },[sid,cfg]);
  const page=await ctx.newPage();
  page.on("pageerror",e=>errors.push("pageerror: "+e.message));
  page.on("console",m=>{if(m.type()==="error"&&!/Failed to load resource: the server responded with a status of (400|500)/.test(m.text()))errors.push("console: "+m.text())});
  page.on("dialog",d=>{dialogs.push(d.message());d.accept()});
  const h={sid,ctx,page,errors,dialogs,calls:()=>scenes.get(sid).calls,of:k=>scenes.get(sid).calls.filter(c=>c.kind===k)};
  h.nav=async sel=>{await wait(500);await page.locator(sel).click()};
  h.toDraw=async()=>{
    await page.goto(BASE,{waitUntil:"load"});
    await page.locator(".poster .start").click();
    await page.waitForSelector("#screen.s-color");
    await page.locator("#screen .rows .row").nth(4).click();
    await h.nav("#screen .nav .btn.primary");
    await page.waitForSelector("#screen.s-topic");
    await page.locator("#screen .rows .row").nth(1).click();
    await page.fill("#note",NOTE);
    await h.nav("#screen .nav .btn.primary");
    await page.waitForSelector("#screen.s-draw");
    await page.waitForFunction(()=>!document.getElementById("fan").classList.contains("locked"),null,{timeout:6000});
  };
  h.pick3=async()=>{
    for(let k=0;k<3;k++){
      await page.locator("#fan .card:not(.hide)").nth(3+k).dispatchEvent("click");
      // 화면(DOM)이 아니라 앱 상태로 기다림 — marker 장면은 세 장째가 놓이자마자 도움 안내 화면이 카드 칸을 덮어서
      await page.waitForFunction(k=>state.draw.length===k+1&&!picking,k,{timeout:8000});
    }
  };
  h.toReading=async()=>{await h.nav("#go");await page.waitForSelector("#screen.s-reading")};
  h.walk=async()=>{await h.toDraw();await h.pick3();await h.toReading()};
  h.student=()=>page.evaluate(()=>({color:state.color,topic:state.topic,cards:state.draw.map(d=>({ko:d.ko,rev:!!d.rev}))}));
  h.tag=()=>page.textContent("#readsrc");
  h.readingText=()=>page.textContent("#reading");
  h.waitTag=(t,ms=10000)=>page.waitForFunction(t=>document.getElementById("readsrc")&&document.getElementById("readsrc").textContent===t,t,{timeout:ms});
  h.askQ=async q=>{
    const n=await page.locator("#chatlog .msg").count();
    await page.fill("#q",q);await page.click("#askbtn");
    await page.waitForFunction(n=>document.querySelectorAll("#chatlog .msg").length>=n+2&&!document.querySelector("#chatlog .msg.pending"),n,{timeout:15000});
  };
  h.lastAi=()=>page.evaluate(()=>{const b=[...document.querySelectorAll("#chatlog .msg.ai .bubble")].pop();return {src:b.querySelector(".src").textContent,text:b.textContent}});
  h.hint=()=>page.textContent("#chathint");
  h.hold=async ms=>{
    await wait(400);
    const b=await page.locator("#teach").boundingBox();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await wait(ms);await page.mouse.up();
  };
  h.localHtml=()=>page.evaluate(()=>state.readHtml);
  h.finish=async()=>{
    await wait(300);
    check(!real.length,"real api.anthropic.com request: "+real.join(", "));
    for(const c of h.calls())check(!c.raw.includes("비밀메모")&&!c.raw.includes(NOTE),`${c.kind} request body contains the student note`);
    check(!errors.length,"errors:\n  "+errors.join("\n  "));
  };
  return h;
}
const HAIKU_CFG={apiKey:"sk-ant-mock-key-0000000000",model:"claude-haiku-4-5"};
const SONNET_CFG={apiKey:"sk-ant-mock-key-0000000000",model:"claude-sonnet-5-5"};
const roles=C.roles;
const titleOf=(d,i)=>`${roles[i]} — ${d.ko} ${d.rev?"역방향":"정방향"}`;

async function stopScene(browser,stop){
  const h=await open(browser,"stop-"+stop,{cfg:HAIKU_CFG,handler:call=>call.kind==="reading"
    ?{sse:sse(readingFor(call,"멈춘글"),{stop,n:30}),gap:60}:apiError(500)});
  const {page}=h;
  try{
    await h.walk();
    await h.waitTag("준비된 풀이");
    check(!(await h.readingText()).includes("멈춘글"),stop+": the AI text still shown");
    check(await page.innerHTML("#reading")===await h.localHtml(),stop+" should fall back to the prepared reading");
    check(h.of("extras").length===0,stop+": no extras after a failed reading");
    await h.finish();
  }finally{await h.ctx.close()}
}

/* ── 장면들 ── */
const SCENES={
  async stream(browser){
    const chatPlan=["ok","500","ok","ok"];
    const h=await open(browser,"stream",{cfg:HAIKU_CFG,handler:(call,n)=>{
      if(call.kind==="reading")return {sse:sse(readingFor(call,"AI리딩"),{n:4}),gap:80};
      if(call.kind==="extras")return extrasFor(call);
      if(call.kind==="chat")return chatPlan[n]==="500"?apiError(500):{sse:sse(`AI대답${n+1}: 카드를 보며 천천히 생각해 볼 수 있어요. 마음이 가는 대로 말해 보세요.`,{n:3}),gap:60};
    }});
    const {page}=h;
    try{
      await h.toDraw();
      await h.pick3();
      // 세 번째 카드가 놓이자마자(아직 카드 단계) 리딩 요청이 나감
      for(let i=0;i<20&&!h.of("reading").length;i++)await wait(100);
      check(h.of("reading").length===1,"reading request did not start when the third card was placed");
      check(await page.evaluate(()=>state.step)===2,"reading request should start on the draw step");
      const stu=await h.student();
      const rq=h.of("reading")[0],b=rq.body;
      check(b.model==="claude-haiku-4-5"&&!("thinking" in b)&&!("fallbacks" in b)&&!rq.headers["anthropic-beta"],"haiku request must have no thinking/fallbacks/beta: "+JSON.stringify({m:b.model,t:b.thinking,f:b.fallbacks,h:rq.headers["anthropic-beta"]}));
      check(b.stream===true&&b.max_tokens===1200,"reading request should stream with max_tokens 1200");
      check(Array.isArray(b.system)&&b.system.length===1&&b.system[0].text===P.READING_SYSTEM&&b.system[0].cache_control&&b.system[0].cache_control.type==="ephemeral",
        "system must be the byte-identical READING_SYSTEM with cache_control");
      check(b.messages.length===1&&b.messages[0].content===P.buildReadingUser(stu),"user message must be buildReadingUser(color, topic, cards)");
      check(rq.headers["x-api-key"]===HAIKU_CFG.apiKey&&rq.headers["anthropic-dangerous-direct-browser-access"]==="true"&&rq.headers["anthropic-version"]==="2023-06-01","bad request headers");
      // 리딩 화면: 네 부분이 차례로 늘어나며 나타남(페이지 안에서 15ms 마다 기록 — 바깥에서 묻는 왕복 시간에 흔들리지 않게)
      await page.evaluate(()=>{window.__seen=[];window.__rec=setInterval(()=>{const r=document.getElementById("reading");
        if(r)window.__seen.push({n:r.dataset.src==="ai"?r.querySelectorAll("p").length:0,len:r.textContent.length,tag:document.getElementById("readsrc").textContent})},15)});
      await h.toReading();
      await page.waitForFunction(()=>aiRead&&aiRead.st==="ok",null,{timeout:20000});
      const seen=await page.evaluate(()=>{clearInterval(window.__rec);return window.__seen});
      const counts=seen.map(s=>s.n).filter(Boolean),lens=new Set(seen.filter(s=>s.n).map(s=>s.len));
      check([1,2,3,4].every(k=>counts.includes(k))&&counts.every((c,i)=>!i||c>=counts[i-1]),"sections did not appear one after another: "+counts.join(","));
      check(lens.size>=8,"reading text did not grow progressively ("+lens.size+" distinct lengths)");
      check(seen.filter(s=>s.n).every(s=>s.tag==="AI가 쓴 풀이"),"tag should read AI가 쓴 풀이 while streaming");
      const ps=await page.$$eval("#reading p",ps=>ps.map(p=>({b:p.querySelector("b").textContent,t:p.textContent})));
      check(ps.length===4,"expected 4 reading paragraphs, got "+ps.length);
      ps.forEach((p,i)=>check(p.b===(i<3?titleOf(stu.cards[i],i):"세 카드의 흐름")&&p.t.includes("AI리딩"+(i+1)),"bad paragraph "+i+": "+JSON.stringify(p)));
      check(await h.tag()==="AI가 쓴 풀이","final tag");
      check((await page.evaluate(()=>state.reading)).includes("AI리딩4"),"state.reading should hold the AI text (plain)");
      // 정리(JSON): 질문 버튼은 AI 질문 3개(4번째는 버려짐), 목록에 없는 향기는 버려짐
      await page.waitForFunction(()=>extras&&extras.g===gen,null,{timeout:5000});
      check(h.of("extras").length===1&&h.of("extras")[0].body.max_tokens===500&&!h.of("extras")[0].body.stream,"one non-streamed extras call with max_tokens 500");
      const chips=await page.$$eval("#chips .chip",cs=>cs.map(c=>c.textContent));
      check(JSON.stringify(chips)===JSON.stringify(EXTRA_QS.slice(0,3)),"chips should be the AI questions: "+chips.join(" | "));
      // 대화: 질문 버튼 → 답이 말풍선 하나에 흘러 들어옴, AI 답이라 남은 질문 3 → 2
      await page.evaluate(()=>{window.__live=[];window.__rec=setInterval(()=>window.__live.push({n:document.querySelectorAll("#chatlog .msg").length,
        pending:!!document.querySelector("#chatlog .msg.pending"),len:(document.querySelector("#chatlog .msg.pending .bubble")||{textContent:""}).textContent.length,
        busy:document.getElementById("chatlog").getAttribute("aria-busy")}),15)});
      await page.locator("#chips .chip").first().click();
      await page.waitForFunction(()=>window.__live.some(s=>s.pending)&&!document.querySelector("#chatlog .msg.pending"),null,{timeout:15000});
      const live=await page.evaluate(()=>{clearInterval(window.__rec);return window.__live.filter(s=>s.n>1)});
      const growing=new Set(live.filter(s=>s.pending&&s.len>0).map(s=>s.len));
      check(growing.size>=5&&live.every(s=>s.n===3),"chat answer did not stream into one bubble: "+JSON.stringify(live.slice(-3))+" distinct="+growing.size);
      check(live.some(s=>s.busy==="true")&&await page.getAttribute("#chatlog","aria-busy")===null,"chatlog should be aria-busy only while streaming");
      let last=await h.lastAi();
      check(last.src==="AI 답변"&&last.text.includes("AI대답1"),"streamed answer: "+JSON.stringify(last));
      check((await h.hint()).includes("남은 질문 2개"),"an AI answer should use up one question");
      const c1=h.of("chat")[0];
      check(c1.body.system===P.QA_SYSTEM&&c1.body.stream===true&&!("thinking" in c1.body)&&c1.body.messages[0].content.includes("AI리딩1"),"chat request should carry QA_SYSTEM, stream, no thinking, and the AI reading");
      check(c1.body.messages[c1.body.messages.length-1].content.includes(EXTRA_QS[0]),"chip question not sent");
      // 500 → 준비된 답변, 남은 질문 수 그대로
      await h.askQ("역방향은 나쁜 건가요?");
      check((await page.textContent("#chatlog")).includes("지금은 AI가 답할 수 없어서"),"AI_DOWN notice missing after 500");
      check((await page.$$eval("#chatlog .msg.ai .src",s=>s.map(x=>x.textContent))).includes("준비된 답변"),"500 should give a prepared answer");
      check((await h.hint()).includes("남은 질문 2개"),"a prepared answer must not use up a question");
      await h.askQ("숨은 마음은 뭐예요?");
      check((await h.hint()).includes("남은 질문 1개"),"second AI answer should leave 1");
      await h.askQ("오늘 뭘 해 볼까요?");
      check((await h.hint()).includes("다 썼어요"),"third AI answer should use up the questions");
      check(await page.locator("#chips .chip").count()===0,"chips should hide when AI questions are used up");
      await h.askQ("하나 더 물어봐도 돼요?");
      check(h.of("chat").length===4,"no request after the limit: "+h.of("chat").length);
      check((await h.lastAi()).src==="안내","limit message should be an 안내 bubble");
      check(await page.evaluate(()=>askCount)===3,"askCount should be 3 (AI answers only)");
      // 향기: AI 까닭과 시향 질문이 향기 카드에
      await h.nav("#screen .nav .btn.primary");
      await page.waitForSelector("#screen.s-scent");
      const sc=await page.$$eval(".scent",cs=>cs.map(c=>({why:(c.querySelector(".why")||{textContent:""}).textContent,sq:c.querySelector(".sq").textContent})));
      check(sc.length===3&&sc.every((s,i)=>s.why.includes("AI까닭"+(i+1))&&s.sq.includes("AI질문"+(i+1))),"scent cards should show the AI reason and smell question: "+JSON.stringify(sc));
      check(!(await page.textContent("#screen")).includes("목록에없는향"),"a scent the app did not pick was shown");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async fail500(browser){
    const h=await open(browser,"fail500",{vp:{width:390,height:844},cfg:HAIKU_CFG,handler:call=>apiError(500)});
    const {page}=h;
    try{
      await h.walk();
      await h.waitTag("준비된 풀이");
      const n=await page.locator("#reading p").count();
      check(n>=4&&(await h.readingText()).includes("세 카드의 흐름"),"500 should show the prepared reading");
      check(await page.innerHTML("#reading")===await h.localHtml(),"fallback should be exactly the Reading.make() text");
      await wait(1200);
      check(h.of("extras").length===0,"no extras call after a failed reading");
      check(await page.locator("#chips .chip").count()===3,"static chips should show");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  /* 네 부분이 모양까지 다 맞아도 stop_reason 이 refusal·max_tokens 면 준비된 풀이(stop_reason 만으로 걸러지는지) */
  async refusal(browser){await stopScene(browser,"refusal")},
  async maxTokens(browser){await stopScene(browser,"max_tokens")},

  async marker(browser){
    const h=await open(browser,"marker",{cfg:HAIKU_CFG,handler:(call)=>{
      if(call.kind==="reading")return {sse:sse("[도움필요] 말해 줘서 고마워요. 그건 네 잘못이 아니에요.",{n:3}),gap:40};
      if(call.kind==="chat")return {sse:sse("[도움필요] 말해 줘서 고마워요. 선생님께 이 화면을 보여 주세요.",{n:2}),gap:40};
      return apiError(500);
    }});
    const {page}=h;
    const flags=()=>page.evaluate(()=>JSON.parse(localStorage.getItem("maum_tarot_flags")||'{"log":[]}').log.length);
    try{
      await h.toDraw();
      await h.pick3();
      await page.waitForSelector("#screen.s-help .helpcard",{timeout:8000});
      check(await page.evaluate(()=>document.body.classList.contains("flagged")&&state.flag&&state.flag.from==="ai"),"reading marker should raise the flag");
      check(await flags()===1,"flag timestamp not logged");
      check(!(await page.textContent("#screen")).includes("[도움필요]"),"marker text shown to the student");
      await h.hold(1700);
      await page.locator("#helpnav .btn",{hasText:"이어서 하기"}).click();
      await page.waitForSelector("#screen.s-draw");
      await page.waitForFunction(()=>!document.getElementById("go").disabled,null,{timeout:6000});
      await h.toReading();
      check(await h.tag()==="준비된 풀이"&&await page.innerHTML("#reading")===await h.localHtml(),"after the help card the prepared reading should show");
      // 대화 답의 [도움필요] → 도움 안내, 그 질문은 기록에서 지우고 질문 수는 그대로
      await page.fill("#q","이 카드는 무슨 뜻이에요?");
      await page.click("#askbtn");
      await page.waitForSelector("#screen.s-help .helpcard",{timeout:8000});
      const st=await page.evaluate(()=>({askCount,hist:chatHistory.length,me:chatLog.filter(m=>m.who==="me").length}));
      check(st.askCount===0&&st.hist===0&&st.me===0,"chat marker: question kept or counted "+JSON.stringify(st));
      check(await flags()===2,"second flag not logged");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async slow(browser){
    const h=await open(browser,"slow",{cfg:HAIKU_CFG,handler:call=>call.kind==="reading"
      ?{first:9000,sse:sse(readingFor(call,"늦은글")),gap:10}:apiError(500)});
    const {page}=h;
    try{
      await h.walk();
      check(await page.locator("#reading .aiwait").count()===1,"typing indicator should show while waiting for the first text");
      await h.waitTag("준비된 풀이",9000);
      const at=Date.now()-h.of("reading")[0].t;
      check(at>=7500&&at<=9500,"fallback should come about 8s after the request, came at "+at+"ms");
      await wait(2500);
      check(await h.tag()==="준비된 풀이"&&!(await h.readingText()).includes("늦은글"),"late answer overwrote the fallback");
      check(h.of("reading")[0].closedEarly,"the slow request should be aborted");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async stale(browser){
    let student=1;
    const h=await open(browser,"stale",{cfg:HAIKU_CFG,handler:call=>{
      const tag=student===1?"옛학생글":"새학생글";
      if(call.kind==="reading")return student===1?{sse:sse(readingFor(call,tag),{n:2}),gap:120}:{sse:sse(readingFor(call,tag),{n:20}),gap:20};
      if(call.kind==="chat")return {sse:sse("옛학생답 ".repeat(40),{n:2}),gap:150};
      if(call.kind==="extras")return extrasFor(call);
    }});
    const {page}=h;
    try{
      await h.walk();
      await page.waitForFunction(()=>document.getElementById("reading").textContent.includes("옛학생글1"),null,{timeout:8000});
      await page.fill("#q","이 카드는 무슨 뜻이에요?");
      await page.click("#askbtn");
      await page.waitForFunction(()=>(document.querySelector("#chatlog .msg.pending .bubble")||{textContent:""}).textContent.includes("옛학생답"),null,{timeout:8000});
      // 처음 화면으로 — 그 뒤로 화면에 '옛학생'이 한 번이라도 나타나면 기록
      student=2;
      await h.nav(".menubtn");
      await page.locator("#sheet .row",{hasText:"처음 화면"}).click();
      await page.waitForSelector("#screen.cover");
      await page.evaluate(()=>{window.__stale=0;new MutationObserver(()=>{if(document.getElementById("screen").textContent.includes("옛학생"))window.__stale++}).observe(document.body,{subtree:true,childList:true,characterData:true})});
      await wait(300);
      check(h.of("reading")[0].closedEarly&&h.of("chat")[0].closedEarly,"in-flight reading/chat should be aborted on restart");
      await h.nav(".poster .start");
      await page.waitForSelector("#screen.s-color");
      await page.locator("#screen .rows .row").nth(2).click();
      await h.nav("#screen .nav .btn.primary");
      await page.waitForSelector("#screen.s-topic");
      await page.locator("#screen .rows .row").nth(3).click();
      await h.nav("#screen .nav .btn.primary");
      await page.waitForSelector("#screen.s-draw");
      await page.waitForFunction(()=>!document.getElementById("fan").classList.contains("locked"),null,{timeout:6000});
      await h.pick3();
      await h.toReading();
      await h.waitTag("AI가 쓴 풀이");
      await page.waitForFunction(()=>aiRead&&aiRead.st==="ok",null,{timeout:10000});
      check((await h.readingText()).includes("새학생글1"),"second student should get their own reading");
      check(await page.evaluate(()=>window.__stale)===0,"previous student's text appeared on the next student's screens");
      check(await page.locator("#chatlog .msg").count()===1&&(await h.hint()).includes("남은 질문 3개"),"chat should be fresh for the next student");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async sonnet(browser){
    const fb={type:"content_block_start",index:0,content_block:{type:"fallback"}};
    const h=await open(browser,"sonnet",{cfg:SONNET_CFG,handler:call=>{
      const beta=call.headers["anthropic-beta"];
      if(call.kind==="reading")return beta?apiError(400,"invalid_request_error"):{sse:sse(readingFor(call,"소넷글"),{n:30,pre:[["content_block_start",fb],["content_block_stop",{type:"content_block_stop",index:0}]]}),gap:15};
      if(call.kind==="chat")return {sse:sse("소넷대답: 카드를 보며 천천히 생각해 볼 수 있어요.",{n:6}),gap:20};
      if(call.kind==="extras")return extrasFor(call);
    }});
    const {page}=h;
    try{
      await h.walk();
      await h.waitTag("AI가 쓴 풀이");
      await page.waitForFunction(()=>aiRead&&aiRead.st==="ok",null,{timeout:8000});
      check((await h.readingText()).includes("소넷글4"),"reading after the 400 retry not shown");
      const [a,b]=h.of("reading");
      check(h.of("reading").length===2,"expected exactly one retry after 400, got "+h.of("reading").length);
      check(a.body.model==="claude-sonnet-5-5"&&JSON.stringify(a.body.thinking)==='{"type":"between_tools"}'&&a.body.fallbacks==="default"&&a.headers["anthropic-beta"]==="server-side-fallback-2026-07-01",
        "first sonnet request must send thinking between_tools + fallbacks default + beta header: "+JSON.stringify({t:a.body.thinking,f:a.body.fallbacks,h:a.headers["anthropic-beta"]}));
      check(JSON.stringify(b.body.thinking)==='{"type":"between_tools"}'&&!("fallbacks" in b.body)&&!b.headers["anthropic-beta"],"retry must drop only fallbacks and the beta header");
      check(a.body.system[0].text===b.body.system[0].text&&a.body.messages[0].content===b.body.messages[0].content,"retry must resend the same prompt");
      await page.waitForFunction(()=>extras&&extras.g===gen,null,{timeout:5000});
      await h.askQ("이 카드는 무슨 뜻이에요?");
      const c=h.of("chat");
      check(c.length===1&&c[0].body.fallbacks==="default"&&c[0].headers["anthropic-beta"]==="server-side-fallback-2026-07-01"&&c[0].body.thinking.type==="between_tools","sonnet chat request (no retry on 200)");
      check((await h.lastAi()).text.includes("소넷대답"),"sonnet chat answer");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async nokey(browser){
    const h=await open(browser,"nokey",{vp:{width:390,height:844},handler:()=>apiError(500)});
    const {page}=h;
    try{
      await h.walk();
      await wait(800);
      check(h.calls().length===0,"no AI request without a key");
      check(await h.tag()===""&&!(await page.isVisible("#readsrc")),"no source tag without a key (template unchanged)");
      check(await page.innerHTML("#reading")===await h.localHtml(),"template reading should show unchanged");
      const chips=await page.$$eval("#chips .chip",cs=>cs.map(c=>c.textContent));
      check(JSON.stringify(chips)===JSON.stringify(C.CHAT_CHIPS),"static chips: "+chips.join(" | "));
      await page.locator("#chips .chip").nth(1).click();
      await page.waitForFunction(()=>document.querySelectorAll("#chatlog .msg").length===3&&!document.querySelector("#chatlog .msg.pending"),null,{timeout:8000});
      check((await h.lastAi()).src==="준비된 답변"&&(await h.hint()).includes("남은 질문 3개"),"chip without a key → prepared answer, count unchanged");
      const after=await page.$$eval("#chips .chip",cs=>cs.map(c=>c.textContent));
      check(!after.includes(C.CHAT_CHIPS[1])&&after.length===2,"asked chip should disappear: "+after.join(" | "));
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async totalKeep(browser){
    const h=await open(browser,"totalKeep",{cfg:HAIKU_CFG,handler:call=>call.kind==="reading"
      ?{sse:sse(readingFor(call,"끝없는글"),{stop:null,end:false,n:40}),gap:20,hang:true}:apiError(500)});
    const {page}=h;
    try{
      await h.walk();
      await page.waitForFunction(()=>document.querySelectorAll("#reading p").length===4,null,{timeout:8000});
      check(await page.evaluate(()=>aiRead.st)==="run","still waiting for the end of the message");
      await page.waitForFunction(()=>aiRead&&aiRead.st!=="run",null,{timeout:32000});
      const at=Date.now()-h.of("reading")[0].t;
      check(at>=29000&&at<=32000,"30s cut came at "+at);
      check(await h.tag()==="AI가 쓴 풀이"&&(await h.readingText()).includes("끝없는글4"),"all four sections arrived → keep the AI reading at 30s");
      await h.finish();
    }finally{await h.ctx.close()}
  },

  async totalDrop(browser){
    const h=await open(browser,"totalDrop",{cfg:HAIKU_CFG,handler:call=>call.kind==="reading"
      ?{sse:sse(readingFor(call,"덜온글",3),{stop:null,end:false,n:40}),gap:20,hang:true}:apiError(500)});
    const {page}=h;
    try{
      await h.walk();
      await page.waitForFunction(()=>document.getElementById("reading").textContent.includes("덜온글3"),null,{timeout:8000});
      await h.waitTag("준비된 풀이",32000);
      check(await page.innerHTML("#reading")===await h.localHtml(),"only 3 sections at 30s → prepared reading");
      await h.finish();
    }finally{await h.ctx.close()}
  }
};

(async()=>{
  await new Promise((ok,bad)=>server.once("error",bad).listen(PORT,ok));
  const browser=await pw.chromium.launch();
  const names=Object.keys(SCENES),only=arg("only","");
  const todo=only?names.filter(n=>only.split(",").includes(n)):names;
  let failed=0,next=0;
  const worker=async()=>{
    while(next<todo.length){
      const name=todo[next++],t=Date.now();
      try{await SCENES[name](browser);console.log(`ok   ${name} (${((Date.now()-t)/1000).toFixed(1)}s)`)}
      catch(e){failed++;console.log(`FAIL ${name}: ${e.message}`)}
    }
  };
  try{await Promise.all([worker(),worker(),worker(),worker()])}
  finally{await browser.close();server.closeAllConnections();server.close()}
  console.log(failed?`${failed} scene(s) failed`:`all ${todo.length} AI scenes passed`);
  process.exit(failed?1:0);
})();
