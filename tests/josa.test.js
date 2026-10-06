/* 조사(이/가 · 은/는 · 이라는/라는 …)가 받침에 맞게 붙는지 — 카드 42장 · 주제 6개 · 감정 색 9개 모두 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const C=require("../content.js");
const R=require("../reading.js");

const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
// 받침 있는 카드 이름(숫자는 한자어로 읽음: 컵 3 삼, 컵 6 육, 컵 7 칠, 컵 8 팔, 컵 10 십, 검 6 육)
const JONG_CARDS=["연인","힘","매달린 사람","죽음","탑","별","달","태양","심판","교황","닻","정원",
  "검 6","컵 3","컵 6","컵 7","컵 8","컵 10","컵 퀸","컵 킹"];
const NO_JONG_TOPICS=["친구 관계"];
const NO_JONG_COLORS=["보라"];
const PAIRS=[["이","가"],["은","는"],["을","를"],["과","와"],["이라는","라는"],["이에요","예요"]];

function expectAll(name,jong){
  assert.equal(R.hasJong(name),jong,name+" 받침");
  for(const [a,b] of PAIRS)assert.equal(R.josa(name,a,b),name+(jong?a:b),`${name} + ${a}/${b}`);
}

test("all 42 card names take the right particles",()=>{
  assert.equal(C.cards.length,42);
  for(const n of JONG_CARDS)assert.ok(C.cards.some(c=>c.ko===n),"unknown card in list: "+n);
  for(const c of C.cards)expectAll(c.ko,JONG_CARDS.includes(c.ko));
  assert.equal(R.josa("탑","이","가"),"탑이");
  assert.equal(R.josa("교황","은","는"),"교황은");
  assert.equal(R.josa("컵 8","이","가"),"컵 8이");
  assert.equal(R.josa("컵 2","이","가"),"컵 2가");
  assert.equal(R.josa("바보","은","는"),"바보는");
});

test("all 6 topics take the right particles (친구 관계라는, 가족이라는)",()=>{
  assert.equal(C.topics.length,6);
  for(const [t] of C.topics)expectAll(t,!NO_JONG_TOPICS.includes(t));
  assert.equal(R.josa("친구 관계","이라는","라는"),"친구 관계라는");
  assert.equal(R.josa("가족","이라는","라는"),"가족이라는");
});

test("all 9 colors take the right particles (no '회색 색')",()=>{
  assert.equal(C.colors.length,9);
  for(const [c] of C.colors)expectAll(c,!NO_JONG_COLORS.includes(c));
  for(const [c] of C.colors){
    const draw=C.deckPool().slice(0,3).map(x=>({...x,rev:false}));
    const html=R.make({color:c,topic:"나 자신",draw,hasNote:false});
    assert.ok(html.includes(`처음에 고른 ${R.josa(c,"이","가")} 말해 주는`),c);
    assert.ok(!/색 색/.test(html),c+": '색 색'");
  }
});

test("digits, closing quotes and punctuation",()=>{
  for(const [n,j] of [["0",1],["1",1],["2",0],["3",1],["4",0],["5",0],["6",1],["7",1],["8",1],["9",0],["10",1]])
    assert.equal(R.hasJong("컵 "+n),!!j,"컵 "+n);
  assert.equal(R.josa("‘새로운 시작’","을","를"),"‘새로운 시작’을");
  assert.equal(R.josa("‘친구 관계’","이라는","라는"),"‘친구 관계’라는");
  assert.equal(R.josa("‘가능성’, ‘가벼운 용기’","이라는","라는"),"‘가능성’, ‘가벼운 용기’라는");
  assert.equal(R.hasJong(""),false);
});

test("ordinals read 첫/두/세 번째",()=>{
  assert.deepEqual([0,1,2].map(R.nth),["첫 번째","두 번째","세 번째"]);
  const html=read("index.html");
  assert.ok(!/\$\{slotIndex\+1\}번째/.test(html),"index.html still writes '1번째 카드'");
  assert.ok(html.includes("Reading.nth(slotIndex)"));
});

test("no fixed particle glued to a ${…} name in the app or reading code",()=>{
  // 예: `${b.ko}가`, `${c.ko}는`, `${state.topic}이라는` — 받침에 따라 틀리므로 josa() 를 써야 함
  const glued=/\$\{[^}]*\}(이라는|라는|이에요|예요|이|가|은|는|을|를|과|와)(?=[\s.,!?<'"`’]|$)/m;
  for(const f of ["index.html","reading.js"]){
    const m=read(f).match(glued);
    assert.ok(!m,`${f}: fixed particle after a template value: ${m&&m[0]}`);
  }
});
