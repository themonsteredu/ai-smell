/* ══════════════════════════════════════════════════════════════
   마음의 향기 타로 — 추가 질문 응답 서버
   ══════════════════════════════════════════════════════════════

   ⚠️ API 키는 이 파일에 적지 마세요.
      Vercel 대시보드 → Settings → Environment Variables 에서
      이름을  ANTHROPIC_API_KEY  로 넣으시면 됩니다.
      그래야 학생들 화면에 키가 노출되지 않습니다.

   아래 [설정] 값만 바꾸시면 됩니다.
   ══════════════════════════════════════════════════════════════ */

// ───────────── [설정] ─────────────

// 어떤 모델을 쓸지. 질문 1개당 대략:
//   "claude-haiku-4-5-20251001"  → 약 3원  (빠르고 저렴, 수업용으로 충분)
//   "claude-sonnet-4-6"          → 약 8원  (더 섬세한 답변)
const MODEL = "claude-haiku-4-5-20251001";

// 답변 길이 상한. 늘릴수록 비용이 올라갑니다.
const MAX_TOKENS = 400;

// 학생 질문 글자 수 상한
const MAX_QUESTION_LENGTH = 300;

// ──────────── [설정 끝] ────────────


const SYSTEM = `당신은 초등학교 3학년~중학교 3학년 학생을 대상으로 하는 학교 수업용 타로 활동의 안내자입니다.

반드시 지킬 것:
- 학생이 뽑은 세 장의 카드와 선택한 주제 안에서만 이야기합니다.
- 미래를 예언하지 않습니다. 심리 진단이나 의학적 조언을 하지 않습니다.
- 3~4문장, 초등학생도 이해할 수 있는 쉬운 한국어로 답합니다.
- 단정하지 말고 "~일 수 있어요", "~해 보면 어떨까요" 처럼 부드럽게 말합니다.
- 학생의 이름, 학교, 사는 곳, 연락처 같은 개인정보를 묻지 않습니다.
- 타로와 상관없는 요청(숙제 대신 풀기, 게임, 다른 사람 흉보기 등)에는
  "오늘은 카드 이야기만 나눠요"라고 짧게 답하고 넘어갑니다.
- 학생이 많이 힘들어 보이거나 스스로를 해치는 이야기를 꺼내면,
  카드 해석을 이어가지 말고 담임 선생님이나 믿을 수 있는 어른에게
  꼭 이야기해 보자고 따뜻하게 권합니다.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 받습니다." });
  }

  const key = process.env.ANTHROPIC_API_KEY;

  // 키가 아직 등록되지 않았으면 앱이 미리 준비된 답변으로 넘어갑니다.
  if (!key) {
    return res.status(200).json({ answer: null, reason: "NO_KEY" });
  }

  try {
    const { topic, cards, reading, question, history } = req.body || {};

    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "질문이 비어 있습니다." });
    }
    const q = question.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!q) return res.status(400).json({ error: "질문이 비어 있습니다." });

    const cardList = Array.isArray(cards)
      ? cards.map((c, i) => `${i + 1}. ${c.role} — ${c.ko} ${c.rev ? "역방향" : "정방향"} (${c.meaning})`).join("\n")
      : "";

    const userMsg =
`[학생이 고른 주제] ${topic || "알 수 없음"}

[학생이 뽑은 세 장의 카드]
${cardList}

[오늘의 리딩 요약]
${(reading || "").slice(0, 1200)}

[학생의 추가 질문]
${q}

위 카드와 리딩을 근거로, 학생에게 3~4문장으로 답해 주세요.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: Array.isArray(history) && history.length
          ? [...history.slice(-8), { role: "user", content: q }]
          : [{ role: "user", content: userMsg }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Anthropic API 오류:", r.status, detail);
      return res.status(200).json({ answer: null, reason: "API_ERROR" });
    }

    const data = await r.json();
    const answer = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({ answer: answer || null, reason: answer ? "OK" : "EMPTY" });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ answer: null, reason: "SERVER_ERROR" });
  }
};
