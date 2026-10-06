/* safety.js 점검: 위험한 말은 반드시 잡고, 수업에서 흔한 말은 잡지 않아야 함 */
const test=require("node:test");
const assert=require("node:assert/strict");
const S=require("../safety.js");

// [문장, 종류] — 반드시 도움 안내가 떠야 하는 말 (띄어쓰기·오타·문장부호 변형 포함)
const MUST_FIRE=[
  ["죽고 싶어요","self_harm"],
  ["죽 고 싶 어","self_harm"],
  ["죽고싶다","self_harm"],
  ["요즘 그냥 죽고싶다...","self_harm"],
  ["죽고 십어요","self_harm"],
  ["죽고시퍼","self_harm"],
  ["죽고싶어어어어","self_harm"],
  ["죽고​싶어","self_harm"],
  ["죽고-싶-어!!","self_harm"],
  ["죽고 싶어".normalize("NFD"),"self_harm"],
  ["친구가 죽고 싶대요","self_harm"],
  ["자살하고 싶어","self_harm"],
  ["자 살 생각을 해요","self_harm"],
  ["자해를 했어요","self_harm"],
  ["살기 싫어","self_harm"],
  ["살고 싶지 않아요","self_harm"],
  ["사라지고 싶어요","self_harm"],
  ["그냥 없어지고 싶다","self_harm"],
  ["옥상에서 뛰어내리고 싶어","self_harm"],
  ["탑에서 뛰어내리고 싶어","self_harm"],
  ["목을 매고 싶어","self_harm"],
  ["손목 긋고 싶어","self_harm"],
  ["다 죽어버리고 싶어","self_harm"],
  ["나 같은 건 없어져야 해","self_harm"],
  ["내가 사라지면 다들 좋아하겠지","self_harm"],
  ["아빠가 때려요","abuse"],
  ["엄마가 저를 매일 때려요","abuse"],
  ["아빠한테 맞았어요","abuse"],
  ["아빠한테 대답 안 했다고 맞았어","abuse"],
  ["새엄마가 때렸어","abuse"],
  ["삼촌이 술 마시면 때려요","abuse"],
  ["선생님이 때려요","abuse"],
  ["형이 자꾸 때려","abuse"],
  ["우리 형이 때렸어요","abuse"],
  ["학대 당하는 것 같아요","abuse"],
  ["아 빠 가 때 려 요","abuse"],
  ["삼촌이 몸을 만져요","sexual"],
  ["어른이 자꾸 만져요","sexual"],
  ["성추행 당했어요","sexual"],
  ["성 폭력","sexual"],
  ["반에서 왕따 당해요","bullying"],
  ["애들이 따돌림 시켜요","bullying"],
  ["친구들이 괴롭혀요","bullying"],
  ["괴 롭 힘","bullying"],
  ["학폭 당하고 있어요","bullying"],
  ["반 애들이 단톡방에서 욕해요","bullying"],
  ["걔가 협박했어요","danger"],
  ["죽여버리고 싶어","danger"],
  ["걔 죽일 거야","danger"]
];

// 잡으면 안 되는 말 (과장 표현, 카드 이야기, 위험한 말과 글자만 겹치는 말)
const MUST_NOT_FIRE=[
  "배고파 죽겠어","웃겨 죽겠어","졸려 죽겠어요",
  "정답 맞았어요","맞아요","맞아 그런 것 같아","엄마 말이 맞아요","선생님이 정답 맞았다고 했어요",
  "친구가 정답을 맞혔어요","카드가 계속 맞아요","또 맞았어요!",
  "때려치우고 싶어",
  "죽음 카드가 나왔어요","죽음 카드 무서워","죽음 카드는 정말 죽는다는 뜻이에요?",
  "탑 카드는 무슨 뜻이에요?","탑 카드에서 사람이 뛰어내려요","매달린 사람 카드는 무슨 뜻이에요?","절제 카드가 좋아요","역방향은 나쁜 건가요?",
  "공부하기 싫어","학교 가기 싫어","친구랑 싸웠어","엄마한테 혼났어","마음이 괴로워요",
  "과자 살 거예요","피자 살래?","수학 대회에 나가요","숫자 해석이 어려워요","과목 매일 공부해요",
  "선물 주고 싶어요","숙제가 사라지면 좋겠어요","모형을 만져 봤어요","강아지 몸을 만졌어요","엄마가 머리를 만져 줬어요",
  "형광펜으로 표시했어요","친구랑 게임에서 몬스터를 때렸어",
  "학교폭력 예방 교육을 받았어요","자살 예방 교육을 들었어요",
  "",null,undefined
];

test(`must fire: ${MUST_FIRE.length} risky phrasings are caught with the right category`,()=>{
  assert.ok(MUST_FIRE.length>=25);
  for(const [t,cat] of MUST_FIRE){
    const r=S.check(t);
    assert.ok(r,`not caught: ${JSON.stringify(t)}`);
    assert.equal(r.cat,cat,`${JSON.stringify(t)} → ${r.cat}, expected ${cat}`);
  }
});

test(`must not fire: ${MUST_NOT_FIRE.length} everyday / tarot phrases stay quiet`,()=>{
  assert.ok(MUST_NOT_FIRE.length>=15);
  for(const t of MUST_NOT_FIRE)assert.equal(S.check(t),null,`false alarm: ${JSON.stringify(t)} (normalized ${S.normalize(t)})`);
});

test("normalize strips spaces, punctuation, zero-width chars and collapses long repeats",()=>{
  assert.equal(S.normalize(" 죽 고.싶-어​!! "),"죽고싶어");
  assert.equal(S.normalize("싫어어어어 ㅠㅠㅠㅠ"),"싫어ㅠ");
  assert.equal(S.normalize("ABC"),"abc");
  assert.equal(S.normalize("싶".normalize("NFD")),"싶");
});

test("rules use no lookbehind (older iPad Safari cannot parse it)",()=>{
  const src=require("fs").readFileSync(require("path").join(__dirname,"..","safety.js"),"utf8");
  assert.ok(!/\(\?<[=!]/.test(src),"safety.js must not use (?<= or (?<!");
});

test("redact hides phone numbers, emails and long digit runs but keeps hotline numbers",()=>{
  assert.equal(S.redact("내 번호 010-1234-5678"),"내 번호 [전화번호]");
  assert.equal(S.redact("01012345678로 연락해"),"[전화번호]로 연락해");
  assert.equal(S.redact("집 02 123 4567"),"집 [전화번호]");
  assert.equal(S.redact("메일 kid.a@school.kr 이에요"),"메일 [이메일] 이에요");
  assert.equal(S.redact("학번 20231234"),"학번 [숫자]");
  assert.equal(S.redact("1388 에 전화해도 돼요? 3학년 2반"),"1388 에 전화해도 돼요? 3학년 2반");
});

test("help text lists exactly the four numbers and the marker is detected",()=>{
  for(const n of ["1388","109","117","112"])assert.ok(S.HELP_TEXT.includes(n),n);
  assert.ok(!S.HELP_TEXT.includes("1393"),"old suicide line 1393 must not appear");
  assert.ok(S.HELP_TEXT.includes("선생님"));
  assert.equal(S.MARKER,"[도움필요]");
  assert.ok(S.hasMarker("[도움필요] 말해 줘서 고마워요"));
  assert.ok(S.hasMarker("[ 도움 필요 ] …"));
  assert.ok(!S.hasMarker("도움이 필요하면 말해요"));
});
