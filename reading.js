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
/* n: 펼칠 장수(휴대폰은 앱이 15를 넘김). 어떤 경우든 FAN_MAX 와 숨기지 않은 카드 수를 넘지 않아요 */
const makeDeck=(n=FAN_MAX)=>shuffled(C.deckPool()).slice(0,Math.min(n,FAN_MAX));
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

/* '세 카드의 흐름' 요약 — 어느 문장이 나올지는 combine() 이 정해요. 권하는 말은 하나만(숙제처럼 여러 개 주지 않게) */
const FLOW={
  knot:"세 장을 이어 보니, 마음속 실타래가 조금 엉켜 있는 것 같아요. 서둘러 풀지 않아도 괜찮아요. 어디서부터 엉켰는지 천천히 따라가 봐요.",
  bright:"마지막 카드가 밝은 쪽을 바라보고 있어요. 억지로 웃지 않아도 괜찮아요. 오늘 있었던 작은 좋은 일 하나를 떠올려 볼까요?",
  light:"세 장 모두 부드러운 얼굴로 나왔어요. 내 안에 좋은 힘이 숨어 있다는 뜻 같아요. 그 힘을 어디에 써 보고 싶나요?",
  turn:"첫 카드는 조금 무거워 보여도, 뒤의 카드들은 한결 가벼워요. 힘든 마음속에서도 작은 길이 보이기 시작하는 것 같아요.",
  mixed:"세 장 안에 가벼운 마음과 무거운 마음이 나란히 있어요. 둘 다 진짜 내 마음이에요. 지금은 어느 쪽 목소리가 더 크게 들리나요?"
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
/* 그림 이야기(story)의 첫 문장 — 정방향 카드는 그림 속 장면으로 문단을 열어요(사전처럼 뜻부터 늘어놓지 않게) */
const picture=x=>{const m=/^[^.!?]*[.!?]/.exec(String(x.story||"").trim());return m?m[0]:""};
function cardPart(x,i,topic){
  const k=cardNo(x),raw=words(x),w=raw.map(quote);
  // 앞의 두 낱말만 — ‘집중’과 ‘해내는 힘’. 낱말이 길면(‘아쉬움과 잃어버림’) 하나만 — 문장이 늘어지지 않게
  const both=w[1]&&raw[0].length<=6&&raw[1].length<=7&&!/[과와] /.test(raw[1])?`${josa(w[0],"과","와")} ${w[1]}`:w[0];
  const frame=x.rev?[
    `카드가 거꾸로 나왔어요. 이쪽에서 보면 ${josa(both,"이","가")} 눈에 띄어요.`,
    `거꾸로 놓인 그림은 ${josa(both,"을","를")} 보여 줘요.`,
    `그림이 거꾸로 놓였네요. 반대쪽에서 바라보니 ${josa(both,"이","가")} 보여요.`
  ][(k+i)%3]:[picture(x),[
    `이 그림은 ${josa(both,"을","를")} 속삭이고 있어요.`,
    `이 카드가 들려주는 말은 ${josa(both,"이에요","예요")}.`,
    `그림을 보고 있으면 ${josa(both,"이","가")} 떠올라요.`
  ][(k+i)%3]].filter(Boolean).join(" ");
  // '앞으로 취할 태도' 자리의 무거운 뜻(혼란·도움을 피함 …)은 그렇게 하라는 말로 읽히지 않게 따로
  const tails=C.ROLE_TAIL[i]||[],tail=i===2&&heavy(x)?C.ROLE_TAIL_HEAVY:tails.length?tails[k%tails.length]:"";
  const t=[frame,tail,i===0&&topic?C.TOPIC_HOOK[topic]:"",x.notLiteral].filter(Boolean).join(" ");
  return `<p><b>${C.roles[i]} — ${x.ko} ${x.rev?"역방향":"정방향"}</b><br>${t}</p>`;
}
function make(s){
  const [a,b,c]=s.draw,color=s.color;
  const colorPart=color?`<p><b>내가 고른 색 — ${color}</b><br>${C.COLOR_MEANING[color]||"지금의 마음을 담은 색이에요."} 이 색을 한쪽에 놓아두고, 이제 카드 이야기를 하나씩 들어 볼게요.</p>`:"";
  const jotted=s.hasNote?" 아까 적어 둔 한 줄은 카드와 맞춰 보지 않고, 내 마음속에 소중히 간직해 둬요.":"";
  const colorTie=color?` 처음에 고른 ${color}의 마음도 이 이야기 속에 함께 흐르고 있어요.`:"";
  return [colorPart,...[a,b,c].map((x,i)=>cardPart(x,i,s.topic)),
    `<p><b>세 카드의 흐름</b><br>${combine(a,b,c)}${jotted}${colorTie}</p>`].filter(Boolean).join("\n");
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
   질문 속 낱말로 알맞은 답을 고르고, 질문에 뽑은 카드 이름이 있으면 그 카드를 두고 답해요.
   카드는 늘 '○○ 카드'라고 불러요('죽음은 …'처럼 쓰면 카드 이야기인지 헷갈려요).
   물어본 카드가 없을 때는 죽음·탑(notLiteral)이 아닌 카드를 골라, 학생 이야기를 무서운 카드와 잇지 않아요. */
const ROLE_SEE=["지금 내 마음과 닮은 모습인지도 몰라요.","마음속에 숨어 있는 생각일지도 몰라요.","다음 걸음에 챙겨 갈 마음일지도 몰라요."];
const ROLE_SEE_HEAVY="이런 마음이 찾아올 때 나를 도와줄 방법은 무엇일지 생각해 봐요.";
const CLOSE=["정답은 없어요. 어떤 생각이든 다 괜찮아요.","생각난 걸 짧게 말해 보거나 적어 봐도 좋아요.","더 이야기하고 싶으면 선생님과 함께 나눠 봐요."];
/* 흔한 낱말과 같은 카드 이름(나는 바보 같아요 · 달리기 · 힘이 없어요)은 뒤에 '카드'·'정방향'·'역방향'이 올 때만 카드로 봄 */
const WORDY=/^(?:바보|힘|달|정의|절제|정원|열쇠|물고기|닻)$/;
const SCARY=/무서|무섭|죽음|나쁜|불길|겁나/;
/* 가족이 아프거나 돌아가심, 부모님의 다툼·이혼 — 카드와 잇지 않고 믿을 수 있는 어른에게 */
const SAD=/아프|아파|아팠|병원|입원|수술|돌아가|죽었|하늘나라|장례|이혼|헤어졌|헤어질|(?:엄마|아빠|부모님)[^.?!]{0,10}(?:싸우|싸워|싸웠)/;
const HOW=/어떻게 ?(?:하면|해야|할까)|(?:하면|해야) ?(?:될까|돼|되|할까)|면 ?좋을까|뭘 ?(?:하면|해야|할까|해 ?볼)|무엇을 ?(?:하면|해야|해 ?볼)|방법|행동|해 ?볼/;
const FUTURE=/미래|내일|나중에|커서|될까|생길까|붙을까|합격|이길까|잘 ?(?:볼|될|할) ?수/;
function localAnswer(q,n,s){
  const d=s.draw,t=String(q||""),i=Math.max(0,n|0),scents=s.scents||[];
  const says=x=>WORDY.test(x.ko)?new RegExp(x.ko+"\\s*(?:카드|정방향|역방향)").test(t):t.includes(x.ko);
  const named=d.find(says);
  const other=!named&&C.deckPool().find(x=>says(x)&&!d.some(y=>y.ko===x.ko));   // 이번에 뽑지 않은 카드를 물었을 때
  // 질문 속 낱말과 이름이 같은 카드(나는 바보 같아요 → 바보)는 고르지 않음 — 학생이 한 말을 카드로 되돌려주지 않게
  const calm=d.filter(x=>!x.notLiteral),quiet=calm.filter(x=>!t.includes(x.ko)),pool=quiet.length?quiet:calm.length?calm:d;
  const turn=named||pool[i%pool.length],last=named||pool[pool.length-1];
  const story=d.find(x=>x.ask&&t.includes(x.ask));   // 그림 이야기의 '나라면?' 질문(이걸 물어볼래요)이면 그 카드
  const nm=x=>x.ko+" 카드",first=x=>quote(words(x)[0]),calmNote=x=>x.notLiteral?" "+x.notLiteral:"";
  const about=x=>{const k=d.indexOf(x);return `${josa(nm(x),"은","는")} ${x.rev?"거꾸로 나와서 ":""}${josa(first(x),"을","를")} 떠올리게 해요. ‘${C.roles[k]}’ 자리에 있으니, ${k===2&&heavy(x)?ROLE_SEE_HEAVY:ROLE_SEE[k]}${calmNote(x)}`};
  let body;
  if(SAD.test(t)&&!story)return "이야기해 줘서 고마워요. 그런 일이 있으면 마음이 많이 무겁고 걱정될 수 있어요. 이 마음은 카드보다 선생님이나 믿을 수 있는 어른과 나누는 게 좋아요. 지금 선생님께 이야기해 볼까요?";
  if(story){
    body=`${nm(story)} 그림을 다시 떠올려 보세요. 이 카드는 ${story.rev?"거꾸로 나와서 ":""}${josa(first(story),"을","를")} 떠올리게 해요. 이 뜻을 생각하며 ‘${story.ask}’에 떠오르는 대로 답해 보세요.`;
  }else if(other&&!SCARY.test(t)){
    body=`${josa(nm(other),"은","는")} 이번에 뽑은 카드가 아니에요. 내가 뽑은 카드는 ${josa(d.map(x=>x.ko).join(", "),"이에요","예요")}. 그중 한 장을 골라 다시 물어봐 주세요.`;
  }else if(/거꾸로|역방향|뒤집/.test(t)){
    const r=named&&named.rev?named:d.find(x=>x.rev);
    body=r?`거꾸로 나온 카드는 나쁜 뜻이 아니라, 같은 그림을 다른 쪽에서 본 거예요. ${josa(nm(r),"은","는")} 거꾸로 나와서 ${josa(first(r),"을","를")} 떠올리게 해요. 이런 마음이 나에게도 있는지 살펴보는 기회로 삼아 보세요.`
      :"이번에는 세 장 모두 똑바로(정방향으로) 나왔어요. 카드가 거꾸로 나오면 ‘역방향’이라고 하는데, 나쁜 뜻이 아니라 같은 그림을 다른 쪽에서 보는 거예요.";
  }else if(SCARY.test(t)){
    const x=named&&named.notLiteral?named:d.find(x=>x.notLiteral);   // 물어본 카드가 죽음·탑이면 그 카드, 아니면 뽑은 죽음·탑
    body=x?`${josa(nm(x),"은","는")} ${x.notLiteral.replace(/^이 카드는 /,"")} 그래도 무섭게 느껴졌다면 선생님께 이야기해도 괜찮아요.`
      :"타로 카드는 미래를 맞히거나 나쁜 일을 알려 주는 게 아니에요. 카드 그림을 보며 내 마음을 떠올려 보는 활동이에요. 무서운 마음이 들면 선생님께 이야기해 보세요.";
  }else if(scents.length&&(/향기|냄새|시향/.test(t)||scents.some(x=>t.includes(x.name)))){   // '영향'·'정방향'의 '향'은 향기가 아니에요
    const sc=scents.find(x=>t.includes(x.name))||scents[i%scents.length];
    body=`추천 향기는 ${josa(scents.map(x=>x.name).join(", "),"이에요","예요")}. ${josa(sc.name,"은","는")} ${josa(C.MOOD_DESC[sc.mood]||"카드와 어울리는 향기","이에요","예요")}. 눈을 감고 맡아 본 뒤, 지금 내 마음과 가장 닮은 향기를 직접 골라 보세요.`;
  }else if(/숨은|숨어|숨겨|보이지|영향|속마음/.test(t)){
    const b=d[1];
    body=`‘${C.roles[1]}’ 자리에는 ${josa(nm(b),"이","가")} 놓였어요. 이 카드는 ${josa(first(b),"을","를")} 떠올리게 해요. 겉으로는 잘 안 보여도 마음 한쪽에 이런 생각이 있을 수 있어요. 요즘 나도 모르게 이런 마음이 들었는지 떠올려 보세요.`;
  }else if(/왜.*(?:카드|나왔|뽑|거꾸로)|이유/.test(t)){   // 카드가 왜 나왔는지 — '왜 나는 …' 같은 내 이야기는 아래에서
    body=`카드는 잘 섞은 뒤 내가 고른 거라, 꼭 정해진 이유가 있는 건 아니에요. 대신 ${josa(nm(turn),"을","를")} 거울처럼 보고, ${josa(first(turn),"이라는","라는")} 뜻이 요즘 나와 닮았는지 생각해 보세요.${calmNote(turn)}`;
  }else if(HOW.test(t)){   // 어떻게 하면 될까요? — 앞일 질문(될까)보다 먼저
    body=`‘${C.roles[d.indexOf(last)]}’ 자리의 ${josa(nm(last),"은","는")} ${josa(first(last),"을","를")} 떠올리게 해요. `
      +(heavy(last)?"이런 마음이 들 때는 잠깐 멈추고, 천천히 할 수 있는 일부터 골라 보세요.":"이 마음을 오늘 할 수 있는 작은 행동 하나로 바꿔 본다면 무엇이 있을까요?")+calmNote(last);
  }else if(FUTURE.test(t)&&!/왜/.test(t)){   // 앞일을 묻는 질문 — 카드는 앞일을 맞히지 않아요
    body=`카드는 앞일을 맞히지 않아요. 대신 ${josa(nm(last),"이","가")} 보여 주는 ${josa(first(last),"을","를")} 떠올리며, `
      +(heavy(last)?"이런 마음이 들 때 오늘 나를 도와줄 작은 일을 하나 생각해 보세요.":"오늘 내가 해 볼 수 있는 일을 생각해 보세요.")+calmNote(last);
  }else if(/친구|가족|공부|시험|숙제|학교|학원|엄마|아빠|부모|형|누나|언니|오빠|동생|왜 ?(?:나|저)는|(?:나|저)는 왜/.test(t)){   // 내 이야기를 했을 때 — 먼저 고맙다고 하고 카드와 이어 봄
    body=`이야기해 줘서 고마워요. ${josa(nm(turn),"이","가")} 보여 주는 ${josa(first(turn),"이","가")} 지금 내 이야기와 닮은 점이 있는지 천천히 생각해 보세요.${calmNote(turn)}`;
  }else body=about(turn);
  return `${body} ${CLOSE[i%CLOSE.length]}`;
}

const Reading={hasJong,josa,nth,FAN_MAX,REV_CHANCE,makeDeck,drawOne,meaning,heavy,FLOW,combine,make,pickScents,localAnswer};
if(node)module.exports=Reading;
if(typeof window!=="undefined")window.Reading=Reading;
})();
