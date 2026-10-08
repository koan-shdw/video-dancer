// Isolated diagnostic: real source, synthetic provider replies, no network or app data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(file, req, extra = {}) {
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, require: req, ...extra }, { filename: file });
  return exports;
}
const hunt = load(path.join(root, 'src/main/providers/mcp/hunt.ts'), require);
let status = 'ip_detected';
let polls = 0;
const bridge = {
  bridgeReady: () => true,
  onBestLogin: (_service, opts, run) => run(opts),
  bridgeToolCall: async (_service, tool) => {
    if (tool === 'generate_video') return { structuredContent: { results: [{ id: 'diagnostic-job' }] } };
    assert.equal(tool, 'job_status');
    polls++;
    return { structuredContent: { generation: { id: 'diagnostic-job', status } } };
  }
};
const hf = load(path.join(root, 'src/main/providers/mcp/higgsfieldMcp.ts'), name => {
  if (name === '../../bridge') return bridge;
  if (name === '../../bridge/interpreter') return {};
  if (name === './hunt') return hunt;
  if (name === '../../fal') return { downloadTo: () => { throw Error('Unexpected download'); } };
  if (name === '@koan/vidancer-ui/shared/models') return { modelFor: () => ({ endpoints: { ref2v: 'diagnostic-model' } }) };
  if (['fs/promises', 'path', 'crypto'].includes(name)) return require(name);
  throw Error('Unexpected dependency: ' + name);
}, { setTimeout: fn => { if (polls >= 2) throw Error('PROBE_STOP_AFTER_TWO_POLLS'); fn(); } });
(async () => {
  const messages = [];
  const opts = { engine: 'diagnostic', mode: 'ref2v', images: [], prompt: 'diagnostic', duration: '5', resolution: '720p', outDir: __dirname, onProgress: msg => messages.push(msg) };
  await assert.rejects(hf.runHfMcpRender(opts), /PROBE_STOP_AFTER_TWO_POLLS/);
  assert.equal(polls, 2);
  assert.equal(messages.filter(msg => msg === 'Higgsfield: ip_detected…').length, 2);
  console.log('REPRODUCED: ip_detected is emitted as progress and polled repeatedly.');
  const recovery = await hf.fetchHfMcpResult('diagnostic-job', __dirname);
  assert.equal(recovery.state, 'running');
  console.log('REPRODUCED: recovery classifies ip_detected as running.');
  status = 'rejected'; polls = 0;
  await assert.rejects(hf.runHfMcpRender(opts), /error @ higgsfield\/job: rejected/);
  assert.equal(polls, 1);
  assert.equal((await hf.fetchHfMcpResult('diagnostic-job', __dirname)).state, 'gone');
  console.log('CONTROL: known rejected status stops after one poll and recovery returns gone.');

  const storeFile = path.resolve(root, '../koan-shared/vidancer-ui/src/store.ts');
  const source = fs.readFileSync(storeFile, 'utf8');
  const start = source.indexOf('  setRunningJobMsg: (msg, pct, jobId) => {');
  const end = source.indexOf('  consumeJob:', start);
  assert.ok(start > 0 && end > start);
  const state = { queue: [
    { id: 'old-hf', inFlight: true, status: 'cancelled', msg: 'cancelling…' },
    { id: 'new-ark', inFlight: true, status: 'running', msg: 'rendering on modelark…' }
  ] };
  const exports = {};
  vm.runInNewContext(compile('export const actions = {\n' + source.slice(start, end) + '\n};'), { exports, set: fn => Object.assign(state, fn(state)) });
  const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8');
  const progressLine = main.split('\n').find(line => line.includes("onProgress: (m: string) => safeSend(e.sender, 'render:progress', { msg: m })"));
  assert.ok(progressLine, 'Cloud progress sender must match the actual unscoped source line');
  exports.actions.setRunningJobMsg('Higgsfield: ip_detected…');
  assert.equal(state.queue[1].msg, 'Higgsfield: ip_detected…');
  assert.equal(state.queue[0].msg, 'Higgsfield: ip_detected…');
  console.log('REPRODUCED: unscoped progress overwrites both a cancelled in-flight Higgsfield row and a new running ModelArk row.');
  exports.actions.setRunningJobMsg('rendering on modelark…', undefined, 'new-ark');
  assert.equal(state.queue[0].msg, 'Higgsfield: ip_detected…');
  assert.equal(state.queue[1].msg, 'rendering on modelark…');
  console.log('CONTROL: supplying a job ID isolates updates correctly.');
})().catch(error => { console.error(error); process.exitCode = 1; });
