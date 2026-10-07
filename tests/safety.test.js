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
  ["걔 죽일 거야","danger"],
  // 2차 점검에서 놓쳤던 말 — '자살'·'자해' 뒤에 어떤 말이 와도
  ["자살 계획 세웠어","self_harm"],["자살 고민 중","self_harm"],["자살 결심했어","self_harm"],["자살 준비 중이야","self_harm"],
  ["자살 유서 썼어","self_harm"],["자살 기도","self_harm"],["나 자살 마렵다","self_harm"],["자살까지 생각했어","self_harm"],
  ["자해 계획","self_harm"],["자해 고민","self_harm"],["자해 중독","self_harm"],["자해러","self_harm"],["자해 습관","self_harm"],
  ["자해 흉터","self_harm"],["친구가 자해했어","self_harm"],
  // 줄임말·은어·돌려 말하기·영어
  ["뒤지고 싶어","self_harm"],["뒤지고싶다","self_harm"],["뒤지고 싶다 ㅋㅋ","self_harm"],["디지고 싶어","self_harm"],["뒤져버리고 싶어","self_harm"],
  ["죽는 게 나을 것 같아","self_harm"],["살고 싶지가 않아","self_harm"],["그만 살고 싶어","self_harm"],["나 없어졌으면 좋겠어","self_harm"],
  ["살아갈 이유가 없어","self_harm"],["약 먹고 죽을래","self_harm"],["투신하고 싶어","self_harm"],["옥상에서 떨어지고 싶어","self_harm"],
  ["커터칼로 팔을 그었어","self_harm"],["팔 그었어","self_harm"],["칼로 손목","self_harm"],["이 세상에서 살기 싫어","self_harm"],
  ["I want to die","self_harm"],["i wanna die","self_harm"],["kill myself","self_harm"],["kms 하고싶다","self_harm"],
  ["suicide 생각","self_harm"],["self harm 했어","self_harm"],
  // 누가 몸을 만짐 — 사이에 다른 말이 끼어도
  ["선생님이 만져요","sexual"],["선생님이 자꾸 만져요","sexual"],["학원 선생님이 자꾸 만져요","sexual"],["담임 선생님이 만졌어요","sexual"],
  ["선생님께서 만지셔요","sexual"],["삼촌이 이상한 곳을 만져요","sexual"],["삼촌이 이상한 데 만져","sexual"],["아빠가 자꾸 내 다리를 만져","sexual"],
  ["아빠가 씻겨 준다면서 만져","sexual"],["삼촌이 팬티 속에 손 넣어","sexual"],["친척이 만져요","sexual"],["모르는 사람이 만졌어","sexual"],
  ["학원 선생님이 자꾸 만져요 이 카드 무슨 뜻이에요","sexual"],
  // 때리다 말고 다른 낱말
  ["엄마가 나를 패요","abuse"],["아빠가 목을 졸랐어","abuse"],["엄마가 저를 발로 찼어요","abuse"],["아빠가 담배로 지졌어","abuse"],
  ["엄마가 저를 꼬집어요","abuse"],["집에서 맞아요","abuse"],["매 맞아요","abuse"],["엄마가 화나면 저는 맞아요","abuse"],
  ["집에 가면 또 맞을 거야","abuse"],["같은 반 애가 때려요","abuse"],["아빠가 떼려요","abuse"],["엄마한테 맞는 거 싫어","abuse"],
  // 괴롭힘 은어 · 위험
  ["삥 뜯겼어","bullying"],["빵셔틀 시켜","bullying"],["애들이 돈 뺏어","bullying"],["반 애들이 나만 빼고 놀아","bullying"],
  ["애들이 뒷담 까","bullying"],["애들이 내 물건 숨겨","bullying"],["애들이 왕따 시켜요","bullying"],
  ["모르는 아저씨가 따라와","danger"],["집 나가고 싶어","danger"],["칼 가져가서 찌를 거야","danger"],
  // 3차 점검 — '님'이 붙은 어른(관장님·코치님·사범님)과 친척(고모부·형부)
  ["관장님이 자꾸 만져요","sexual"],["원장님이 만져요","sexual"],["코치님이 자꾸 만져","sexual"],["태권도 사범님이 자꾸 만져","sexual"],
  ["고모부가 만져요","sexual"],["이모부가 만져","sexual"],["형부가 만졌어","sexual"],
  ["코치님한테 맞았어","abuse"],["관장님한테 맞았어요","abuse"],["사범님이 때려요","abuse"],
  // 몸 낱말 없이 말하는 성적 피해 · 사진 요구
  ["선생님이 이상하게 만져요","sexual"],["아빠가 이상하게 만져요","sexual"],["삼촌이 옷을 벗겼어","sexual"],["삼촌이 옷 벗으래","sexual"],
  ["아빠가 같이 자면서 만져","sexual"],["인터넷 친구가 사진 보내래","sexual"],["아저씨가 사진 보내 달래요","sexual"],
  // 유서 · 칼 · 약 · 오타와 사투리
  ["유서 썼어","self_harm"],["유서를 쓰고 있어요","self_harm"],["살아있는 게 싫어","self_harm"],["살아서 뭐해","self_harm"],
  ["왜 사는지 모르겠어","self_harm"],["커터칼로 그었어","self_harm"],["칼로 나를 찔렀어","self_harm"],["손목에 상처 냈어","self_harm"],
  ["수면제 모으고 있어","self_harm"],["약을 다 먹어버릴까","self_harm"],["죽고 시픈","self_harm"],["죽고픈","self_harm"],
  ["죽꼬 싶어","self_harm"],["인생 끝내고 싶어","self_harm"],["영원히 잠들고 싶어","self_harm"],["나 그냥 죽을까","self_harm"],
  ["창문에서 떨어질까","self_harm"],["i dont want to live","self_harm"],["kms","self_harm"],["나 kms","self_harm"],
  // 위협 · 꾀어내기 · 흉기
  ["다 죽여버린다","danger"],["아빠가 죽여버린대","danger"],["모르는 사람이 차에 타래","danger"],["학교에 칼 가져갈 거야","danger"],["집 나갈래","danger"],
  // 때리다 말고 다른 낱말 · 밥을 안 줌 · 집이 무서움
  ["아빠가 나를 밀쳤어","abuse"],["아빠가 주먹으로 쳤어","abuse"],["엄마가 머리를 쳤어","abuse"],["아빠가 손찌검해요","abuse"],
  ["아빠가 던진 물건에 맞았어","abuse"],["엄마가 저를 가둬요","abuse"],["엄마가 밥을 안 줘요","abuse"],["아빠가 무서워서 집에 가기 싫어","abuse"],
  // 괴롭힘 — 명사형 끝말, 한 사람, 따돌림·돈 뺏기
  ["애들이 욕함","bullying"],["애들이 나 놀림","bullying"],["친구가 욕해","bullying"],["따 당했어","bullying"],
  ["반에서 아무도 나랑 안 놀아","bullying"],["선배가 돈 내놓으래","bullying"]
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
  // 2차 점검의 헛경보 — 맞는 선물, 공 맞음, 때려쳤대, 게임·반려동물, 놀이기구, 그림 속 칼 …
  "엄마한테 맞는 선물 고르고 싶어","친구한테 딱 맞는 선물","피구에서 친구한테 공 맞았어","엄마한테 100점 맞았다고 자랑했어",
  "엄마한테 맞는 말 들었어","친구가 학원 때려쳤대","엄마가 다 때려쳐 라고 했어","아동학대 예방 교육 받았어요","아빠가 모기 때려잡았어",
  "학폭 드라마 봤어","왕따시만한 피자","게임하다가 죽어버렸어","강아지가 죽어버렸어","트램펄린에서 뛰어내렸어","다이빙대에서 뛰어내렸어",
  "번지점프 뛰어내렸어","이 동네에서 살기 싫어","손목에 칼라 팔찌","칼로 찌르는 그림이 무서워요","검 10 카드는 칼로 찔려 있어요",
  // '자살'·'자해'를 그대로 잡으면서도 조용해야 하는 말
  "혼자 살아요","할머니랑 혼자 살고 있어요","친구가 놀자 해서 놀았어요","같이 가자 해서 갔어요","한자 해석이 어려워요","혼자 해도 돼요?",
  "자 살 돈이 없어","필통이랑 자 살게요","축구에서 자살골 넣었어",
  // 새 낱말과 겹치는 흔한 말
  "학원 셔틀 타고 왔어요","친구가 내 필통을 만져요","엄마가 스티커 떼려고 했어","엄마가 차 타고 왔어","엄마가 실패는 괜찮대",
  "우리 자매 맞아요","모르는 사람 따라가면 안 돼요","숙제나 없어졌으면 좋겠어","엄마가 이마를 만져 봤어","졸라 웃겨","주사 맞았어요",
  "약 먹고 죽은 듯이 잤어","나만 빼고 다 숙제 했대","동생이랑 살기 싫어","가방 뒤지고 싶어",
  // 3차 점검의 헛경보와 새 규칙 곁의 흔한 말
  "KMS 학원","고양이가 가출했어","부루마블에서 돈 뺏겼어","집 나가고 싶지 않아","나만 빼고 놀이공원 갔대","동물 학대는 나빠요",
  "엄마가 사진 보내래","엄마가 사진 찍어서 보내 줬어","사진관 아저씨가 사진 보내 준대","형이 던진 공에 맞았어","유서 깊은 절에 갔어요",
  "I want to live happily","모르는 사람 차에 타면 안 돼요","학교에 칼 가져가면 안 돼요","엄마가 신발 벗으래","엄마가 옷 벗고 씻으래",
  "아빠가 밥 안 먹어","아침밥 굶었어","감기약을 다 먹어버렸어","나 죽을까 봐 무서웠어","창문에서 떨어질까 봐 무서워",
  "얼굴을 쳐다봤어","그네 밀어 줬어","형이 벌레를 통에 가뒀어","엄마가 고양이를 쫓아냈어","아빠가 박수를 쳤어","엄마가 피아노를 쳤어",
  "칼로 사과를 깎았어","칼로 종이를 그었어","요리하다가 칼에 베였어","넘어져서 팔에 상처 났어","목사님이 기도해 주셨어","아빠가 안고 뽀뽀해 줬어",
  "학원 끝나고 집에 가기 싫어","나 그냥 잘까","아무도 몰라","따뜻한 차 마셨어",
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
  // AI가 괄호를 빼먹어도 답 맨 앞의 '도움필요'는 표시로 봄(낱말이 이어지면 아님)
  assert.ok(S.hasMarker("도움필요 말해 줘서 고마워요. 선생님께 이 화면을 보여 주세요. 1388"));
  assert.ok(S.hasMarker("**도움필요** 고마워요"));
  assert.ok(S.hasMarker("【도움필요】 고마워요"));
  assert.ok(!S.hasMarker("도움 필요한 일이 있으면 선생님께 말해요"));
  assert.ok(!S.hasMarker("힘들 땐 도움필요 하다고 말해요"));
  // 괄호 모양이 달라도 표시로 봄
  for(const t of ["(도움필요) 말해 줘서 고마워요","（도움필요） 고마워요","「도움필요」 고마워요","<도움필요> 고마워요","〔도움 필요〕 고마워요","(도움필요 고마워요"])
    assert.ok(S.hasMarker(t),t);
  assert.ok(!S.hasMarker("(도움이 필요하면 말해요)")&&!S.hasMarker("카드(도움 필요 없음)"));
});

test("holdMarker hides a marker that is still arriving, whatever its brackets or leading quote",()=>{
  for(const t of ["[","[도","【","【도","【도움","【도움필","【도움필요","（도움","\"","\"도","\"도움","\"도움필요","**도움","도","(도움 필"])
    assert.equal(S.holdMarker(t),"",t);
  assert.equal(S.holdMarker("어떨까요? 【"),"어떨까요?");
  assert.equal(S.holdMarker("어떨까요? [도움"),"어떨까요?");
  assert.equal(S.holdMarker("어떨까요? 「도"),"어떨까요?");
  assert.equal(S.holdMarker("안녕하세요. 카드를 봐요"),"안녕하세요. 카드를 봐요");
  assert.equal(S.holdMarker("도움이 필요하면"),"도움이 필요하면");
});
