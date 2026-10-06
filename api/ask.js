/* ══════════════════════════════════════════════════════════════
   마음의 향기 타로 — 추가 질문 응답 서버 (보조 경로)
   ══════════════════════════════════════════════════════════════

   이 서버는 Vercel 에 ANTHROPIC_API_KEY 를 넣었을 때만 AI를 씁니다.
   지금처럼 키가 없으면 NO_KEY 를 돌려주고, 앱은 미리 준비된 답변을 보여 줍니다.

   ⚠️ API 키는 이 파일에 적지 마세요.
      Vercel 대시보드 → Settings → Environment Variables 에서
      이름을  ANTHROPIC_API_KEY  로 넣으시면 됩니다.

   AI에게 주는 안내문(안전 규칙 포함)은 prompts.js, 위험한 말 확인은 safety.js,
   카드 뜻은 content.js 에 있습니다. 앱과 이 서버가 같은 파일을 씁니다.

   돌려주는 이유(reason): OK · NO_KEY(키 없음) · LIMIT(질문 수 초과) · RATE(요청이 너무 잦음)
     · BUDGET(키·요금 한도 문제) · TIMEOUT(응답이 늦음) · SAFETY(도움 안내) · API_ERROR(그 밖의 오류)
   ══════════════════════════════════════════════════════════════ */
const C=require("../content.js");
const Safety=require("../safety.js");
const Prompts=require("../prompts.js");

// ───────────── [설정] ─────────────
const MODEL="claude-haiku-4-5";   // 하이쿠 4.5 만 씁니다(빠르고 저렴, 수업용으로 충분)
const MAX_BODY=8*1024;            // 요청 크기 상한(바이트). 정상 요청은 2KB 안팎
const TIMEOUT_MS=15000;           // AI 응답을 기다리는 최대 시간
const MAX_Q=300;                  // 학생 질문 글자 수 상한 (앱 입력칸과 같음)
const MAX_A=1500;                 // 앞 대화의 AI 답 글자 수 상한
const RATE_MAX=60;                // 같은 IP에서 1분에 AI를 부르는 최대 횟수(한 반이 IP 하나를 같이 써도 넉넉하게)
// ──────────── [설정 끝] ────────────

const TOPICS=C.topics.map(t=>t[0]);
const COLORS=C.colors.map(c=>c[0]);
const CARDS=new Set(C.deckPool().map(c=>c.ko));   // 숨긴 카드는 뽑힐 수 없으므로 받지 않음

const send=(res,code,body)=>res.status(code).json(body);
const reply=(res,reason,answer=null)=>send(res,200,{answer,reason});

/* 다른 사이트의 페이지가 이 주소를 부르지 못하게 (Origin 헤더가 있을 때만 확인) */
function sameOrigin(req){
  const o=req.headers.origin;
  if(!o)return true;
  try{return new URL(o).host===(req.headers["x-forwarded-host"]||req.headers.host)}catch(e){return false}
}

function readBody(req){
  let b=req.body;
  if(Buffer.isBuffer(b))b=b.toString("utf8");
  if(typeof b==="string")b=JSON.parse(b);
  return b;
}

/* 같은 IP가 1분 안에 AI를 부른 횟수를 셈(질문 수 제한은 앱이 보낸 앞 대화로만 셀 수 있어서, 마구 부르는 것을 따로 막음).
   서버가 여러 개 떠 있으면 서버마다 따로 세는 가벼운 장치예요. 서버 키를 넣을 때는 Vercel Firewall 의
   Rate Limiting 규칙(/api/ask)과 Anthropic 월 한도도 꼭 함께 걸어 주세요(CLAUDE.md) */
const recent=new Map();
function clientIp(req){
  const f=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim();
  return String(req.headers["x-real-ip"]||f||(req.socket&&req.socket.remoteAddress)||"?");
}
function rateOk(ip){
  const now=Date.now(),fresh=t=>now-t<60000,list=(recent.get(ip)||[]).filter(fresh);
  if(recent.size>2000)for(const [k,v] of recent)if(!v.some(fresh))recent.delete(k);
  if(list.length>=RATE_MAX){recent.set(ip,list);return false}
  list.push(now);recent.set(ip,list);
  return true;
}

/* 본문 모양 확인. 문제가 있으면 무엇이 틀렸는지(짧은 이름), 괜찮으면 "" */
function invalid(b){
  if(!b||typeof b!=="object"||Array.isArray(b))return "body";
  if(!TOPICS.includes(b.topic))return "topic";
  if(b.color!=null&&!COLORS.includes(b.color))return "color";
  if(!Array.isArray(b.cards)||b.cards.length!==3)return "cards";
  const seen=new Set();
  for(const c of b.cards){
    if(!c||typeof c!=="object"||!CARDS.has(c.ko)||typeof c.rev!=="boolean"||seen.has(c.ko))return "cards";
    seen.add(c.ko);
  }
  if(typeof b.question!=="string"||!b.question.trim()||b.question.length>MAX_Q)return "question";
  const h=b.history==null?[]:b.history;
  if(!Array.isArray(h)||h.length>Prompts.HISTORY_MAX||h.length%2)return "history";
  for(let i=0;i<h.length;i++){
    const m=h[i],ai=i%2===1;
    if(!m||typeof m!=="object"||m.role!==(ai?"assistant":"user")||typeof m.content!=="string"
       ||!m.content.trim()||m.content.length>(ai?MAX_A:MAX_Q))return "history";
  }
  return "";
}

/* Anthropic 오류 → 앱에 알려 줄 이유 */
function upstreamReason(status,detail){
  if(status===429)return "RATE";
  if(status===401||status===403||/credit|billing|usage limit|spend/i.test(detail))return "BUDGET";
  return "API_ERROR";
}

module.exports=async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST"){res.setHeader("Allow","POST");return send(res,405,{answer:null,reason:"METHOD",error:"POST 요청만 받습니다."})}
  if(!sameOrigin(req))return send(res,403,{answer:null,reason:"ORIGIN",error:"이 사이트에서만 쓸 수 있습니다."});
  if(Number(req.headers["content-length"])>MAX_BODY)return send(res,413,{answer:null,reason:"TOO_LARGE",error:"요청이 너무 깁니다."});
  let b;
  try{b=readBody(req)}catch(e){return send(res,400,{answer:null,reason:"BAD_REQUEST",error:"JSON 형식이 아닙니다."})}
  if(Buffer.byteLength(JSON.stringify(b===undefined?null:b),"utf8")>MAX_BODY)return send(res,413,{answer:null,reason:"TOO_LARGE",error:"요청이 너무 깁니다."});

  // 1) 위험한 말이면 AI를 부르지 않고 바로 도움 안내 (다른 칸이 이상해도 먼저)
  const said=[b&&b.question,...(b&&Array.isArray(b.history)?b.history.filter((m,i)=>i%2===0).map(m=>m&&m.content):[])];
  if(said.some(t=>typeof t==="string"&&Safety.check(t)))return reply(res,"SAFETY",Safety.HELP_TEXT);

  // 2) 모든 칸 확인
  const bad=invalid(b);
  if(bad)return send(res,400,{answer:null,reason:"BAD_REQUEST",error:"잘못된 요청: "+bad});
  const history=b.history||[];
  if(history.length/2>=Prompts.ASK_LIMIT)return reply(res,"LIMIT");

  // 3) 키가 없으면 앱이 미리 준비된 답변으로 넘어갑니다
  const key=process.env.ANTHROPIC_API_KEY;
  if(!key)return reply(res,"NO_KEY");
  if(!rateOk(clientIp(req)))return reply(res,"RATE");

  // 4) 첫 질문의 카드 정보는 서버가 content.js 로 다시 만듭니다(학생 기기가 보낸 리딩·뜻 글은 쓰지 않음)
  const ctx={topic:b.topic,color:b.color||null,cards:b.cards.map(c=>({ko:c.ko,rev:c.rev}))};
  const turns=history.map(m=>({role:m.role,content:m.role==="user"?Safety.redact(m.content):m.content}));
  const messages=Prompts.buildMessages(ctx,turns,Safety.redact(b.question.trim()));

  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      signal:AbortSignal.timeout(TIMEOUT_MS),
      headers:{"content-type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:MODEL,max_tokens:Prompts.QA_MAX_TOKENS,system:Prompts.QA_SYSTEM,messages})
    });
    if(!r.ok){
      const detail=await r.text().catch(()=>"");
      console.error("Anthropic API 오류:",r.status,detail.slice(0,300));
      return reply(res,upstreamReason(r.status,detail));
    }
    const data=await r.json();
    const answer=(data.content||[]).filter(x=>x&&x.type==="text").map(x=>x.text).join("\n").trim();
    if(Safety.hasMarker(answer))return reply(res,"SAFETY",Safety.HELP_TEXT);
    if(!answer||data.stop_reason==="refusal")return reply(res,"API_ERROR");
    return reply(res,"OK",answer);
  }catch(e){
    const late=e&&(e.name==="TimeoutError"||e.name==="AbortError");
    console.error(late?"Anthropic API 응답 시간 초과":"Anthropic API 호출 실패:",e&&e.message);
    return reply(res,late?"TIMEOUT":"API_ERROR");
  }
};
