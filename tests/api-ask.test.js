/* api/ask.js 점검 — 진짜 Anthropic 을 부르지 않도록 fetch 를 가짜로 바꿔 끼우고, 가짜 req/res 로 부릅니다 */
const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/ask.js");
const C=require("../content.js");
const P=require("../prompts.js");

const realFetch=global.fetch,realError=console.error;
let calls=[],upstream=null;
global.fetch=async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return upstream(url,init)};
console.error=()=>{};   // 서버가 남기는 오류 기록은 테스트 출력에서 숨김
test.after(()=>{global.fetch=realFetch;console.error=realError});

const okReply=(text,extra={})=>async()=>new Response(JSON.stringify({content:[{type:"text",text}],stop_reason:"end_turn",...extra}),{status:200,headers:{"content-type":"application/json"}});
const visible=C.deckPool().map(c=>c.ko);
const body=(o={})=>({topic:"친구 관계",color:"파랑",cards:[{ko:visible[0],rev:false},{ko:visible[1],rev:true},{ko:visible[2],rev:false}],question:"이 카드는 무슨 뜻이에요?",history:[],...o});

async function call(b,{method="POST",headers={},key="sk-ant-test"}={}){
  if(key)process.env.ANTHROPIC_API_KEY=key;else delete process.env.ANTHROPIC_API_KEY;
  const res={code:0,headers:{},out:null,
    status(c){this.code=c;return this},json(o){this.out=o;return this},setHeader(k,v){this.headers[k.toLowerCase()]=v}};
  await handler({method,headers:{host:"ai-smell.vercel.app",...headers},body:b},res);
  return res;
}
test.beforeEach(()=>{calls=[];upstream=okReply("카드가 말해 주는 건 새로운 시작이에요.")});

test("405 for anything but POST",async()=>{
  const r=await call(undefined,{method:"GET"});
  assert.equal(r.code,405);assert.equal(r.headers.allow,"POST");assert.equal(calls.length,0);
});

test("403 when Origin is another site; same origin and no Origin are fine",async()=>{
  assert.equal((await call(body(),{headers:{origin:"https://evil.example"}})).code,403);
  assert.equal((await call(body(),{headers:{origin:"https://ai-smell.vercel.app"}})).code,200);
  assert.equal((await call(body())).code,200);
  assert.equal(calls.length,2);
});

test("413 for bodies over 8KB (by header or by size)",async()=>{
  assert.equal((await call(body(),{headers:{"content-length":"9000"}})).code,413);
  assert.equal((await call(body({question:"가".repeat(9000)}))).code,413);
  assert.equal(calls.length,0);
});

test("400 for bad shapes — nothing is forwarded",async()=>{
  const h2=(a,b)=>[{role:"user",content:a},{role:"assistant",content:b}];
  const bad=[
    "not json{",[],null,
    body({topic:"게임"}),body({topic:undefined}),body({color:"검정"}),
    body({cards:body().cards.slice(0,2)}),
    body({cards:[{ko:"연인",rev:false},...body().cards.slice(1)]}),             // 숨긴 카드
    body({cards:[body().cards[0],body().cards[0],body().cards[2]]}),            // 같은 카드 두 번
    body({cards:[{ko:visible[0],rev:"yes"},...body().cards.slice(1)]}),
    body({cards:[{ko:visible[0],rev:false,meaning:"x"},{ko:"없는 카드",rev:false},body().cards[2]]}),
    body({question:""}),body({question:42}),body({question:"가".repeat(301)}),
    body({history:"x"}),
    body({history:[{role:"user",content:"q"}]}),                                 // 홀수
    body({history:[{role:"assistant",content:"a"},{role:"user",content:"q"}]}), // 순서
    body({history:[{role:"user",content:[{type:"text",text:"q"}]},{role:"assistant",content:"a"}]}),
    body({history:[{role:"user",content:"q"},{role:"system",content:"a"}]}),
    body({history:h2("q","가".repeat(1501))}),
    body({history:h2("가".repeat(301),"a")}),
    body({history:[...h2("1","a"),...h2("2","b"),...h2("3","c"),...h2("4","d")]})   // 6턴 초과
  ];
  for(const b of bad){
    const r=await call(b);
    assert.equal(r.code,400,"expected 400 for "+JSON.stringify(b).slice(0,120));
    assert.equal(r.out.reason,"BAD_REQUEST");
  }
  assert.equal(calls.length,0);
});

test("NO_KEY when ANTHROPIC_API_KEY is not set (no upstream call)",async()=>{
  const r=await call(body(),{key:""});
  assert.equal(r.code,200);assert.deepEqual(r.out,{answer:null,reason:"NO_KEY"});
  assert.equal(calls.length,0);
});

test("SAFETY short-circuit: crisis text gets the help text and never goes upstream",async()=>{
  for(const b of [body({question:"요즘 그냥 죽고 싶어요"}),body({question:"아빠가 때려요",topic:"없는 주제"}),
                  body({history:[{role:"user",content:"친구들이 괴롭혀요"},{role:"assistant",content:"a"}]})]){
    const r=await call(b);
    assert.equal(r.out.reason,"SAFETY");
    for(const n of ["1388","109","117","112"])assert.ok(r.out.answer.includes(n));
  }
  assert.equal(calls.length,0);
});

test("SAFETY when the model answers with the [도움필요] marker",async()=>{
  upstream=okReply("[도움필요] 말해 줘서 고마워요.");
  const r=await call(body({question:"요즘 집에 가기 무서워요"}));
  assert.equal(r.out.reason,"SAFETY");assert.ok(r.out.answer.includes("1388"));assert.ok(!r.out.answer.includes("[도움필요]"));
});

test("LIMIT after ASK_LIMIT answered questions",async()=>{
  const h=[];for(let i=0;i<P.ASK_LIMIT;i++)h.push({role:"user",content:"q"+i},{role:"assistant",content:"a"+i});
  const r=await call(body({history:h}));
  assert.deepEqual(r.out,{answer:null,reason:"LIMIT"});assert.equal(calls.length,0);
});

test("upstream request: bounded history, server-built context, allowlisted model, redacted question",async()=>{
  const b=body({question:"제 번호 010-1234-5678 인데 이 카드 뜻이 뭐예요?",reading:"HACKED_READING",
    history:[{role:"user",content:"첫 질문"},{role:"assistant",content:"첫 답"},{role:"user",content:"둘째 질문"},{role:"assistant",content:"둘째 답"}]});
  b.cards[0].meaning="HACKED_MEANING";
  const r=await call(b);
  assert.deepEqual(r.out,{answer:"카드가 말해 주는 건 새로운 시작이에요.",reason:"OK"});
  assert.equal(r.headers["cache-control"],"no-store");
  assert.equal(calls.length,1);
  const {url,init,body:up}=calls[0];
  assert.equal(url,"https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"],"sk-ant-test");
  assert.ok(init.signal instanceof AbortSignal,"upstream call has a timeout signal");
  assert.equal(up.model,"claude-haiku-4-5");
  assert.ok(up.max_tokens<=400);
  assert.equal(up.system,P.QA_SYSTEM);
  assert.equal(up.messages.length,5);
  up.messages.forEach((m,i)=>{assert.equal(m.role,i%2?"assistant":"user");assert.equal(typeof m.content,"string")});
  const first=up.messages[0].content,card=C.cards.find(c=>c.ko===visible[1]);
  assert.ok(first.includes("첫 질문")&&first.includes(card.down),"server rebuilt the first turn from content.js");
  const all=JSON.stringify(up);
  assert.ok(!all.includes("HACKED"),"client reading/meaning text must never be forwarded");
  assert.ok(!all.includes("010-1234-5678")&&up.messages[4].content.includes("[전화번호]"),"question is redacted");
});

test("upstream errors map to reason codes",async()=>{
  const status=(code,text="")=>async()=>new Response(text,{status:code});
  for(const [up,reason] of [[status(429),"RATE"],[status(401),"BUDGET"],[status(400,'{"error":{"message":"Your credit balance is too low"}}'),"BUDGET"],
                            [status(500),"API_ERROR"],[okReply("",{}),"API_ERROR"],[okReply("x",{stop_reason:"refusal"}),"API_ERROR"]]){
    upstream=up;
    const r=await call(body());
    assert.equal(r.code,200);assert.deepEqual(r.out,{answer:null,reason});
  }
});

test("timeout and network failures map to TIMEOUT / API_ERROR",async()=>{
  upstream=async()=>{throw new DOMException("The operation was aborted due to timeout","TimeoutError")};
  assert.deepEqual((await call(body())).out,{answer:null,reason:"TIMEOUT"});
  upstream=async()=>{throw new TypeError("fetch failed")};
  assert.deepEqual((await call(body())).out,{answer:null,reason:"API_ERROR"});
});
