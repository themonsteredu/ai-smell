/* Browser and server share the same small, versioned planning vocabulary. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScentPlanModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const audiences = [
    { id: 'gentle', label: '강한 향이 부담스러운 손님', hint: '향을 맡을지 먼저 물어보고, 거리를 두고 살펴볼 수 있게 해요.', care: '향을 맡기 전에 괜찮은지 물어보고, 시향하지 않아도 설명을 볼 수 있게 할 거예요.' },
    { id: 'words', label: '향을 말로 알고 싶은 손님', hint: '색·장면·느낌으로 향을 설명해요.', care: '향을 맡지 않아도 상상할 수 있도록 색과 장면을 함께 적을 거예요.' },
    { id: 'gift', label: '선물할 향을 고르는 손님', hint: '받는 사람이 좋아하는 느낌부터 물어봐요.', care: '선물받을 사람이 좋아하는 느낌을 먼저 물어보고 선택을 도울 거예요.' }
  ];
  const feelings = [
    { id: 'bright', label: '햇살처럼 밝은', title: '작은 햇살', scene: '햇살이 들어오는 창가' },
    { id: 'fresh', label: '바람처럼 산뜻한', title: '바람 한 조각', scene: '바람이 지나가는 정원' },
    { id: 'calm', label: '숲처럼 차분한', title: '느린 숲길', scene: '천천히 걷는 숲길' },
    { id: 'warm', label: '담요처럼 포근한', title: '다정한 오후', scene: '담요를 덮고 쉬는 오후' },
    { id: 'curious', label: '새로운 여행 같은', title: '처음 만난 계절', scene: '처음 가 보는 여행지' }
  ];
  const limits = { name: 40, introduction: 180, consideration: 180, reason: 240 };
  function text(value, max) {
    return typeof value === 'string' && value.trim().length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value.trim() : '';
  }
  function brief(value) {
    if (!value || typeof value !== 'object') return null;
    const audience = audiences.find(x => x.id === value.audience);
    const feeling = feelings.find(x => x.id === value.feeling);
    const scent = text(value.scent, 40);
    return audience && feeling && scent ? { audience: audience.id, feeling: feeling.id, scent } : null;
  }
  function proposal(value) {
    if (!value || typeof value !== 'object') return null;
    const result = {};
    for (const key of ['name', 'introduction', 'consideration']) {
      result[key] = text(value[key], limits[key]);
      if (!result[key]) return null;
    }
    return result;
  }
  function examples(value) {
    const b = brief(value);
    if (!b) return [];
    const a = audiences.find(x => x.id === b.audience);
    const f = feelings.find(x => x.id === b.feeling);
    const scent = b.scent === '시향 후 결정' ? '직접 시향하며 고를 향' : b.scent + '의 이미지';
    return [
      { name: f.title, introduction: `${scent}에서 ${f.scene}을 떠올렸어요. ${f.label} 분위기를 담고 싶은 향기 작품이에요.`, consideration: a.care },
      { name: '당신에게 건네는 한 장면', introduction: `${f.scene}을 선물한다면 어떨까요? ${scent}를 출발점으로, 서로 다른 취향을 이야기할 수 있는 작품을 기획했어요.`, consideration: a.care }
    ];
  }
  function complete(draft) {
    const p = proposal(draft);
    const reason = draft && text(draft.reason, limits.reason);
    return p && reason ? { ...p, reason } : null;
  }
  return { audiences, feelings, limits, text, brief, proposal, examples, complete };
});
