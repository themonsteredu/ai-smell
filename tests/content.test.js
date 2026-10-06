/* content.js (수업 내용) 점검: 그림 파일, 숨긴 카드, 향기 결, 색·주제 모양 */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const C=require("../content.js");

const ROOT=path.join(__dirname,"..");
const exists=p=>fs.existsSync(path.join(ROOT,p));
// 그림에 알몸이 있어 덱에서 뺀 카드. 새 그림으로 다시 켜면 여기서도 지웁니다(CLAUDE.md 참고).
const HIDDEN={"연인":"cards/06.jpg","악마":"cards/15.jpg","별":"cards/17.jpg","태양":"cards/19.jpg","심판":"cards/20.jpg","세계":"cards/21.jpg"};

test("every card has a unique name and an existing, unique image file",()=>{
  assert.ok(C.cards.length>=36);
  const names=new Set(),imgs=new Set();
  for(const c of C.cards){
    assert.equal(typeof c.ko,"string");assert.ok(c.ko.trim(),"empty card name");
    assert.ok(!names.has(c.ko),"duplicate card name "+c.ko);names.add(c.ko);
    assert.match(c.img,/^cards\/[\w.-]+\.(jpg|jpeg|png|webp)$/,c.ko+" img path");
    assert.ok(exists(c.img),c.ko+": missing file "+c.img);
    assert.ok(!imgs.has(c.img),"two cards share "+c.img);imgs.add(c.img);
    assert.ok(typeof c.up==="string"&&c.up.trim(),c.ko+" up");
    assert.ok(typeof c.down==="string"&&c.down.trim(),c.ko+" down");
  }
  for(const p of [C.COVER,C.BACK,C.HERO])assert.ok(exists(p),"missing "+p);
});

test("hidden cards are exactly the 6 nude-art cards",()=>{
  const hidden=C.cards.filter(c=>c.hidden);
  assert.deepEqual(Object.fromEntries(hidden.map(c=>[c.ko,c.img])),HIDDEN);
  for(const c of C.cards)assert.ok(c.hidden===undefined||c.hidden===true,c.ko+": hidden must be true or absent");
});

test("deckPool() returns only visible cards and has enough for the fan",()=>{
  const pool=C.deckPool();
  assert.ok(pool.length>=30,"visible pool too small: "+pool.length);
  assert.equal(pool.length,C.cards.length-Object.keys(HIDDEN).length);
  for(const c of pool){assert.ok(!c.hidden);assert.ok(!(c.ko in HIDDEN),c.ko)}
  assert.equal(new Set(pool.map(c=>c.ko)).size,pool.length,"pool has duplicates");
});

test("every card scent maps to a known mood",()=>{
  const moods=new Set(C.MOODS.map(m=>m[0]));
  for(const [k,label] of C.MOODS){assert.equal(typeof label,"string");assert.ok(C.MOOD_DESC[k],"MOOD_DESC missing "+k)}
  for(const [name,m] of Object.entries(C.SCENT_MOOD))assert.ok(moods.has(m),name+" → unknown mood "+m);
  for(const c of C.cards){
    assert.ok(Array.isArray(c.scent)&&c.scent.length>=1,c.ko+" scent list");
    for(const s of c.scent)assert.ok(C.SCENT_MOOD[s],c.ko+": scent '"+s+"' has no mood in SCENT_MOOD");
  }
  assert.ok(C.DEFAULT_SCENTS.length>=3);
  for(const s of C.DEFAULT_SCENTS){
    assert.ok(typeof s.name==="string"&&s.name.trim());
    assert.ok(moods.has(s.mood),s.name+" → unknown mood "+s.mood);
    assert.equal(typeof s.desc,"string");
  }
});

test("colors, topics and roles have the expected shapes",()=>{
  assert.ok(C.colors.length>=2);
  for(const c of C.colors){
    assert.equal(c.length,2);assert.ok(typeof c[0]==="string"&&c[0].trim());
    assert.match(c[1],/^#[0-9a-f]{6}$/i,c[0]+" color code");
    assert.ok(C.COLOR_MEANING[c[0]],"COLOR_MEANING missing "+c[0]);
  }
  assert.equal(new Set(C.colors.map(c=>c[0])).size,C.colors.length,"duplicate color name");
  assert.ok(C.topics.length>=2);
  for(const t of C.topics){assert.equal(t.length,2);assert.ok(t[0].trim()&&t[1].trim())}
  assert.equal(new Set(C.topics.map(t=>t[0])).size,C.topics.length,"duplicate topic");
  assert.equal(C.roles.length,3);
  assert.ok(typeof C.COVER_TITLE==="string"&&C.COVER_TITLE.trim());
});
