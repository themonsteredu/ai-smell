(function () {
  'use strict';
  const M = window.ScentPlanModel;
  const KEY = 'moalab.scent-plan.v1';
  const TTL = 12 * 60 * 60 * 1000;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let plan = null;
  let storageOK = true;
  let request = null;
  let epoch = 0;
  let busy = false;
  let assistanceMessage = '';

  function blank(scents) {
    return {
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'scent-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      stage: 5, scents, audience: '', feeling: '', scent: '',
      draft: { name: '', introduction: '', consideration: '', reason: '' },
      options: [], source: 'example', selected: null, inspiration: null, requests: 0, revision: 0, confirmedAt: null
    };
  }
  function restore() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Number.isFinite(data.savedAt) || Date.now() - data.savedAt > TTL || data.savedAt > Date.now() + 60000) throw new Error('expired');
      const p = data.plan;
      if (!p || !Array.isArray(p.scents) || ![5, 6, 7].includes(p.stage)) throw new Error('invalid');
      const scents = p.scents.slice(0, 3).map(x => M.text(x, 40)).filter(Boolean);
      const next = blank(scents);
      next.id = M.text(p.id, 80) || next.id;
      next.audience = M.audiences.some(x => x.id === p.audience) ? p.audience : '';
      next.feeling = M.feelings.some(x => x.id === p.feeling) ? p.feeling : '';
      next.scent = [...scents, '시향 후 결정'].includes(p.scent) ? p.scent : '';
      for (const key of Object.keys(M.limits)) next.draft[key] = M.text(p.draft && p.draft[key], M.limits[key]);
      const options = Array.isArray(p.options) ? p.options.slice(0, 2).map(M.proposal) : [];
      next.options = options.length === 2 && options.every(Boolean) ? options : [];
      next.source = p.source === 'ai' ? 'ai' : 'example';
      next.selected = Number.isInteger(p.selected) && next.options[p.selected] ? p.selected : null;
      if (p.inspiration && ['ai', 'example'].includes(p.inspiration.source) && M.proposal(p.inspiration.proposal)) {
        next.inspiration = { source: p.inspiration.source, proposal: M.proposal(p.inspiration.proposal) };
      }
      next.requests = Number.isInteger(p.requests) ? Math.max(0, Math.min(2, p.requests)) : 0;
      next.revision = Number.isInteger(p.revision) ? Math.max(0, Math.min(10000, p.revision)) : 0;
      next.confirmedAt = typeof p.confirmedAt === 'string' && Number.isFinite(Date.parse(p.confirmedAt)) ? p.confirmedAt : null;
      next.stage = M.brief(next) ? (p.stage === 7 && M.complete(next.draft) && next.confirmedAt ? 7 : 6) : 5;
      plan = next;
    } catch {
      try { sessionStorage.removeItem(KEY); } catch { storageOK = false; }
    }
  }
  function save() {
    if (!plan) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ version: 1, savedAt: Date.now(), plan })); storageOK = true; }
    catch { storageOK = false; }
    const note = document.getElementById('plan-storage');
    if (note) note.textContent = storageText();
  }
  function storageText() {
    return storageOK
      ? '이 탭에 임시 보관돼요. 탭을 닫기 전 기획서를 받아 두세요. 공용 기기에서는 마친 뒤 ‘새 활동’을 눌러 주세요.'
      : '이 브라우저에서는 임시 보관이 안 돼요. 화면을 닫기 전 기획서를 받아 두세요.';
  }
  const storageNote = () => `<p class="plan-storage" id="plan-storage">${storageText()}</p>`;
  function stop() {
    epoch++;
    if (request) request.abort();
    request = null;
    busy = false;
  }
  function reset() {
    stop(); plan = null; assistanceMessage = '';
    try { sessionStorage.removeItem(KEY); } catch { storageOK = false; }
  }
  function go(step) {
    if (!plan) return;
    plan.stage = step; save(); state.step = step; render();
  }
  function begin() {
    if (!plan) plan = blank([...new Set(state.scents.map(x => M.text(x.name, 40)).filter(Boolean))].slice(0, 3));
    go(plan.stage);
  }
  function resume() { if (plan) go(plan.stage); }
  function newActivity() {
    if (plan && !window.confirm('이 기기의 기획서를 지우고 새 활동을 시작할까요? 필요한 기획서는 먼저 받아 두세요.')) return;
    reset(); restart(); state.step = 0; render();
  }
  function cover() {
    return plan ? `<div class="plan-resume"><p>이 탭에 작성 중인 기획서가 있어요. 내 활동일 때만 이어서 해 주세요.</p><button class="btn primary" onclick="ScentPlanner.resume()">내 기획 이어하기</button><button class="btn" onclick="ScentPlanner.newActivity()">새 활동</button></div>` : '';
  }
  function choice(group, value, title, description, current) {
    return `<label class="plan-option"><input type="radio" name="${group}" value="${escape(value)}" ${current === value ? 'checked' : ''} required><span><strong>${escape(title)}</strong>${description ? `<small>${escape(description)}</small>` : ''}</span></label>`;
  }
  function heading(part, title, lead) {
    return `<p class="plan-step">조향사의 작업실 · ${part}</p><h2 tabindex="-1">${title}</h2><p class="lead">${lead}</p>`;
  }
  function summary() {
    const a = M.audiences.find(x => x.id === plan.audience);
    const f = M.feelings.find(x => x.id === plan.feeling);
    return `<div class="plan-summary"><p><b>함께할 손님</b> · ${escape(a.label)}</p><p><b>담고 싶은 느낌</b> · ${escape(f.label)}</p><p><b>향기 이미지</b> · ${escape(plan.scent)}</p></div>`;
  }
  function briefScreen() {
    screenEl.innerHTML = heading('1 / 3', '누구를 위한 향기일까요?', '내가 떠올린 향을 다른 사람에게 건네 봐요. 손님마다 향을 느끼는 방식과 취향이 다를 수 있어요.')
      + `<form id="plan-brief">
        <fieldset class="plan-group"><legend>1. 배려하고 싶은 손님</legend><div class="plan-choices">${M.audiences.map(x => choice('audience', x.id, x.label, x.hint, plan.audience)).join('')}</div></fieldset>
        <fieldset class="plan-group"><legend>2. 작품에 담고 싶은 느낌</legend><div class="plan-choices plan-feelings">${M.feelings.map(x => choice('feeling', x.id, x.label, '', plan.feeling)).join('')}</div></fieldset>
        <fieldset class="plan-group"><legend>3. 출발점이 될 향기 이미지</legend><div class="plan-choices">${plan.scents.map(x => choice('scent', x, x, '타로 활동에서 떠올린 향', plan.scent)).join('')}${choice('scent', '시향 후 결정', '직접 맡아 보고 고를래요', '지금 정하지 않아도 괜찮아요.', plan.scent)}</div><p class="plan-help">이 목록은 기획을 돕는 이미지예요. 실제 사용할 재료와 양은 선생님이 확인한 키트와 시향 결과로 정해요.</p></fieldset>
        <p class="plan-status" id="brief-status" role="status"></p>
        <div class="nav"><button class="btn" type="button" onclick="ScentPlanner.backToScents()">${state.scents.length ? '향기 다시 보기' : '표지로'}</button><button class="btn primary" type="submit">이름과 소개 만들기</button></div>
      </form>` + storageNote();
    const form = document.getElementById('plan-brief');
    form.addEventListener('change', event => {
      if (!['audience', 'feeling', 'scent'].includes(event.target.name)) return;
      if (plan[event.target.name] !== event.target.value) {
        plan[event.target.name] = event.target.value;
        plan.options = []; plan.selected = null; plan.confirmedAt = null;
        assistanceMessage = '';
        save();
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!M.brief(plan)) { document.getElementById('brief-status').textContent = '손님, 느낌, 향기 이미지를 하나씩 골라 주세요.'; return; }
      go(6);
    });
  }
  function field(key, label, placeholder, multiline) {
    const attrs = `id="plan-${key}" name="${key}" maxlength="${M.limits[key]}" required placeholder="${escape(placeholder)}"`;
    return `<label class="plan-field"><span>${label}</span>${multiline
      ? `<textarea ${attrs}>${escape(plan.draft[key])}</textarea>`
      : `<input ${attrs} value="${escape(plan.draft[key])}" autocomplete="off">`}</label>`;
  }
  function editorScreen() {
    screenEl.innerHTML = heading('2 / 3', '내 말로 작품을 소개해요', 'AI의 제안도 하나의 아이디어예요. 마음에 드는 부분을 고르고, 내 생각과 선택 이유를 담아 완성해요.')
      + summary() + `<div class="plan-editor-grid"><aside class="plan-assist" aria-label="기획 도움">
        <h3>이름이 잘 떠오르지 않나요?</h3><p class="plan-help">선택한 손님·느낌·향기 이미지로 두 가지 안을 받아 볼 수 있어요. 직접 써도 좋아요.</p>
        <button type="button" class="btn primary" id="plan-ai">AI 제안 2개 보기</button>
        <button type="button" class="btn" id="plan-examples">준비된 예시 보기</button>
        <p class="plan-status" id="plan-assist-status" role="status"></p><div id="plan-options"></div>
      </aside><form id="plan-editor">
        ${field('name', '작품 이름', '예: 작은 햇살', false)}
        ${field('introduction', '가게에 붙일 작품 소개', '어떤 장면과 느낌을 담고 싶나요?', true)}
        ${field('consideration', '손님을 배려할 방법', '향을 맡기 전에 괜찮은지 물어볼 거예요.', true)}
        ${field('reason', '내가 이렇게 선택한 이유', '내가 고르거나 바꾼 부분과 그 이유를 써 주세요.', true)}
        <p class="plan-help">실명이나 학교 이름 대신 작품 이야기만 적어 주세요.</p>
        <p class="plan-status plan-error" id="plan-editor-status" role="status"></p>
        <div class="nav"><button class="btn" type="button" onclick="ScentPlanner.go(5)">손님·향기 바꾸기</button><button class="btn primary" type="submit">내 기획서 완성</button></div>
      </form></div>` + storageNote();
    document.getElementById('plan-ai').addEventListener('click', suggest);
    document.getElementById('plan-examples').addEventListener('click', () => {
      if (busy) return;
      plan.options = M.examples(plan); plan.source = 'example'; plan.selected = null;
      plan.confirmedAt = null; assistanceMessage = '미리 준비한 예시예요. AI가 새로 만든 답변은 아니에요.'; save(); renderOptions();
    });
    const form = document.getElementById('plan-editor');
    form.addEventListener('input', event => {
      if (!Object.hasOwn(M.limits, event.target.name)) return;
      plan.draft[event.target.name] = event.target.value.slice(0, M.limits[event.target.name]);
      plan.confirmedAt = null; save();
    });
    form.addEventListener('submit', event => { event.preventDefault(); confirmPlan(); });
    renderOptions();
  }
  function renderOptions() {
    const box = document.getElementById('plan-options');
    if (!box || !plan) return;
    const ai = document.getElementById('plan-ai');
    ai.disabled = busy || plan.requests >= 2;
    ai.textContent = busy ? '제안을 생각하고 있어요…' : plan.requests >= 2 ? '이번 활동의 AI 제안을 모두 봤어요' : 'AI 제안 2개 보기';
    document.getElementById('plan-examples').disabled = busy;
    document.getElementById('plan-assist-status').textContent = assistanceMessage || (plan.options.length ? (plan.source === 'ai' ? 'AI 제안이에요. 내 생각과 맞는지 확인해 주세요.' : '미리 준비한 예시예요. 직접 고쳐 써도 좋아요.') : 'AI 제안은 활동마다 두 번까지 볼 수 있어요.');
    box.innerHTML = plan.options.map((x, i) => `<article class="plan-example ${plan.selected === i ? 'selected' : ''}"><small>${plan.source === 'ai' ? 'AI 제안' : '준비된 예시'} ${i + 1}</small><h4>${escape(x.name)}</h4><p>${escape(x.introduction)}</p><p><b>배려 방법</b> · ${escape(x.consideration)}</p><button type="button" class="btn" data-option="${i}" ${busy ? 'disabled' : ''}>${plan.selected === i ? '선택한 제안' : '이 안을 가져와 다듬기'}</button></article>`).join('');
    box.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => choose(Number(button.dataset.option))));
  }
  function choose(index) {
    const option = plan.options[index];
    if (!option || busy) return;
    if (Object.keys(option).some(key => plan.draft[key].trim() && plan.draft[key] !== option[key]) && !window.confirm('이 제안으로 이름·소개·배려 방법을 바꿀까요? 선택 이유는 유지돼요.')) return;
    Object.assign(plan.draft, option); plan.selected = index;
    plan.inspiration = { source: plan.source, proposal: { ...option } };
    plan.confirmedAt = null; save();
    for (const key of Object.keys(option)) document.getElementById('plan-' + key).value = option[key];
    renderOptions(); document.getElementById('plan-name').focus();
  }
  async function suggest() {
    if (!plan || busy || plan.requests >= 2 || !M.brief(plan)) return;
    stop(); busy = true;
    const token = epoch;
    const currentPlan = plan;
    const brief = M.brief(plan);
    const controller = new AbortController(); request = controller;
    plan.requests++; plan.confirmedAt = null; save();
    assistanceMessage = '선택한 손님을 생각하며 이름과 소개를 만들고 있어요.'; renderOptions();
    const timer = setTimeout(() => controller.abort(), 16000);
    let result;
    try {
      const response = await fetch('/api/plan', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(brief), signal: controller.signal
      });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      const options = Array.isArray(data.options) && data.options.length === 2 ? data.options.map(M.proposal) : [];
      if (!['ai', 'example'].includes(data.source) || options.length !== 2 || options.some(x => !x)) throw new Error('invalid');
      result = { source: data.source, options };
    } catch {
      result = { source: 'example', options: M.examples(brief) };
    } finally { clearTimeout(timer); }
    // A late response must not overwrite another screen, activity or edited brief.
    if (token !== epoch || plan !== currentPlan || state.step !== 6 || JSON.stringify(M.brief(plan)) !== JSON.stringify(brief)) return;
    request = null; busy = false;
    plan.options = result.options; plan.source = result.source; plan.selected = null;
    assistanceMessage = result.source === 'ai' ? 'AI 제안이에요. 마음에 드는 부분을 골라 내 말로 다듬어 주세요.' : 'AI에 연결되지 않아 준비된 예시를 보여 드려요. 이 예시로도 기획을 계속할 수 있어요.';
    save(); renderOptions();
  }
  function confirmPlan() {
    if (busy) { stop(); }
    if (!M.brief(plan) || !M.complete(plan.draft)) {
      document.getElementById('plan-editor-status').textContent = '이름·소개·배려 방법·선택 이유를 모두 적어 주세요. 공백만으로는 완성할 수 없어요.';
      return;
    }
    if (!plan.confirmedAt) { plan.revision++; plan.confirmedAt = new Date().toISOString(); }
    go(7);
  }
  function output() {
    if (!plan || !plan.confirmedAt || !M.brief(plan) || !M.complete(plan.draft)) return null;
    const draft = M.complete(plan.draft);
    const chosen = plan.inspiration ? plan.inspiration.proposal : null;
    return {
      schema: 'moalab.craft-plan.v1', activity: 'perfumery', planId: plan.id,
      revision: plan.revision, confirmedAt: plan.confirmedAt,
      product: { name: draft.name, introduction: draft.introduction, scentInspiration: plan.scent, feeling: M.feelings.find(x => x.id === plan.feeling).label },
      customer: { id: plan.audience, need: M.audiences.find(x => x.id === plan.audience).label, consideration: draft.consideration },
      reflection: { choiceReason: draft.reason, assistance: chosen ? plan.inspiration.source : 'self', selectedSuggestion: chosen ? { ...chosen } : null,
        changedFields: chosen ? Object.keys(chosen).filter(key => chosen[key] !== draft[key]) : [] },
      materials: { status: 'teacher-confirmation-needed' }
    };
  }
  function resultScreen() {
    const p = output();
    if (!p) { go(M.brief(plan) ? 6 : 5); return; }
    const assistance = p.reflection.assistance === 'ai' ? 'AI 제안을 참고해 내가 선택했어요.' : p.reflection.assistance === 'example' ? '준비된 예시를 참고해 내가 선택했어요.' : '내가 직접 이름과 소개를 정했어요.';
    screenEl.innerHTML = heading('3 / 3', '나의 향기 작품 기획서', '내 가게에 소개할 이야기와, 내가 고민하고 선택한 이유를 모았어요.')
      + `<article class="plan-result"><span class="plan-badge">조향사 · 작품 기획 ${p.revision}차</span><h3>${escape(p.product.name)}</h3><p class="plan-intro">${escape(p.product.introduction)}</p><dl>
        <dt>향기 이미지</dt><dd>${escape(p.product.scentInspiration)}</dd>
        <dt>담고 싶은 느낌</dt><dd>${escape(p.product.feeling)}</dd>
        <dt>생각한 손님</dt><dd>${escape(p.customer.need)}</dd>
        <dt>배려할 방법</dt><dd>${escape(p.customer.consideration)}</dd>
        <dt>내가 선택한 이유</dt><dd>${escape(p.reflection.choiceReason)}</dd>
        <dt>기획한 과정</dt><dd>${assistance}${p.reflection.selectedSuggestion ? (p.reflection.changedFields.length ? ' 가져온 제안에서 내 글로 바꾼 부분이 있어요.' : ' 제안의 문장을 선택하고, 선택 이유를 직접 적었어요.') : ''}</dd>
      </dl><p class="plan-help">향기 이미지로 만든 기획서예요. 실제 재료와 양은 선생님과 시향 후 확인해요.</p></article>
      <div class="plan-actions"><button class="btn primary" onclick="ScentPlanner.copy()">기획서 복사</button><button class="btn" onclick="ScentPlanner.download()">기획서 파일 받기</button><button class="btn" onclick="window.print()">인쇄 · PDF 저장</button></div>
      <p id="plan-export-status" class="plan-status" role="status"></p>
      <section class="plan-next"><h3>이 기획으로 다음에는 무엇을 할까요?</h3><p><b>내 가게</b>에 이름과 소개를 붙이고, <b>우리 반 상점가</b>에서 친구 반응을 보며 고쳐요. 오늘의 선택 이유는 <b>진로기록</b>에 쓸 수 있어요.</p><p>모아랩 자동 연결은 준비 중이에요. 지금은 기획서를 복사하거나 파일로 받아 두세요. 실물 작품 사진은 2차시에 연결할 예정이에요.</p></section>
      <div class="nav"><button class="btn" onclick="ScentPlanner.go(6)">기획서 수정하기</button><button class="btn" onclick="ScentPlanner.newActivity()">새 활동</button></div>` + storageNote();
  }
  function plainText() {
    const p = output();
    if (!p) return '';
    return `나의 향기 작품 기획서 · ${p.revision}차\n\n${p.product.name}\n${p.product.introduction}\n\n향기 이미지: ${p.product.scentInspiration}\n담고 싶은 느낌: ${p.product.feeling}\n생각한 손님: ${p.customer.need}\n배려할 방법: ${p.customer.consideration}\n\n내가 선택한 이유\n${p.reflection.choiceReason}\n\n기획 도움: ${p.reflection.assistance === 'ai' ? 'AI 제안' : p.reflection.assistance === 'example' ? '준비된 예시' : '직접 작성'}\n\n실제 재료와 양은 선생님과 시향 후 확인합니다.\n이 파일은 기획서이며 모아랩에 자동 저장된 기록은 아닙니다.\n`;
  }
  async function copy() {
    const text = plainText(); if (!text) return;
    const current = plan;
    try {
      if (!navigator.clipboard) throw new Error('unavailable');
      await navigator.clipboard.writeText(text);
      const status = document.getElementById('plan-export-status');
      if (status && current === plan) status.textContent = '기획서를 복사했어요. 필요한 곳에 붙여 넣어 주세요.';
    } catch {
      if (current !== plan || state.step !== 7) return;
      sheet(`<h3>기획서 복사</h3><p class="plan-help">아래 글을 길게 누르거나 전체 선택해 복사해 주세요.</p><textarea class="plan-copy-text" readonly aria-label="복사할 기획서">${escape(text)}</textarea><div class="nav"><button class="btn" onclick="closeSheet()">닫기</button></div>`);
      document.querySelector('.plan-copy-text').select();
    }
  }
  function download() {
    const text = plainText(); if (!text) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = '나의-향기-작품-기획서.txt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById('plan-export-status').textContent = '파일 받기를 요청했어요. 기기의 다운로드 목록을 확인해 주세요.';
  }
  window.ScentPlanner = {
    begin, resume, newActivity, reset, cover, go, copy, download, output,
    hasDraft: () => !!plan,
    onStep: step => { if (step !== 6 && busy) { stop(); assistanceMessage = ''; } },
    backToScents: () => { state.step = state.scents.length ? 4 : -1; render(); },
    render: step => {
      if (!plan) { state.step = 4; render(); return; }
      if (step === 5) briefScreen(); else if (step === 6) editorScreen(); else resultScreen();
    }
  };
  restore(); render();
})();
