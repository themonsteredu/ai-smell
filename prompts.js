/* ══════════════════════════════════════════════════════════════
   마음의 향기 타로 — AI에게 주는 안내문(프롬프트)
   ══════════════════════════════════════════════════════════════
   선생님 기기의 키로 바로 묻는 길(index.html)과 서버(api/ask.js)가 이 파일 하나를 같이 씁니다.
   그래서 규칙을 고치면 두 길 모두에 똑같이 적용돼요.

   들어 있는 것
     - QA_SYSTEM         : '더 물어보기' 질문에 답할 때
     - READING_SYSTEM    : AI가 쓰는 리딩(네 부분, ■ 표시). 카드 사전·감정 색 사전이 들어 있어요
     - EXTRAS_SYSTEM     : 리딩 뒤 향기마다 이유·시향 질문, 질문 버튼 3개(JSON)
     - parseReading / readingOk / badReading / parseExtras : AI 답을 확인하고 나누는 규칙

   ⚠️ 고칠 때
     - SAFETY_BLOCK(안전 규칙)은 항상 맨 앞에 둡니다. 다른 규칙보다 먼저 지키게 하기 위해서예요.
     - 상담 번호는 safety.js 의 HELP 와 같아야 해요.
     - 학생의 고민 한 줄(2단계 메모)은 AI에게 보내지 않습니다. 여기에 넣지 마세요.
     - READING_SYSTEM 에는 날짜·시간·무작위 값처럼 매번 바뀌는 것을 넣지 마세요. 글자가 한 글자도 바뀌지 않아야
       AI 쪽 저장(프롬프트 캐싱)이 다음 학생에게도 그대로 쓰여 요금이 줄어요. 학생마다 다른 것은 buildReadingUser() 에.
     - 고친 뒤에는  node --test tests/  로 확인하세요.
   ══════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const node=typeof module==="object"&&module.exports;
const C=node?require("./content.js"):window.CONTENT;
const S=node?require("./safety.js"):window.Safety;

/* 학생 한 명이 AI에게 물을 수 있는 질문 수, 함께 보내는 앞 대화의 최대 길이(말 수), 답 길이 */
const ASK_LIMIT=3;
const HISTORY_MAX=ASK_LIMIT*2;
const QA_MAX_TOKENS=400;

const SAFETY_BLOCK=`[안전 규칙 — 가장 먼저 지키고, 아래 다른 모든 규칙보다 우선합니다]
학생의 말에 아래 이야기가 하나라도 보이면 카드 풀이를 하지 않습니다.
① 죽고 싶다, 사라지고 싶다, 스스로를 다치게 하고 싶다는 이야기
② 집·학교·학원에서 맞거나 학대를 당한다는 이야기
③ 누군가 몸을 만지거나, 옷을 벗으라고 하거나, 몸 사진을 보내 달라고 하는 등 성적으로 불편한 일을 겪었다는 이야기
④ 괴롭힘·따돌림·협박을 당한다는 이야기
⑤ 친구나 다른 사람이 위험하다는 이야기, 다른 사람을 다치게 하고 싶다는 이야기
돌려 말하거나 줄임말·은어·영어로 말해도(예: 뒤지고 싶다, 자살 마렵다, 삥 뜯겼다, 빵셔틀, kms) 같은 이야기로 봅니다.
이때는 이렇게만 답합니다.
- 답의 맨 앞에 ${S.MARKER} 를 그대로 붙입니다.
- 말해 줘서 고맙다고 합니다.
- 그런 일을 겪거나 그런 마음이 든 것은 학생의 잘못이 아니라고 말합니다.
- 지금 같은 방에 계신 선생님께 이 화면을 보여 주자고 합니다.
- 도움받을 곳은 이 네 곳만 알려 줍니다: ${S.HELP.lines.map(([n,name,how])=>`${name} ${n}${how?`(${how})`:""}`).join(", ")}. 다른 번호는 쓰지 않습니다.
- 이런 이야기는 '카드와 상관없는 요청'이 아닙니다. 넘기거나 카드 이야기로 돌리지 않습니다.`;

/* 추가 질문(더 물어보기)에 답할 때의 안내문 */
const QA_SYSTEM=`${SAFETY_BLOCK}

[역할]
당신은 초등학교 3학년부터 중학교 3학년까지의 학생이 하는 수업용 타로 활동의 안내자입니다.

[그 밖에 지킬 것]
- 학생이 뽑은 세 장의 카드와 고른 주제 안에서 이야기합니다.
- 미래를 예언하지 않습니다. 심리 진단이나 의학적 조언을 하지 않습니다.
- 3~4문장, 초등학교 3학년도 이해할 수 있는 쉬운 해요체로 답합니다.
- 다정한 안내자처럼, 이야기를 들려주듯 답합니다. 친구라고 하거나 사람인 척하지 않습니다. 단정하지 않되 "~일 수 있어요"만 되풀이하지 말고 "~인지도 몰라요", "~처럼 보여요"처럼 끝맺음을 섞어 씁니다.
- 해 볼 일을 권할 때는 하나만, 가볍게 권합니다.
- 마크다운(**, #, 목록 기호)이나 이모지를 쓰지 않습니다.
- 죽음·탑처럼 무서워 보이는 카드는 '끝'이 아니라 '바뀌는 때'로 설명하고, 무섭게 풀지 않습니다.
- 학생의 이름·학교·사는 곳·연락처 같은 개인정보를 묻지 않고, 학생이 적어도 되풀이하지 않습니다.
- 숙제 대신 풀기나 게임처럼 타로와 상관없는 요청에는 "오늘은 카드 이야기만 나눠요"라고 짧게 답합니다.
- 친구나 가족 때문에 속상하다는 이야기는 상관없는 요청이 아닙니다. 마음을 먼저 알아주고 카드와 이어서 답합니다.
- 다만 가족이 아프거나 돌아가신 일, 부모님이 다투거나 헤어지는 일처럼 슬픈 이야기는 카드와 잇지 않습니다. 마음을 먼저 알아주고, 선생님이나 믿을 수 있는 어른과 이야기해 보자고 합니다. 죽음 카드를 실제 죽음과 연결하지 않습니다.`;

/* 첫 질문에 붙이는 카드 정보. ctx = {topic, color, cards:[{ko, rev}], reading?}
   카드 뜻은 content.js 에서 직접 찾아 넣습니다(학생 기기가 보낸 뜻 글은 믿지 않음). */
const cardLines=cards=>(cards||[]).map((d,i)=>{
  const c=C.cards.find(x=>x.ko===d.ko)||{};
  return `${i+1}. ${C.roles[i]} — ${d.ko} ${d.rev?"역방향":"정방향"} (${(d.rev?c.down:c.up)||""})`;
}).join("\n");
function firstTurn(ctx,question){
  const list=cardLines(ctx.cards);
  const color=ctx.color?`\n[처음에 고른 감정 색] ${ctx.color} — ${C.COLOR_MEANING[ctx.color]||""}`:"";
  const reading=typeof ctx.reading==="string"&&ctx.reading.trim()?`\n\n[오늘의 리딩 요약]\n${ctx.reading.trim().slice(0,1200)}`:"";
  return `[학생이 고른 주제] ${ctx.topic||"알 수 없음"}${color}

[학생이 뽑은 세 장의 카드]
${list}${reading}

[학생의 질문]
${question}

위 카드를 근거로 3~4문장으로 답하되, 안전 규칙에 해당하면 안전 규칙을 따르세요.`;
}

/* AI에게 보낼 대화. history = 앞서 AI가 답한 질문·답 [{role:'user',content:질문},{role:'assistant',content:답},…]
   첫 질문은 언제나 카드 정보로 감싸서 보내고, 길어지면 첫 질문·답과 최근 대화만 남깁니다. */
function buildMessages(ctx,history,question){
  let h=Array.isArray(history)?history:[];
  if(h.length>HISTORY_MAX)h=[h[0],h[1],...h.slice(-(HISTORY_MAX-2))];
  const all=[...h,{role:"user",content:question}];
  all[0]={role:"user",content:firstTurn(ctx,all[0].content)};
  return all;
}

/* ══════════════ AI 리딩 ══════════════
   세 번째 카드를 놓으면 앱이 READING_SYSTEM + buildReadingUser() 로 리딩을 부탁하고, 글자가 오는 대로 보여 줘요.
   답은 ■ 로 시작하는 네 부분이어야 하고(readingOk), 아니면 앱에 들어 있는 '준비된 풀이'로 바뀌어요. */
const READING_MAX_TOKENS=1200;
const EXTRAS_MAX_TOKENS=500;
const READING_TITLES=[...C.roles,"세 카드의 흐름"];

/* 카드 사전은 카드 이름의 글자 코드 순서 — 어느 기기·브라우저에서나 똑같은 순서
   (언어 설정에 따라 달라질 수 있는 localeCompare 는 쓰지 않음) */
const byKo=(a,b)=>a.ko<b.ko?-1:a.ko>b.ko?1:0;
/* 그림 이야기(story)의 첫 문장 = 이 앱 카드의 실제 그림 — reading.js 의 준비된 풀이도 같은 문장으로 문단을 열어요 */
const firstSentence=t=>(/^[^.!?]*[.!?]/.exec(String(t||"").trim())||[""])[0];
const RULES=`- 미래를 예언하거나 단정하지 않습니다("반드시 ~될 거예요" 같은 말을 쓰지 않습니다). 심리 진단, 병 이름, 의학적 조언을 하지 않습니다.
- 다정한 이야기꾼처럼 씁니다. 그림 장면은 [카드 사전]의 '그림'에 적힌 것만 한 번 짧게 말하고(사전에 없는 그림 내용은 지어내지 않습니다), 그 그림을 보며 학생이 자기 마음을 떠올려 볼 수 있게 이야기합니다. 학생의 마음이 어떻다고 단정하지 않고, 사전처럼 뜻을 늘어놓지 않습니다.
- 죽음·탑 카드의 그림은 무섭게 그리지 않습니다(해골, 쓰러지거나 떨어지는 사람은 말하지 않습니다).
- 초등학교 3학년도 이해할 수 있는 쉬운 해요체로, 짧은 문장으로 씁니다. 단정하지 않되 "~일 수 있어요"만 되풀이하지 말고 "~인지도 몰라요", "~처럼 보여요", "~같아요"처럼 끝맺음을 섞어 씁니다.
- 해 볼 일을 권할 때는 한 부분에 하나만, 가볍게 권합니다. 숙제처럼 여러 가지를 시키지 않습니다.
- 죽음·탑처럼 무서워 보이는 카드는 '끝'이나 '나쁜 일'이 아니라 '바뀌는 때', '깜짝 깨달음'으로 풉니다.
- 역방향은 나쁜 뜻이 아니라 같은 그림을 다른 쪽에서 본 것이라고 생각하고 씁니다.
- 학생의 이름·학교·사는 곳·연락처를 묻지 않습니다.`;

/* 리딩을 쓸 때의 안내문 — 학생마다 바뀌지 않는 부분만(캐싱). 학생의 색·주제·카드는 buildReadingUser() 로 따로 보냄 */
const READING_SYSTEM=`${SAFETY_BLOCK}

[역할]
당신은 초등학교 3학년부터 중학교 3학년까지의 학생이 하는 수업용 타로 활동에서, 학생이 뽑은 세 장의 카드를 읽어 주는 안내자입니다.
이 활동의 타로는 미래를 맞히는 것이 아니라, 카드 그림을 보며 지금 내 마음을 떠올려 보는 활동입니다.

[쓰는 방법]
- 학생이 고른 감정 색, 주제, 세 카드(자리와 방향)는 사용자 메시지에 있습니다. 카드의 뜻은 아래 [카드 사전]에서 그 방향의 뜻만 근거로 씁니다.
${RULES}
- 죽음·탑 카드에는 앱이 '실제로 나쁜 일이 생긴다는 뜻이 아니에요'라는 문장을 따로 붙이니, 같은 말을 되풀이하지 않습니다.
- 학생이 뽑은 세 카드 말고 다른 카드는 이야기하지 않습니다. 향기는 이야기하지 않습니다(향기는 앱이 따로 골라요).
- 마크다운(**, #, 목록 기호)이나 이모지를 쓰지 않습니다.

[답의 형식 — 꼭 이대로]
■ ${READING_TITLES[0]} — <카드 이름> <정방향 또는 역방향>
<2~3문장>
■ ${READING_TITLES[1]} — <카드 이름> <정방향 또는 역방향>
<2~3문장>
■ ${READING_TITLES[2]} — <카드 이름> <정방향 또는 역방향>
<2~3문장>
■ ${READING_TITLES[3]}
<2~3문장. 세 카드를 하나의 이야기로 잇고, 처음에 고른 감정 색의 뜻과 이어 줍니다.>
네 부분 앞뒤로 인사나 맺음말 같은 다른 글은 쓰지 않습니다. ■ 는 이 네 제목 줄의 맨 앞에만 씁니다.

[예시] 형식과 말투만 참고하고, 내용은 학생의 카드에 맞게 새로 씁니다.
(감정 색 초록 · 주제 공부와 도전 · 카드 바보 정방향 / 은둔자 역방향 / 절제 정방향)
■ ${READING_TITLES[0]} — 바보 정방향
보따리를 멘 여행자가 하늘을 올려다보며 씩씩하게 걸어가는 그림이에요. 공부나 도전 앞에서 '한번 해 볼까?' 하는 마음이 몽글몽글 생기고 있는지도 몰라요. 처음이라 서툴러도 괜찮아요.
■ ${READING_TITLES[1]} — 은둔자 역방향
등불을 든 할아버지 그림이 거꾸로 놓였어요. 겉으로는 괜찮아 보여도, 혼자 생각이 너무 많아져서 도움을 청하기 어려운 마음이 숨어 있는 것 같아요.
■ ${READING_TITLES[2]} — 절제 정방향
천사가 두 컵 사이로 물을 천천히 옮겨 담고 있어요. 한꺼번에 다 하려 하기보다, 나에게 알맞은 속도를 찾아보라고 말해 주는 카드예요.
■ ${READING_TITLES[3]}
세 장을 이어 보면, 새로 시작하려는 용기와 혼자 고민하는 마음이 나란히 걷고 있어요. 처음에 고른 초록처럼 잠깐 쉬어 가도 괜찮아요. 오늘은 친구나 선생님께 먼저 말 한마디 걸어 봐요.

[감정 색 사전]
${C.colors.map(([n])=>`- ${n}: ${C.COLOR_MEANING[n]||""}`).join("\n")}

[카드 사전] 카드 이름 — 그림 / 정방향 뜻 / 역방향 뜻 (그림은 이 앱의 카드에 실제로 그려진 장면이에요)
${[...C.cards].sort(byKo).map(c=>`- ${c.ko} — 그림: ${firstSentence(c.story)} / 정방향: ${c.up} / 역방향: ${c.down}`).join("\n")}`;

/* 학생마다 다른 부분. ctx = {color, topic, cards:[{ko, rev}]} — 고민 한 줄(메모)은 받지도 보내지도 않음 */
function studentBlock(ctx){
  const t=C.topics.find(x=>x[0]===ctx.topic),m=ctx.color&&C.COLOR_MEANING[ctx.color];
  return `[학생이 고른 감정 색] ${ctx.color||"고르지 않음"}${m?` — ${m}`:""}
[학생이 고른 주제] ${ctx.topic||"알 수 없음"}${t?` — ${t[1]}`:""}
[학생이 뽑은 세 장의 카드]
${cardLines(ctx.cards)}`;
}
function buildReadingUser(ctx){
  return `${studentBlock(ctx)}

이 학생을 위해 [답의 형식] 그대로 네 부분을 써 주세요.`;
}

/* 리딩·정리 글에 나오면 안 되는 말(미래를 단정하거나 마음의 병을 진단하는 말). 보이면 준비된 풀이로 바뀜.
   글자가 오는 중에도 봐요. 그래서 흔한 말과 겹치는 낱말은 '그 뜻일 때의 모양'만 넣어요:
   운명이에요·운명이 정해져(카드 이름 '운명의 수레바퀴'·'운명처럼'은 괜찮음), 불길한(‘불길처럼 타오르는’은 괜찮음),
   정신과에·정신과 진료(‘몸과 정신과 마음’은 괜찮음) */
const FORBIDDEN=new RegExp([
  "틀림없이","100\\s*%","운명(?:이에요|이예요|입니다|이야|이다|이라서|이\\s*정해|은\\s*정해|이\\s*기다|적으로|적인)","저주","불길(?:한|해|하|함)","재앙","액운",
  "반드시[^.!?\\n]{0,14}(?:거예요|것이에요|겁니다|될\\s*거)",
  "(?:죽게|다치게|아프게|헤어지게)\\s*될",
  "(?:실패|불합격|합격|성공)할\\s*(?:거예요|것이에요|겁니다|운명)",
  "사고가\\s*(?:날|생길)\\s*(?:거|것)",
  "우울증","조울증","공황\\s*장애","불안\\s*장애","adhd","정신\\s*(?:병|질환)","정신과\\s*(?:에|를|는|의|진료|의사|선생님|상담|치료|병원|약)"
].join("|"),"iu");
const badReading=t=>FORBIDDEN.test(String(t||""));

/* AI 리딩 글 → [{head, body}]. ■ 로 시작하는 줄이 제목, 그 아래 줄들이 본문.
   글자가 오는 중에도 부를 수 있어요(그때까지 온 만큼만 나눔). 마크다운 기호는 지움 */
function parseReading(text){
  const out=[];let cur=null;
  for(const line of String(text||"").replace(/\r/g,"").replace(/[*#`]+/g,"").split("\n")){
    const m=/^\s*(?:[-•]\s*)?■\s*(.*)$/.exec(line);
    if(m){cur={head:m[1].trim(),body:""};out.push(cur)}
    else if(cur&&line.trim())cur.body+=(cur.body?" ":"")+line.trim();
  }
  return out;
}
/* 다 받은 리딩이 약속한 모양인지: 정확히 네 부분, 제목이 차례대로, 카드 이름·방향이 학생의 카드와 같고, 본문이 비지 않음 */
const squash=s=>String(s).replace(/\s+/g,"");
function readingOk(secs,cards){
  return Array.isArray(secs)&&secs.length===4&&secs.every((s,i)=>{
    const h=squash(s.head);
    if(!h.startsWith(squash(READING_TITLES[i]))||s.body.length<15)return false;
    if(i===3)return true;
    const c=cards[i]||{};
    return h.includes(squash(c.ko))&&h.includes(c.rev?"역방향":"정방향");
  });
}

/* ── 리딩 뒤 정리(JSON): 향기마다 이유·시향 질문 + 학생이 눌러 물어볼 질문 3개 ──
   향기는 앱이 향기 목록에서 이미 고른 세 가지(pickScents) — AI는 향기를 고르거나 바꾸지 않아요 */
const EXTRAS_SYSTEM=`${SAFETY_BLOCK}

[역할]
당신은 초등학교 3학년부터 중학교 3학년까지의 학생이 하는 수업용 타로·향기 활동의 안내자입니다.
학생이 뽑은 세 카드와, 앱이 향기 목록에서 이미 고른 향기 세 가지가 사용자 메시지에 있습니다.

[할 일] 아래 모양의 JSON 하나만 답합니다. 앞뒤에 다른 글이나 코드 표시를 쓰지 않습니다.
{"scents":[{"name":"향기 이름","reason":"이 향기가 어울리는 까닭","smell_question":"맡으면서 생각해 볼 질문"}],"questions":["질문","질문","질문"]}
- scents: 사용자 메시지의 향기 세 가지를 같은 순서로 하나씩 씁니다. name 은 글자 하나 바꾸지 않고 그대로 씁니다. 다른 향기를 고르거나 더하지 않습니다.
- reason: 그 향기가 어느 카드의 어떤 마음과 어울리는지 한 문장. 40자 안팎, 60자를 넘기지 않습니다. 향기가 병을 낫게 하거나 기분을 바꿔 준다고 장담하지 않습니다.
- smell_question: 향기를 맡으며 떠올려 볼 짧은 질문. 20자 안팎, 25자를 넘기지 않습니다. (예: 어떤 장소가 떠오르나요?)
- questions: 학생이 이 세 카드에 대해 AI에게 물어볼 만한 짧은 질문 세 개. 학생 말투(해요체)로, 20자 안팎, 25자를 넘기지 않습니다. (예: 친구에게 먼저 말 걸어도 될까요?)

[그 밖에 지킬 것]
${RULES}`;

function buildExtrasUser(ctx,scents){
  const list=(scents||[]).map((s,i)=>{
    const d=s.from!=null&&ctx.cards&&ctx.cards[s.from];
    return `${i+1}. ${s.name} — ${s.desc||C.MOOD_DESC[s.mood]||""}${d?` (${C.roles[s.from]} 자리의 ${d.ko} 카드에서 이어짐)`:""}`;
  }).join("\n");
  return `${studentBlock(ctx)}

[앱이 고른 향기 세 가지 — 이름을 바꾸지 말고 그대로 쓰세요]
${list}

약속한 모양의 JSON 하나만 답해 주세요.`;
}

/* 글 속의 { … } 덩어리를 앞에서부터 하나씩 꺼내(괄호 짝을 세고, 따옴표 안의 괄호는 세지 않음) JSON 으로 읽어 봄.
   scents 나 questions 목록이 있는 첫 덩어리를 돌려줌 — 앞뒤에 '{예시}' 같은 다른 괄호 글이 섞여도 괜찮게 */
function firstJson(s){
  for(let a=s.indexOf("{");a>=0;a=s.indexOf("{",a+1)){
    let depth=0,str=false,esc=false;
    for(let i=a;i<s.length;i++){
      const c=s[i];
      if(str){if(esc)esc=false;else if(c==="\\")esc=true;else if(c==='"')str=false;continue}
      if(c==='"')str=true;
      else if(c==="{")depth++;
      else if(c==="}"&&--depth===0){
        try{const j=JSON.parse(s.slice(a,i+1));if(j&&typeof j==="object"&&(Array.isArray(j.scents)||Array.isArray(j.questions)))return j}catch(e){}
        break;
      }
    }
  }
  return null;
}
/* 정리 답 → {scents:{향기 이름:{reason?, ask?}}, questions:[…]}.
   글 속의 JSON 덩어리(firstJson)를 읽고, 칸마다 확인해 틀린 것은 버림(길이·위험한 말·단정하는 말).
   향기 이름은 앱이 고른 이름(names)과 글자 하나까지 같아야 받아요 */
function parseExtras(text,names){
  const out={scents:{},questions:[]};
  const j=firstJson(String(text||""));
  if(!j)return out;
  const fine=(t,max)=>typeof t==="string"&&(t=t.trim()).length>=2&&t.length<=max&&!/[\n<>]/.test(t)
    &&!S.check(t)&&!S.hasMarker(t)&&!FORBIDDEN.test(t);
  (Array.isArray(j.scents)?j.scents:[]).forEach(x=>{
    if(!x||typeof x!=="object"||!(names||[]).includes(x.name)||out.scents[x.name])return;
    const e={};
    if(fine(x.reason,60))e.reason=x.reason.trim();
    if(fine(x.smell_question,25))e.ask=x.smell_question.trim();
    if(e.reason||e.ask)out.scents[x.name]=e;
  });
  (Array.isArray(j.questions)?j.questions:[]).forEach(q=>{
    if(out.questions.length<3&&fine(q,25)&&!out.questions.includes(q.trim()))out.questions.push(q.trim());
  });
  return out;
}

/* 학생 1명이 AI를 쓰면 드는 대략의 토큰 수(AI 리딩 + 정리 + 질문 3개) — 설정의 모델 버튼에 '학생 1명 약 ○원'으로 나와요.
   한글은 글자 1개를 토큰 1개로 넉넉히 세고, 답 길이는 보통 쓰는 만큼(OUT_EST)으로 어림합니다. 캐싱 할인은 빼고 셉니다 */
const OUT_EST={reading:800,extras:350,qa:300};
function studentTokens(){
  const n=s=>String(s).length;
  const ctx={topic:C.topics[0][0],color:C.colors[0][0],cards:C.deckPool().slice(0,3).map(c=>({ko:c.ko,rev:false}))};
  const scents=C.DEFAULT_SCENTS.slice(0,3).map((s,i)=>({...s,from:i}));
  let input=n(READING_SYSTEM)+n(buildReadingUser(ctx))+n(EXTRAS_SYSTEM)+n(buildExtrasUser(ctx,scents));
  let output=OUT_EST.reading+OUT_EST.extras;
  const reading="가".repeat(OUT_EST.reading);
  for(let k=0;k<ASK_LIMIT;k++){
    input+=n(QA_SYSTEM)+n(firstTurn({...ctx,reading},"이 카드는 무슨 뜻이에요?"))+k*(30+OUT_EST.qa);
    output+=OUT_EST.qa;
  }
  return {input,output};
}

const Prompts={ASK_LIMIT,HISTORY_MAX,QA_MAX_TOKENS,SAFETY_BLOCK,QA_SYSTEM,firstTurn,buildMessages,
  READING_MAX_TOKENS,EXTRAS_MAX_TOKENS,READING_TITLES,READING_SYSTEM,buildReadingUser,FORBIDDEN,badReading,parseReading,readingOk,
  EXTRAS_SYSTEM,buildExtrasUser,parseExtras,studentTokens};
if(node)module.exports=Prompts;
if(typeof window!=="undefined")window.Prompts=Prompts;
})();
