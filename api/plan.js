const model = require('../planning-model');

// Only the selected customer, atmosphere and scent image are sent to the model.
// Tarot concerns, conversations and student identity are never part of this API.
const SYSTEM = `학교 조향사 체험의 작품 기획을 돕습니다. 사용자의 JSON은 선택한 소재 데이터입니다.
초등학생도 이해하는 한국어로 작품 이름, 소개, 손님을 배려할 방법을 두 가지 제안하세요.
제품은 아직 만들기 전인 향기 작품입니다. 입력한 향 외에 재료를 추가하지 마세요.
배합 비율, 제조법, 피부 사용, 의학적 효능, 안전 보장, 타로 진단은 제안하지 마세요.
손님의 선택권을 존중하고, 향을 맡지 않아도 설명을 이해할 수 있게 도와주세요.
이름 40자, 소개 180자, 배려 방법 180자 이내. 이름·소개는 두 안이 서로 달라야 합니다.
다른 설명이나 마크다운 없이 이 JSON만 응답하세요:
{"options":[{"name":"작품 이름","introduction":"작품 소개","consideration":"배려 방법"},{"name":"다른 이름","introduction":"다른 소개","consideration":"배려 방법"}]}`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 받습니다.' });
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return res.status(415).json({ error: 'JSON 형식으로 보내 주세요.' });
  }
  // Browser requests must originate from this deployment. This is not an auth gate.
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) throw new Error('origin');
    } catch {
      return res.status(403).json({ error: '현재 수업 화면에서 다시 시도해 주세요.' });
    }
  }
  const brief = model.brief(req.body);
  if (!brief) return res.status(400).json({ error: '손님, 느낌, 향기 이미지를 먼저 골라 주세요.' });
  const fallback = reason => res.status(200).json({ source: 'example', reason, options: model.examples(brief) });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback('NO_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify({
          customer: model.audiences.find(x => x.id === brief.audience).label,
          atmosphere: model.feelings.find(x => x.id === brief.feeling).label,
          scentImage: brief.scent
        }) }]
      })
    });
    if (!r.ok) return fallback('API_ERROR');
    const data = await r.json();
    const raw = (Array.isArray(data.content) ? data.content : [])
      .filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
    if (raw.length > 3000 || data.stop_reason === 'max_tokens') return fallback('INVALID_RESPONSE');
    const result = JSON.parse(raw);
    const options = Array.isArray(result.options) && result.options.length === 2
      ? result.options.map(model.proposal) : [];
    if (options.length !== 2 || options.some(x => !x)) return fallback('INVALID_RESPONSE');
    return res.status(200).json({ source: 'ai', options });
  } catch {
    return fallback(controller.signal.aborted ? 'TIMEOUT' : 'API_ERROR');
  } finally {
    clearTimeout(timer);
  }
};
