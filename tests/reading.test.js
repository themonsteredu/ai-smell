/* reading.js 점검 — 5,000번 뽑아 보며: 숨긴 카드가 안 나오는지, 요약 문장이 모두 나올 수 있는지,
   조사가 받침에 맞는지, undefined·NaN 같은 글자가 섞이지 않는지, 향기가 세 카드에서 고루 오는지, 준비된 답변이 질문마다 다른지 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const C=require("../content.js");
const R=require("../reading.js");

const N=5000;
const HIDDEN=new Set(C.cards.filter(c=>c.hidden).map(c=>c.ko));
const card=(ko,rev=false)=>({...C.cards.find(c=>c.ko===ko),rev});
const any=a=>a[Math.floor(Math.random()*a.length)];
const strip=h=>h.replace(/<[^>]+>/g," ");
const QUESTIONS=["이 카드는 무슨 뜻이에요?","왜 이 카드가 나왔어요?","역방향은 나쁜 건가요?","오늘 해 볼 작은 행동은?",
  "죽음 카드 무서워요","추천 향기는 왜 이거예요?","숨은 마음이 뭐예요?","친구랑 화해할 수 있을까요?","시험이 걱정돼요","음…","ㅋㅋ"];

/* 이름 바로 뒤의 조사가 받침과 맞는지 찾아봄. 이름 = 보이는 카드 · 주제 · 색 · 기본 향기 */
const TOKENS=[...C.deckPool().map(c=>c.ko),...C.topics.map(t=>t[0]),...C.colors.map(c=>c[0]),...C.DEFAULT_SCENTS.map(s=>s.name)];
const PAIRS=[["이라는","라는"],["이에요","예요"],["이","가"],["은","는"],["을","를"],["과","와"]];
function particleErrors(text){
  const bad=[];
  for(const tok of TOKENS){
    for(let i=text.indexOf(tok);i>=0;i=text.indexOf(tok,i+1)){
      if(i>0&&/[가-힣0-9]/.test(text[i-1]))continue;              // 다른 낱말의 일부
      const rest=text.slice(i+tok.length).replace(/^[’”'"]/,"");
      if(/^[0-9]/.test(rest))continue;                              // '컵 1' 이 아니라 '컵 10'
      const jong=R.hasJong(tok);
      for(const [a,b] of PAIRS){
        const wrong=jong?b:a;
        if(rest.startsWith(wrong)&&!/^[가-힣]/.test(rest.slice(wrong.length)))bad.push(text.slice(Math.max(0,i-8),i+tok.length+6));
      }
    }
  }
  return bad;
}
function cleanText(t,where){
  assert.ok(typeof t==="string"&&t.trim(),where+": empty");
  assert.ok(!/undefined|NaN|\[object|null/.test(t),where+": "+t);
  assert.deepEqual(particleErrors(t),[],where);
  for(const h of HIDDEN)assert.ok(!new RegExp(`(^|[^가-힣])${h}( 카드| 정방향| 역방향|[은는이가을를과와]\\s)`).test(t),where+": names hidden card "+h);
}

/* 실제 앱과 같은 길로 한 판 뽑기: 덱 만들기 → 부채꼴에서 아무 자리나 세 번 */
function deal(){
  const deck=R.makeDeck(),draw=[];
  while(draw.length<3){
    const i=Math.floor(Math.random()*deck.length);
    if(draw.some(d=>d.ko===deck[i].ko))continue;   // 앱에서는 이미 뽑은 카드가 숨겨져 다시 못 누름
    draw.push(R.drawOne(deck,i,draw));
  }
  return {deck,draw};
}

test(`${N} random draws: no hidden card, every summary reachable, clean text, correct particles`,()=>{
  const flows=new Map(Object.values(R.FLOW).map(t=>[t,0]));
  const from=[0,0,0];let notLiteral=0,rev=0;
  for(let k=0;k<N;k++){
    const {deck,draw}=deal();
    assert.equal(deck.length,Math.min(R.FAN_MAX,C.deckPool().length));
    assert.equal(new Set(deck.map(c=>c.ko)).size,deck.length,"deck has duplicates");
    assert.ok(deck.every(c=>!c.hidden),"hidden card in the deck");
    assert.ok(draw.every(c=>!c.hidden&&typeof c.rev==="boolean"),"hidden card drawn");
    assert.equal(new Set(draw.map(c=>c.ko)).size,3,"duplicate card drawn");
    rev+=draw.filter(c=>c.rev).length;

    const topic=any(C.topics)[0],color=Math.random()<.9?any(C.colors)[0]:null,hasNote=Math.random()<.5;
    const html=R.make({color,topic,draw,hasNote});
    const text=strip(html);
    cleanText(text,"reading");
    assert.equal((html.match(/<p>/g)||[]).length,color?5:4,"paragraph count");
    assert.ok(text.includes(`‘${topic}’${R.hasJong(topic)?"이라는":"라는"} 주제`),"topic phrase: "+topic);
    if(!R.hasJong(topic))assert.ok(!text.includes(topic+"’이라는")&&!text.includes(topic+"이라는"),"이라는 after a vowel-final topic");
    for(const d of draw)if(d.notLiteral){assert.ok(text.includes(d.notLiteral),d.ko+": not-literal note missing");notLiteral++}
    const flow=[...flows.keys()].find(t=>text.includes(t));
    assert.ok(flow,"no summary sentence");flows.set(flow,flows.get(flow)+1);
    assert.equal(R.combine(...draw),flow);

    const scents=R.pickScents(draw,C.DEFAULT_SCENTS);
    assert.equal(scents.length,3);
    assert.equal(new Set(scents.map(s=>s.name)).size,3,"duplicate scent");
    for(const s of scents){
      assert.ok(s.from===null||[0,1,2].includes(s.from),"bad from "+s.from);
      if(s.from!==null){
        const moods=draw[s.from].scent.map(n=>C.SCENT_MOOD[n]);
        assert.ok(moods.includes(s.mood),`${s.name} is not linked to ${draw[s.from].ko}`);
        from[s.from]++;
      }
    }

    const q=any(QUESTIONS),n=Math.floor(Math.random()*4);
    cleanText(R.localAnswer(q,n,{draw,topic,scents}),"answer to "+q);
  }
  for(const [t,c] of flows)assert.ok(c>0,"summary never reached: "+t);
  for(const [t,c] of flows)assert.ok(c<N*.6,`one summary dominates (${c}/${N}): ${t}`);
  // 세 카드가 향기를 고루 정함(예전에는 3번 카드가 3%뿐이었음)
  for(let i=0;i<3;i++)assert.ok(from[i]>N*.6,`card ${i+1} decides a scent in only ${from[i]}/${N} draws`);
  assert.ok(notLiteral>0,"죽음/탑 never drawn");
  assert.ok(rev/(N*3)>.2&&rev/(N*3)<.36,"reversed rate "+rev/(N*3));
});

test("drawOne never returns a hidden or already-drawn card, even when the deck slot repeats",()=>{
  for(let k=0;k<2000;k++){
    const deck=R.makeDeck(),draw=[R.drawOne(deck,0,[])];
    const again=R.drawOne(deck,0,draw);   // 같은 자리를 또 누른 것처럼
    assert.ok(!again.hidden&&again.ko!==draw[0].ko);
    assert.ok(!R.drawOne([C.cards.find(c=>c.hidden)],0,[]).hidden,"must not trust a hidden deck entry");
  }
});

test("heavy() follows each card's meaning, not just its orientation",()=>{
  // 역방향인데 뜻이 가벼운 카드 두 장 → '엉켜 있다'는 요약이 나오면 안 됨
  assert.notEqual(R.combine(card("달",true),card("십자가",true),card("컵 2")),R.FLOW.knot);
  assert.notEqual(R.combine(card("컵 4",true),card("컵 5",true),card("컵 7",true)),R.FLOW.knot);
  // 정방향인데 무거운 카드 두 장 → '엉켜 있다'
  assert.equal(R.combine(card("컵 5"),card("달"),card("바보")),R.FLOW.knot);
  // 뜻을 부드럽게 고친 탑(갑자기 깨닫기)·컵 8(떠남)은 정방향이면 무거운 카드로 세지 않음
  assert.ok(!R.heavy(card("탑"))&&!R.heavy(card("컵 8")));
  assert.equal(R.combine(card("탑"),card("컵 8"),card("바보")),R.FLOW.light);
  // 마지막 카드가 거꾸로 나온 밝은 카드면 '밝은 쪽'이라 하지 않음
  assert.equal(R.combine(card("컵 3"),card("컵 2"),card("컵 9")),R.FLOW.bright);
  assert.notEqual(R.combine(card("컵 3"),card("컵 2"),card("컵 9",true)),R.FLOW.bright);
  assert.equal(R.combine(card("바보",true),card("컵 2"),card("정원")),R.FLOW.turn);
  assert.equal(R.combine(card("바보"),card("컵 2",true),card("정원")),R.FLOW.mixed);
  assert.equal(R.combine(card("바보"),card("컵 2"),card("정원")),R.FLOW.light);
  // 밝은 마무리 카드 가운데 덱에 실제로 들어 있는 카드가 있어야 그 요약이 나올 수 있음
  assert.ok(C.deckPool().some(c=>c.bright),"no visible bright card");
  for(const c of C.cards){
    for(const f of ["heavyUp","lightDown","bright","hidden"])assert.ok(c[f]===undefined||c[f]===true,`${c.ko}.${f}`);
    if(c.notLiteral!==undefined)assert.ok(typeof c.notLiteral==="string"&&c.notLiteral.includes("뜻이 아니에요"),c.ko);
  }
  for(const ko of ["죽음","탑"])assert.ok(card(ko).notLiteral,ko+" needs a not-literal note");
});

test("reading is 해요체, never echoes the note, and the reading code never sees the note text",()=>{
  const draw=[card("바보"),card("죽음",true),card("컵 10")];
  const a=strip(R.make({color:"빨강",topic:"가족",draw,hasNote:true}));
  const b=strip(R.make({color:"빨강",topic:"가족",draw,hasNote:false}));
  assert.ok(a.includes("적어 둔 한 줄")&&!b.includes("적어 둔 한 줄"));
  for(const t of [a,b])assert.ok(!/니다[.!? ]|습니다/.test(t),"합니다체 in the reading: "+t);
  const src=fs.readFileSync(path.join(__dirname,"..","reading.js"),"utf8");
  assert.ok(!/\bnote\b/i.test(src)&&!/state\./.test(src),"reading.js must only get hasNote, never the note or global state");
});

test("local answers depend on the question and rotate, and use the drawn cards",()=>{
  const draw=[card("죽음"),card("컵 8",true),card("열쇠")];
  const s={draw,topic:"친구 관계",scents:R.pickScents(draw,C.DEFAULT_SCENTS)};
  const answers=QUESTIONS.map((q,i)=>R.localAnswer(q,0,s));
  assert.ok(new Set(answers).size>=8,"too many identical answers: "+new Set(answers).size);
  const same=[0,1,2].map(n=>R.localAnswer("이 카드는 무슨 뜻이에요?",n,s));
  assert.equal(new Set(same).size,3,"same question should rotate");
  assert.ok(R.localAnswer("역방향은 나쁜 건가요?",0,s).includes("컵 8"),"reversed answer names the reversed card");
  const lit=ko=>card(ko).notLiteral.replace(/^이 카드는 /,"");
  assert.ok(R.localAnswer("죽음 카드 무서워요",0,s).startsWith("죽음 카드는 "+lit("죽음")),"scary answer names the card and uses its not-literal note");
  // 물어본 카드의 안심 문장 — 죽음이 먼저 뽑혀 있어도 탑을 물으면 탑
  const scary={draw:[card("죽음"),card("탑"),card("교황")],topic:"가족",scents:[]};
  for(const q of ["탑 카드 무서워요","탑이 무서워요"])assert.ok(R.localAnswer(q,0,scary).startsWith("탑 카드는 "+lit("탑")),q);
  // 그림 이야기의 '나라면?' 질문(이걸 물어볼래요)은 그 카드를 두고 답함 — 거꾸로·방법 같은 낱말이 있어도
  for(const d of [card("매달린 사람"),card("죽음",true),card("교황")]){
    const st={draw:[d,card("컵 2"),card("열쇠")],topic:"가족",scents:[]};
    for(const q of [d.ask,d.ko+" 카드: "+d.ask]){
      const a=R.localAnswer(q,0,st);
      assert.ok(a.startsWith(d.ko+" 카드 그림")&&a.includes(d.ask),q+" → "+a);
    }
  }
  // 앞일을 묻는 질문에는 카드가 미래를 맞히지 않는다고 답함
  for(const q of ["시험 잘 볼 수 있을까요?","내일 좋은 일 생길까요?","내일 비 와요?"])assert.ok(R.localAnswer(q,0,s).startsWith("카드는 앞일을 맞히지 않아요"),q);
  // 내 이야기(가족·친구)에는 먼저 고맙다고 하고, 다른 주제의 한 줄을 붙이지 않음
  const mine=R.localAnswer("엄마한테 혼났어요",0,s);
  assert.ok(mine.startsWith("이야기해 줘서 고마워요")&&!mine.includes(C.TOPIC_HOOK["친구 관계"]),mine);
  assert.ok(R.localAnswer("열쇠 카드는 무슨 뜻이에요?",0,s).startsWith("열쇠 카드는"),"a named card is answered first");
  assert.ok(R.localAnswer("향기는요?",0,s).includes(s.scents[0].name),"scent answer names the scents");
  const up={draw:[card("바보"),card("컵 2"),card("정원")],topic:"가족",scents:[]};
  assert.ok(R.localAnswer("거꾸로 나오면 어때요?",0,up).includes("세 장 모두 똑바로"),"no reversed card case");
  for(const q of QUESTIONS)assert.ok(!/니다[.!? ]|습니다/.test(R.localAnswer(q,1,s)),"합니다체: "+q);
});

test("pickScents works with a short teacher list and with moods no card uses",()=>{
  const draw=[card("바보"),card("컵 2"),card("닻")];
  const two=[{name:"A",mood:"calm",desc:""},{name:"B",mood:"calm",desc:""}];
  const r=R.pickScents(draw,two);
  assert.equal(r.length,2);assert.equal(new Set(r.map(x=>x.name)).size,2);
  const odd=[{name:"X",mood:"balance",desc:""},{name:"Y",mood:"balance",desc:""},{name:"Z",mood:"balance",desc:""}];
  // 카드의 향기 결과 맞는 향기만 그 카드 자리(from)를 받고, 맞는 카드가 없으면 from:null
  const moods=c=>c.scent.map(n=>C.SCENT_MOOD[n]);
  const o=R.pickScents([card("바보"),card("바보"),card("바보")],odd);
  assert.equal(o.length,3);assert.ok(o.every(x=>x.from===null),"바보 has no balance scent, so nothing is linked to it");
  const mixed=[...odd,{name:"L",mood:"bright",desc:""},{name:"C",mood:"calm",desc:""}];
  for(let k=0;k<300;k++){
    const deck=R.makeDeck(),d3=[];for(let i=0;i<3;i++)d3.push(R.drawOne(deck,i,d3));
    for(const lib of [mixed,C.DEFAULT_SCENTS])for(const x of R.pickScents(d3,lib))
      assert.ok(x.from===null||moods(d3[x.from]).includes(x.mood),`${x.name}(${x.mood}) linked to ${d3[x.from]&&d3[x.from].ko}`);
  }
  const m=R.pickScents([card("바보"),card("컵 2"),card("닻")],mixed);
  assert.ok(m.some(x=>x.name==="L"&&x.from===0),"레몬 결(bright) of 바보 links the bright scent to slot 0");
});

test("makeDeck(n): smaller phone fan, never more than FAN_MAX or the visible pool, never a hidden card",()=>{
  for(let k=0;k<500;k++){
    const d=R.makeDeck(15);
    assert.equal(d.length,Math.min(15,C.deckPool().length));
    assert.equal(new Set(d.map(c=>c.ko)).size,d.length,"duplicates in a phone deck");
    assert.ok(d.every(c=>!c.hidden),"hidden card in a phone deck");
  }
  assert.equal(R.makeDeck(999).length,Math.min(R.FAN_MAX,C.deckPool().length));
  assert.equal(R.makeDeck().length,Math.min(R.FAN_MAX,C.deckPool().length));
  // 휴대폰 부채꼴에서 뽑아도 숨긴 카드가 나오지 않음(drawOne 의 대체 카드 포함)
  const d=R.makeDeck(15),draw=[];
  for(let i=0;i<3;i++)draw.push(R.drawOne(d,i,draw));
  assert.ok(draw.every(c=>!c.hidden));
});

test("local answers: sad family news is not tied to a card, and 죽음·탑 are never the default mirror",()=>{
  const lit=card("죽음").notLiteral;
  for(const draw of [[card("죽음"),card("컵 4",true),card("탑")],[card("바보"),card("힘"),card("죽음")]]){
    const s={draw,topic:"가족",scents:[]};
    for(const q of ["엄마가 많이 아파요","아빠가 병원에 입원했어요","엄마 아빠가 맨날 싸워요","부모님이 이혼했어요","엄마랑 아빠가 이혼할까요?","할머니가 돌아가셨어요"]){
      const a=R.localAnswer(q,0,s);
      assert.ok(a.includes("믿을 수 있는 어른")&&!/죽음|탑|컵 4|바보|힘/.test(a),q+" → "+a);
      assert.ok(a.endsWith("이야기해 볼까요?"),"no extra closing line after the sad-news answer: "+a);
    }
    // 카드 이름을 묻지 않은 질문은 죽음·탑이 아닌 카드로 답함
    for(const q of ["할머니가 나중에 어떻게 될까요?","친구랑 싸웠어요","이 카드는 무슨 뜻이에요?","어떻게 하면 될까요?","왜 이 카드가 나왔어요?"])
      for(let n=0;n<3;n++){const a=R.localAnswer(q,n,s);assert.ok(!/죽음 카드|탑 카드/.test(a)&&!a.includes(lit),q+" → "+a)}
  }
  // 하나만 빼고 모두 죽음·탑이어도, 물어본 카드가 죽음이면 안심 문장을 붙임
  const named=R.localAnswer("죽음 카드는 왜 나왔어요?",0,{draw:[card("죽음"),card("탑"),card("바보")],topic:"가족",scents:[]});
  assert.ok(named.startsWith("죽음 카드는 "+lit.replace(/^이 카드는 /,"")),named);
  const how=R.localAnswer("탑 카드를 보고 어떻게 하면 될까요?",0,{draw:[card("바보"),card("컵 2"),card("탑")],topic:"가족",scents:[]});
  assert.ok(how.includes("탑 카드는")&&how.includes(card("탑").notLiteral),how);
});

test("local answers: '향' inside 영향·정방향·방향·향상 is not a scent question; a named scent is described",()=>{
  const draw=[card("절제"),card("컵 6"),card("컵 8")];
  const scents=C.DEFAULT_SCENTS.filter(x=>["레몬","라벤더","편백"].includes(x.name));
  const s={draw,topic:"가족",scents};
  for(const q of ["보이지 않는 영향은 뭐예요?","두 번째 카드의 영향이 뭐예요?","정방향은 무슨 뜻이에요?","앞으로 어떤 방향으로 가면 좋을까요?","성적이 향상될까요?"])
    assert.ok(!R.localAnswer(q,0,s).startsWith("추천 향기"),q);
  assert.ok(R.localAnswer("보이지 않는 영향은 뭐예요?",0,s).startsWith("‘보이지 않는 영향’ 자리에는 컵 6 카드가"));
  for(const n of [0,1,2])assert.ok(R.localAnswer("향기는 왜 레몬이에요?",n,s).includes("레몬은 "+C.MOOD_DESC[scents.find(x=>x.name==="레몬").mood]),"names the asked scent");
  assert.ok(R.localAnswer("라벤더는 어떤 향기예요?",0,s).includes("라벤더는 "));
  assert.ok(!R.localAnswer("숨은 마음이 뭐예요?",0,s).includes("마음이 마음"),"no '마음이 마음' repetition");
});

test("local answers: card names that are everyday words only count with '카드', and a card that was not drawn is named as such",()=>{
  const s={draw:[card("바보"),card("달"),card("힘",true)],topic:"나 자신",scents:[]};
  for(const [q,w] of [["나는 바보 같아요","바보"],["친구가 저를 바보라고 놀려요","바보"],["나는 다른 애들이랑 달라요","달"],["달리기 시합에서 이길까요?","달"],["요즘 힘이 없어요","힘"]])
    for(let n=0;n<3;n++)assert.ok(!R.localAnswer(q,n,s).includes(w+" 카드"),q+" → "+R.localAnswer(q,n,s));
  assert.ok(R.localAnswer("바보 카드는 무슨 뜻이에요?",0,s).startsWith("바보 카드는 ‘새로운 시작’"));
  assert.ok(R.localAnswer("힘 카드 역방향은 나쁜 거예요?",0,s).includes("힘 카드는 거꾸로 나와서"));
  const other=R.localAnswer("힘 카드는 무슨 뜻이에요?",0,{draw:[card("죽음"),card("컵 4",true),card("탑")],topic:"가족",scents:[]});
  assert.ok(other.startsWith("힘 카드는 이번에 뽑은 카드가 아니에요. 내가 뽑은 카드는 죽음, 컵 4, 탑이에요."),other);
  for(const c of C.cards.filter(c=>c.hidden))assert.ok(!R.localAnswer(c.ko+" 카드는 무슨 뜻이에요?",0,s).includes(c.ko),"hidden card named: "+c.ko);
});

test("local answers: 'what should I do' and personal 'why' questions are routed to fitting answers",()=>{
  const s={draw:[card("바보"),card("힘"),card("절제")],topic:"공부와 도전",scents:[]};
  for(const q of ["어떻게 하면 될까요?","어떻게 해야 될까요?","뭘 해야 할까요?","앞으로 어떤 방향으로 가면 좋을까요?"]){
    const a=R.localAnswer(q,0,s);
    assert.ok(a.startsWith("‘앞으로 취할 태도’ 자리의 절제 카드는")&&!a.includes("앞일"),q+" → "+a);
  }
  for(const q of ["왜 나는 공부가 안 될까요?","왜 친구가 나를 싫어할까요?","나는 왜 이렇게 못생겼을까요"]){
    const a=R.localAnswer(q,0,s);
    assert.ok(a.startsWith("이야기해 줘서 고마워요")&&!a.includes("꼭 정해진 이유"),q+" → "+a);
  }
  assert.ok(R.localAnswer("왜 이 카드가 나왔어요?",0,s).startsWith("카드는 잘 섞은 뒤"));
  for(const q of ["시험 잘 볼 수 있을까요?","할머니가 나중에 어떻게 될까요?"])assert.ok(!R.localAnswer(q,0,s).includes("그 일을"),"future answer has no dangling referent");
});

test("a heavy meaning in the '앞으로 취할 태도' slot is never framed as advice to adopt it",()=>{
  const heavyAtt=C.ROLE_TAIL_HEAVY,plain=C.ROLE_TAIL[2];
  for(const x of [card("여사제",true),card("은둔자",true),card("컵 5")]){
    assert.ok(R.heavy(x),x.ko);
    const draw=[card("바보"),card("컵 2"),x];
    const last=strip(R.make({color:"초록",topic:"가족",draw,hasNote:false})).split("앞으로 취할 태도 — ")[1];
    assert.ok(last.includes(heavyAtt)&&!plain.some(t=>last.includes(t)),x.ko+": "+last);
    for(let n=0;n<3;n++){
      const a=R.localAnswer(x.ko+" 카드는 무슨 뜻이에요?",n,{draw,topic:"가족",scents:[]});
      assert.ok(!a.includes("앞으로 가져 볼 마음가짐"),a);
    }
  }
  // 가벼운 카드는 예전처럼 자리 문장 가운데 하나
  const light=strip(R.make({color:"초록",topic:"가족",draw:[card("바보"),card("컵 2"),card("절제")],hasNote:false})).split("앞으로 취할 태도 — ")[1];
  assert.ok(plain.some(t=>light.includes(t))&&!light.includes(heavyAtt));
});
