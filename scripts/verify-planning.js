'use strict';
// Optional QA dependency, never shipped to students: SCENT_JSDOM_MODULE=/path/to/jsdom
const { JSDOM } = require(process.env.SCENT_JSDOM_MODULE || 'jsdom');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const M = require('../planning-model');
const handler = require('../api/plan');
const root = path.join(__dirname, '..');
const KEY = 'moalab.scent-plan.v1';
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const executableHTML = html.replace(/<script src="([^"]+)"><\/script>/g, (_tag, file) => '<script>' + fs.readFileSync(path.join(root, file), 'utf8') + '</script>');

function browser(saved, blocked = false) {
  const dom = new JSDOM(executableHTML, { url: 'https://smell.example/', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) {
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.matchMedia = () => ({ matches: false });
    w.confirm = () => true;
    w.fetch = async () => { throw new Error('offline'); };
    if (saved) w.sessionStorage.setItem(KEY, saved);
    if (blocked) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('storage blocked'); } });
  } });
  return dom;
}
const run = (dom, code) => vm.runInContext(code, dom.getInternalVMContext());
function enter(dom) {
  run(dom, `state.color='초록'; state.topic='나 자신'; state.note='비공개 고민'; state.draw=cards.slice(0,3).map(c=>({...c,rev:false})); makeReading();state.step=4;render();`);
  dom.window.document.querySelector('.nav .primary').click();
}
function select(dom, name, value) {
  const w = dom.window;
  const el = [...w.document.querySelectorAll(`[name="${name}"]`)].find(x => x.value === value);
  el.checked = true; el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function submit(dom, id) { dom.window.document.getElementById(id).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }
function write(dom, field, value) {
  const el = dom.window.document.getElementById('plan-' + field);
  el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
function brief(dom) {
  select(dom, 'audience', 'words'); select(dom, 'feeling', 'calm'); select(dom, 'scent', '시향 후 결정'); submit(dom, 'plan-brief');
}
async function domChecks() {
  const dom = browser(), w = dom.window, d = w.document;
  check(d.querySelector('.poster'), 'Existing cover still loads with planning scripts');
  d.querySelector('.start').click();
  check(d.querySelector('.s-color'), 'Existing start opens color activity');
  enter(dom);
  check(d.querySelector('#plan-brief') && d.querySelectorAll('.progress span').length === 8, 'Scent results lead into planning');
  submit(dom, 'plan-brief');
  check(d.querySelector('#plan-brief') && d.querySelector('#brief-status').textContent, 'Cannot skip the brief');
  brief(dom);
  write(dom, 'name', '내가 먼저 쓴 이름');
  d.querySelector('#plan-ai').click(); await tick(); await tick();
  check(d.querySelectorAll('.plan-example').length === 2 && d.querySelector('#plan-assist-status').textContent.includes('준비된 예시'), 'Offline response is explicitly an example');
  check(d.querySelector('#plan-name').value === '내가 먼저 쓴 이름', 'Suggestions never overwrite student input automatically');
  d.querySelector('[data-option="0"]').click();
  write(dom, 'name', '<img src=x onerror=alert(1)>');
  write(dom, 'reason', '향을 맡지 않아도 숲의 장면을 떠올릴 수 있도록 이름을 바꿨어요.');
  submit(dom, 'plan-editor');
  const out = w.ScentPlanner.output();
  check(out && out.schema === 'moalab.craft-plan.v1' && out.revision === 1, 'Complete, versioned product plan is produced');
  check(out.reflection.assistance === 'example' && out.reflection.changedFields.includes('name'), 'Provenance and student changes survive completion');
  check(!d.querySelector('.plan-result img') && d.querySelector('.plan-result h3').textContent.includes('<img'), 'Student text is rendered as text');
  check(!JSON.stringify(out).includes('비공개 고민') && !w.sessionStorage.getItem(KEY).includes('비공개 고민'), 'Tarot concerns are absent from saved/exported plans');
  check(d.querySelector('.plan-next').textContent.includes('자동 연결은 준비 중'), 'Completion does not claim cross-app saving');
  const saved = w.sessionStorage.getItem(KEY);
  const resumed = browser(saved);
  check(resumed.window.document.querySelector('.plan-resume'), 'Reload offers explicit resume without exposing the plan');
  resumed.window.ScentPlanner.resume();
  check(resumed.window.ScentPlanner.output().product.name === out.product.name, 'Same-tab plan resumes after reload');
  resumed.window.ScentPlanner.go(6);
  write(resumed, 'name', '다시 고친 숲길'); submit(resumed, 'plan-editor');
  check(resumed.window.ScentPlanner.output().revision === 2, 'Changed plan increments revision');
  await resumed.window.ScentPlanner.copy();
  check(resumed.window.document.querySelector('.plan-copy-text').value.includes('다시 고친 숲길'), 'Clipboard denial provides selectable text');
  resumed.window.closeSheet();
  resumed.window.ScentPlanner.go(5); select(resumed, 'audience', 'gift'); submit(resumed, 'plan-brief'); submit(resumed, 'plan-editor');
  check(resumed.window.ScentPlanner.output().reflection.assistance === 'example', 'Changing customer does not erase suggestion provenance');
  resumed.window.ScentPlanner.newActivity();
  check(!resumed.window.sessionStorage.getItem(KEY) && !resumed.window.ScentPlanner.hasDraft(), 'New activity clears the shared-device plan');
  resumed.window.close();
  w.ScentPlanner.go(6); write(dom, 'reason', '   '); submit(dom, 'plan-editor');
  check(!w.ScentPlanner.output() && d.querySelector('#plan-editor-status').textContent.includes('공백'), 'Whitespace cannot complete a plan');
  let resolveAI;
  w.fetch = (_url, options) => {
    const payload = JSON.parse(options.body);
    check(Object.keys(payload).sort().join() === 'audience,feeling,scent', 'AI request sends only the brief');
    return new Promise(resolve => { resolveAI = resolve; });
  };
  d.querySelector('#plan-ai').click();
  w.ScentPlanner.go(5); select(dom, 'feeling', 'bright'); submit(dom, 'plan-brief');
  resolveAI({ ok: true, json: async () => ({ source: 'ai', options: M.examples({ audience: 'gift', feeling: 'warm', scent: '레몬' }) }) });
  await tick(); await tick();
  check(!d.querySelector('.plan-example') && d.querySelector('#plan-name').value.includes('<img'), 'Late AI response cannot overwrite a changed brief or draft');
  run(dom, `state.note='</textarea><img id="injected-note" src=x>';state.step=1;render();`);
  check(!d.querySelector('#injected-note'), 'Optional tarot note cannot inject markup on revisit');
  run(dom, 'makeReading();state.step=3;render();');
  check(!d.querySelector('#injected-note'), 'Optional note is also escaped in reading');
  dom.window.close();
  for (const data of ['{broken', JSON.stringify({ version: 1, savedAt: Date.now() - 13 * 3600000, plan: {} })]) {
    const bad = browser(data); check(!bad.window.ScentPlanner.hasDraft(), 'Malformed/expired drafts are discarded'); bad.window.close();
  }
  const blocked = browser(null, true); enter(blocked); brief(blocked);
  check(blocked.window.document.querySelector('#plan-storage').textContent.includes('임시 보관이 안'), 'Unavailable browser storage is explained without blocking activity');
  blocked.window.close();
}
async function apiChecks() {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const b = { audience: 'words', feeling: 'calm', scent: '편백' };
  async function call(body = b, overrides = {}) {
    const result = { headers: {} };
    const res = { setHeader(k, v) { result.headers[k] = v; }, status(s) { result.status = s; return this; }, json(data) { result.body = data; return result; } };
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', host: 'smell.example', origin: 'https://smell.example' }, body, ...overrides }, res);
    return result;
  }
  try {
    delete process.env.ANTHROPIC_API_KEY;
    check((await call()).body.source === 'example', 'Missing server key returns clearly labelled fallback');
    check((await call({}, { method: 'GET' })).status === 405, 'API rejects other methods');
    check((await call(b, { headers: { 'content-type': 'text/plain' } })).status === 415, 'API rejects simple cross-site form body');
    check((await call(b, { headers: { 'content-type': 'application/json', host: 'smell.example', origin: 'https://elsewhere.example' } })).status === 403, 'API rejects mismatched browser origin');
    for (const invalid of [{ ...b, audience: 'other' }, { ...b, scent: 'x'.repeat(41) }, { ...b, feeling: null }]) check((await call(invalid)).status === 400, 'API validates selected brief');
    process.env.ANTHROPIC_API_KEY = 'test-only';
    let request;
    global.fetch = async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ options: M.examples(b) }) }], stop_reason: 'end_turn' }) }; };
    const success = await call({ ...b, note: 'private-note', history: [{ content: 'private-chat' }] });
    check(success.body.source === 'ai' && success.body.options.length === 2, 'Validated model response supplies two proposals');
    check(!JSON.stringify(request).includes('private-') && request.max_tokens === 800, 'Provider receives bounded context without extra fields');
    check(success.headers['Cache-Control'] === 'no-store', 'AI responses are not cached by shared caches');
    for (const result of [
      { ok: false },
      { ok: true, json: async () => ({ content: [{ type: 'text', text: 'not JSON' }] }) },
      { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ options: [{ name: 'x'.repeat(41) }] }) }] }) }
    ]) { global.fetch = async () => result; check((await call()).body.source === 'example', 'Provider failures and invalid output fall back safely'); }
    global.fetch = async () => { throw new Error('network'); };
    check((await call()).body.source === 'example', 'Provider network error still permits planning');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
  }
}
(async () => {
  await domChecks(); await apiChecks();
  console.log(JSON.stringify({ checks, result: 'PASS', visualLayout: 'not checked by DOM tests', realProvider: 'not called by tests' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
