/* ══════════════════════════════════════════════════════════════
   마음의 향기 타로 — 카드 뽑기 · 리딩 글 · 향기 고르기 · 준비된 답변
   ══════════════════════════════════════════════════════════════
   글의 재료(카드 뜻, 감정 색, 주제별 한 줄, 자리별 문장)는 content.js 에 있어요.
   이 파일은 그 재료를 이어 붙이는 규칙이에요. 앱(index.html)과 테스트가 함께 씁니다.

   ⚠️ 고칠 때
     - 학생이 쓴 고민 한 줄(메모)은 이 파일로 들어오지 않아요. 썼는지 여부(hasNote)만 받아요.
     - 낱말 뒤의 조사(이/가, 은/는, 을/를, 과/와, 이라는/라는, 이에요/예요)는 꼭 josa() 로 붙이세요.
       받침을 보고 알맞은 쪽을 골라 줘요. 예) josa("친구 관계","이라는","라는") → "친구 관계라는"
     - 고친 뒤에는  node --test tests/  로 확인하세요. 5,000번 뽑아 보며 문장을 점검해요.
   ══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const node=typeof module==="object"&&module.exports;
const C=node?require("./content.js"):window.CONTENT;

/* ── 조사 ──
   마지막 글자에 받침이 있는지. 끝의 따옴표·문장부호는 건너뛰고 봐요.
   숫자는 읽는 소리로: 0 영·1 일·3 삼·6 육·7 칠·8 팔(10 십)은 받침 있음, 2 이·4 사·5 오·9 구는 없음 */
function hasJong(w){
  const ch=String(w).replace(/[^가-힣0-9]+$/,"").slice(-1);
  if(/[0-9]/.test(ch))return "013678".includes(ch);
  const k=ch.charCodeAt(0)-0xAC00;
  return k>=0&&k<11172&&k%28!==0;
}
const josa=(w,a,b)=>w+(hasJong(w)?a:b);
const nth=i=>["첫","두","세"][i]+" 번째";

/* ── 카드 뽑기 ── 숨긴 카드(hidden)는 deckPool() 에 없으므로 어떤 길로도 뽑히지 않아요 */
const FAN_MAX=36;        // 부채꼴에 펼치는 최대 장수 (실제로는 숨기지 않은 카드 수와 36 중 작은 값)
const REV_CHANCE=.28;    // 카드가 거꾸로(역방향) 나올 확률
function shuffled(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
const makeDeck=()=>shuffled(C.deckPool()).slice(0,FAN_MAX);
/* 부채꼴의 i번째 카드를 뒤집음 → {…카드, rev}. 덱은 겹치지 않지만, 혹시 이미 뽑았거나 숨긴 카드면 남은 카드에서 고름 */
function drawOne(deck,i,draw){
  let c=deck[i];
  if(!c||c.hidden||draw.some(d=>d.ko===c.ko)){
    const rest=C.deckPool().filter(x=>!draw.some(d=>d.ko===x.ko));
    c=rest[Math.floor(Math.random()*rest.length)];
  }
  return {...c,rev:Math.random()<REV_CHANCE};
}

/* ── 카드 뜻 ── */
const meaning=c=>c.rev?c.down:c.up;
const words=c=>meaning(c).split(/\s*,\s*/);
const quote=w=>`‘${w}’`;
/* 무거운 뜻인지: 보통 정방향은 가볍고 역방향은 무거워요. 예외는 카드의 heavyUp·lightDown 표시(content.js) */
const heavy=c=>c.rev?!c.lightDown:!!c.heavyUp;

/* '세 카드의 흐름' 요약 — 어느 문장이 나올지는 combine() 이 정해요 */
const FLOW={
  knot:"지금은 마음이 조금 엉켜 있거나 무거운 때일 수 있어요. 서둘러 답을 찾기보다, 무엇이 나를 멈추게 하는지 먼저 천천히 살펴보면 좋겠어요.",
  bright:"마지막 카드는 밝은 쪽을 바라보는 마음을 떠올리게 해요. 무리해서 밝아지려 하기보다, 오늘 있었던 작은 좋은 일 하나를 찾아보면 어떨까요?",
  light:"세 카드 모두 부드러운 쪽의 뜻이 나왔어요. 지금 내 안에 있는 좋은 힘을 알아차리고, 그 힘을 어디에 써 볼지 생각해 보세요.",
  turn:"지금은 마음이 조금 힘들어도, 그 안에서 방법이 보이기 시작할 수 있어요. 작은 행동 하나가 흐름을 바꿀 수 있어요.",
  mixed:"세 카드에는 가벼운 마음과 무거운 마음이 함께 있어요. 둘 다 내 마음이에요. 지금 할 수 있는 작은 일 하나부터 시작해 보세요."
};
function combine(a,b,c){
  const n=[a,b,c].filter(heavy).length;
  if(n>=2)return FLOW.knot;
  if(c.bright&&!c.rev)return FLOW.bright;
  if(n===0)return FLOW.light;
  return heavy(a)?FLOW.turn:FLOW.mixed;
}

/* ── 리딩 글 ── s = {color, topic, draw:[3장], hasNote}. 결과는 <p> 문단들(HTML) */
const cardNo=x=>Math.max(0,C.cards.findIndex(c=>c.ko===x.ko));   // 카드마다 문장이 조금씩 달라지게
function cardPart(x,i,topic){
  const k=cardNo(x),w=words(x).map(quote),first=w[0],rest=w.slice(1);
  const who=(x.rev?"거꾸로 나온 ":"")+"이 카드";
  const frame=[
    `${josa(who,"은","는")} ${josa(first,"을","를")} 떠올리게 해요.`,
    `${who}에는 ${josa(first,"이라는","라는")} 뜻이 담겨 있어요.`,
    `${josa(who,"이","가")} 먼저 보여 주는 뜻은 ${josa(first,"이에요","예요")}.`
  ][(k+i)%3];
  const tails=C.ROLE_TAIL[i]||[],tail=tails.length?tails[k%tails.length]:"";
  const t=[frame,
    rest.length?`${josa(rest.join(", "),"이라는","라는")} 뜻도 있어요.`:"",
    i===0&&topic?`${josa(quote(topic),"이라는","라는")} 주제로 보면, ${tail}`:tail,
    i===0&&topic?C.TOPIC_HOOK[topic]:"",
    x.notLiteral].filter(Boolean).join(" ");
  return `<p><b>${C.roles[i]} — ${x.ko} ${x.rev?"역방향":"정방향"}</b><br>${t}</p>`;
}
function make(s){
  const [a,b,c]=s.draw,color=s.color;
  const colorPart=color?`<p><b>내가 고른 색 — ${color}</b><br>${C.COLOR_MEANING[color]||"지금의 마음을 담은 색이에요."} 이 색을 마음 한쪽에 두고 세 카드를 읽어 볼게요.</p>`:"";
  const close=s.hasNote?"적어 둔 한 줄을 떠올리면서, 카드와 어울리는 작은 행동 하나를 정해 보세요."
    :"정답을 맞히는 것보다, 세 카드가 함께 들려주는 이야기를 알아차리는 게 더 중요해요.";
  const colorTie=color?` 처음에 고른 ${josa(color,"이","가")} 말해 주는 마음과 세 카드를 나란히 놓고, 비슷한 점과 다른 점을 생각해 보세요.`:"";
  return [colorPart,...[a,b,c].map((x,i)=>cardPart(x,i,s.topic)),
    `<p><b>세 카드의 흐름</b><br>${combine(a,b,c)} ${close}${colorTie}</p>`].filter(Boolean).join("\n");
}

/* ── 향기 고르기 ── 세 카드에서 하나씩 돌아가며: 1번 카드의 첫 결, 2번 카드의 아직 안 나온 첫 결, 3번 카드도 같이.
   그래도 모자라면 세 카드의 다른 결, 마지막으로 목록에서 아무거나. 결과에는 이어진 카드 자리(from: 0·1·2, 없으면 null) */
function pickScents(draw,lib){
  const out=[],any=a=>a[Math.floor(Math.random()*a.length)];
  const moodsOf=c=>(c.scent||[]).map(n=>C.SCENT_MOOD[n]).filter(Boolean);
  const take=(m,from)=>{
    if(out.length>=3||out.some(o=>o.mood===m))return false;
    const cands=lib.filter(s=>s.mood===m&&!out.some(o=>o.name===s.name));
    if(!cands.length)return false;
    out.push({...any(cands),from});
    return true;
  };
  draw.forEach((c,i)=>moodsOf(c).some(m=>take(m,i)));
  draw.forEach((c,i)=>moodsOf(c).forEach(m=>take(m,i)));
  while(out.length<3){
    const rest=lib.filter(s=>!out.some(o=>o.name===s.name));
    if(!rest.length)break;
    out.push({...any(rest),from:null});
  }
  return out;
}

/* ── 준비된 답변 (AI가 답할 수 없을 때) ──
   q 질문, n 지금까지 나온 준비된 답변 수(같은 질문도 답이 돌아가며 바뀌게), s = {draw, topic, scents}.
   질문 속 낱말로 알맞은 답을 고르고, 질문에 뽑은 카드 이름이 있으면 그 카드를 두고 답해요. */
const ROLE_SEE=["지금 내 마음과 닮은 모습으로 볼 수 있어요.","마음속에 숨어 있는 생각으로 볼 수 있어요.","앞으로 가져 볼 마음가짐으로 볼 수 있어요."];
const CLOSE=["정답은 없으니 편하게 생각해 보세요.","내 생각을 짧게 말해 보거나 적어 봐도 좋아요.","더 이야기하고 싶으면 선생님과 함께 나눠 봐도 좋아요."];
function localAnswer(q,n,s){
  const d=s.draw,t=String(q||""),i=Math.max(0,n|0);
  const named=d.find(x=>t.includes(x.ko)),turn=named||d[i%d.length];
  const first=x=>quote(words(x)[0]);
  const about=x=>`${josa(x.ko,"은","는")} ${x.rev?"거꾸로 나와서 ":""}${josa(first(x),"을","를")} 떠올리게 하는 카드예요. ‘${C.roles[d.indexOf(x)]}’ 자리에 있으니, ${ROLE_SEE[d.indexOf(x)]}${x.notLiteral?" "+x.notLiteral:""}`;
  let body;
  if(/거꾸로|역방향|뒤집/.test(t)){
    const r=named&&named.rev?named:d.find(x=>x.rev);
    body=r?`거꾸로 나온 카드는 나쁜 뜻이 아니라, 같은 그림을 다른 쪽에서 본 거예요. ${josa(r.ko,"은","는")} 거꾸로 나와서 ${josa(first(r),"을","를")} 떠올리게 해요. 이런 마음이 나에게도 있는지 살펴보는 기회로 삼아 보세요.`
      :"이번에는 세 장 모두 바로 나왔어요. 카드가 거꾸로 나오면 ‘역방향’이라고 하는데, 나쁜 뜻이 아니라 같은 그림을 다른 쪽에서 보는 거예요.";
  }else if(/무서|무섭|죽음|나쁜|불길|겁나/.test(t)){
    const x=d.find(x=>x.notLiteral);
    body=x?`${x.notLiteral} 그래도 무섭게 느껴졌다면 선생님께 이야기해도 괜찮아요.`
      :"타로 카드는 미래를 맞히거나 나쁜 일을 알려 주는 게 아니에요. 카드 그림을 보며 내 마음을 떠올려 보는 활동이에요. 무서운 마음이 들면 선생님께 이야기해 보세요.";
  }else if(/향|냄새/.test(t)&&s.scents&&s.scents.length){
    const sc=s.scents[i%s.scents.length];
    body=`추천 향기는 ${josa(s.scents.map(x=>x.name).join(", "),"이에요","예요")}. ${josa(sc.name,"은","는")} ${josa(C.MOOD_DESC[sc.mood]||"카드와 어울리는 향기","이에요","예요")}. 눈을 감고 맡아 본 뒤, 지금 내 마음과 가장 닮은 향기를 직접 골라 보세요.`;
  }else if(/숨은|숨어|숨겨|보이지|영향|속마음/.test(t)){
    const b=d[1];
    body=`‘${C.roles[1]}’ 자리에는 ${josa(b.ko,"이","가")} 놓였어요. ${josa(first(b),"은","는")} 겉으로는 잘 안 보여도 마음 한쪽에 함께 있을 수 있는 마음이에요. 요즘 나도 모르게 이런 마음이 들었는지 떠올려 보세요.`;
  }else if(/왜|이유/.test(t)){
    body=`카드는 섞인 것 가운데 내가 고른 거라, 꼭 정해진 이유가 있는 건 아니에요. 대신 ${turn.ko} 카드를 거울처럼 보고, ${josa(first(turn),"이라는","라는")} 뜻이 요즘 나와 닮았는지 생각해 보세요.`;
  }else if(/어떻게|뭘|무엇을|방법|해야|할까|하면|행동|해 ?볼/.test(t)){
    const x=named||d[2];
    body=`‘${C.roles[d.indexOf(x)]}’ 자리의 ${josa(x.ko,"은","는")} ${josa(first(x),"을","를")} 떠올리게 해요. `
      +(heavy(x)?"이런 마음이 들 때는 잠깐 멈추고, 천천히 할 수 있는 일부터 골라 보세요.":"이 마음을 오늘 할 수 있는 작은 행동 하나로 바꿔 본다면 무엇이 있을까요?");
  }else if(/친구|가족|공부|시험|숙제|학교|학원|엄마|아빠|부모|형|누나|언니|오빠|동생/.test(t)&&s.topic){
    body=`${josa(quote(s.topic),"이라는","라는")} 주제로 보면, ${josa(turn.ko,"이","가")} 보여 주는 ${josa(first(turn),"이","가")} 그 마음과 닮았는지 생각해 보세요. ${C.TOPIC_HOOK[s.topic]||""}`.trim();
  }else body=about(turn);
  return `${body} ${CLOSE[i%CLOSE.length]}`;
}

const Reading={hasJong,josa,nth,FAN_MAX,REV_CHANCE,makeDeck,drawOne,meaning,heavy,FLOW,combine,make,pickScents,localAnswer};
if(node)module.exports=Reading;
if(typeof window!=="undefined")window.Reading=Reading;
})();
