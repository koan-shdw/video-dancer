// list 14 stage 4 (2026-09-30) — the Co-Director on a VENICE key (claudeWire.ts): a Messages request
// is translated to Venice's OpenAI-shaped chat API and the reply translated back, so the real tool
// loop (codirSend), the sub-calls (COMPACT, compose digests) and everything above them run unchanged.
// An Anthropic key still posts to Anthropic exactly as before. Network mocked: nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), assert = require('node:assert/strict')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-wire-'))
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
const electron = { app: { getPath: () => tmp, getVersion: () => '0' }, shell: { openExternal: async () => {} }, safeStorage: {}, BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} } }
const runtime = { streamBodyToFile: async (body, file) => { const b = Buffer.from(await new Response(body).arrayBuffer()); fs.writeFileSync(file, b); return b.length } }
let m
const load = async () => {
  const out = await require('esbuild').build({ stdin: { contents: `export * from '${main}/claudeWire'; export * from '${main}/openaiWire'; export { codirSend, setExchangeDir, resolveVeniceModel, CODIR_VENICE_MODELS } from '${main}/codir'; export { runSubCalls } from '${main}/subcall'; export { newProject, getProject } from '${main}/project'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['@fal-ai/client', 'ffmpeg-static', 'electron', './runtime'], logLevel: 'silent', plugins: [raw] })
  const mod = { exports: {} }
  vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? electron : n === '@fal-ai/client' ? { fal: { config: () => {} } } : n === './runtime' ? runtime : require(n)), mod, mod.exports)
  m = mod.exports
}

const calls = []
let answer = () => ({ status: 200, body: {} })
global.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
  const a = answer(calls.length, calls.at(-1))
  return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: a.headers ?? {} })
}
const chat = (message, finish = 'stop', usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } }) => ({ status: 200, body: { choices: [{ message: { role: 'assistant', ...message }, finish_reason: finish }], usage } })

;(async () => {
  await load()
  // ---- the request, translated ----
  const body = {
    model: 'claude-sonnet-5-5',
    max_tokens: 16000,
    system: [{ type: 'text', text: 'You are the Co-Director.', cache_control: { type: 'ephemeral' } }],
    tools: [{ name: 'create_clip', description: 'make a clip', input_schema: { type: 'object', properties: { name: { type: 'string' } } } }],
    messages: [
      { role: 'user', content: 'earlier ask' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: '(the image above is @kata)' }, { type: 'text', text: 'make a clip', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'call_1', name: 'create_clip', input: { name: 'Opening' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'created clip_id=c1' }] }
    ]
  }
  assert.deepEqual(m.toChatCompletions(body), {
    model: 'claude-sonnet-5-5',
    messages: [
      { role: 'system', content: 'You are the Co-Director.' },
      { role: 'user', content: 'earlier ask' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'text', text: '(the image above is @kata)' }, { type: 'text', text: 'make a clip' }] },
      { role: 'assistant', content: 'On it.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'create_clip', arguments: '{"name":"Opening"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'created clip_id=c1' }
    ],
    max_completion_tokens: 16000,
    tools: [{ type: 'function', function: { name: 'create_clip', description: 'make a clip', parameters: { type: 'object', properties: { name: { type: 'string' } } } } }],
    venice_parameters: { include_venice_system_prompt: false }
  })
  assert.equal(m.toChatCompletions({ model: 'claude-haiku-4-5', messages: [] }).model, 'claude-sonnet-5', 'Venice has no Haiku: the cheap tier rides Sonnet 5')

  // ---- the reply, translated back ----
  assert.deepEqual(m.fromChatCompletions(chat({ content: 'Done.', tool_calls: [{ id: 'c9', type: 'function', function: { name: 'create_clip', arguments: '{"name":"A"}' } }] }, 'tool_calls').body), {
    content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', id: 'c9', name: 'create_clip', input: { name: 'A' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 0 }
  })
  assert.equal(m.fromChatCompletions(chat({ content: 'cut off' }, 'length').body).stop_reason, 'max_tokens')
  assert.equal(m.fromChatCompletions(chat({ content: null }, 'content_filter').body).stop_reason, 'refusal')
  assert.equal(m.fromChatCompletions(chat({ content: [{ type: 'text', text: 'in ' }, { type: 'text', text: 'parts' }] }).body).content[0].text, 'in parts')
  assert.deepEqual(m.fromChatCompletions(chat({ content: null, tool_calls: [{ id: 'x', function: { name: 't', arguments: 'not json' } }] }, 'tool_calls').body).content[0].input, {}, 'unreadable arguments = an empty input, never a crash')

  // ---- the wire: whose key, whose door ----
  answer = () => ({ status: 200, body: { content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' } })
  await m.postMessages('sk-ant-real', { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] })
  assert.equal(calls.at(-1).url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls.at(-1).headers['x-api-key'], 'sk-ant-real')
  assert.deepEqual(calls.at(-1).body, { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }, 'an Anthropic key: the request goes out untouched')
  answer = () => chat({ content: 'ciao' })
  const vr = await m.postMessages(m.VENICE_TAG + 'vk', { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] })
  assert.equal(calls.at(-1).url, 'https://api.venice.ai/api/v1/chat/completions')
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer vk')
  assert.equal((await vr.json()).content[0].text, 'ciao')
  answer = () => ({ status: 402, body: { error: 'Insufficient balance' }, headers: { 'retry-after': '7' } })
  const bad = await m.postMessages(m.VENICE_TAG + 'vk', { model: 'x', messages: [] })
  assert.equal(bad.status, 402)
  assert.equal(bad.headers.get('retry-after'), '7')
  assert.match((await bad.json()).error.message, /^Venice: Insufficient balance — out of Venice credit/)

  // ---- sub-calls (COMPACT, compose digests) on the Venice key ----
  answer = () => chat({ content: 'a digest' })
  const sub = await m.runSubCalls([{ id: 'd', prompt: 'digest this' }], { engine: 'api', apiKey: m.VENICE_TAG + 'vk' })
  assert.deepEqual(sub.results, [{ id: 'd', ok: true, text: 'a digest' }])
  assert.equal(calls.at(-1).body.model, 'claude-sonnet-5')

  // ---- the real tool loop, two tool rounds, on the Venice key ----
  await m.newProject(tmp, 'Wire')
  m.setExchangeDir(m.getProject().dir)
  calls.length = 0
  answer = (n) =>
    n === 1 ? chat({ content: 'Making it.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_clip', arguments: '{"name":"Opening"}' } }] }, 'tool_calls')
    : n === 2 ? chat({ content: null, tool_calls: [{ id: 't2', type: 'function', function: { name: 'update_brief', arguments: '{"brief":"Opening = the first shot."}' } }] }, 'tool_calls')
    : chat({ content: 'The clip is in the Bin and the brief is updated.' })
  const events = []
  const r = await m.codirSend({ text: 'make an opening clip', imageIds: [], selectedClipId: null, focus: null, apiKey: m.VENICE_TAG + 'vk', model: m.resolveVeniceModel(undefined) }, (ev) => events.push(ev), () => {})
  assert.equal(r.ok, true, r.error)
  assert.equal(calls.length, 3, 'two tool rounds + the closing turn')
  assert.ok(calls.every((c) => c.url === 'https://api.venice.ai/api/v1/chat/completions'))
  assert.equal(calls[0].body.model, 'claude-sonnet-5-5', 'the Venice lane defaults to Sonnet 5.5')
  assert.equal(calls[0].body.messages[0].role, 'system')
  assert.ok(calls[0].body.tools.some((t) => t.function.name === 'create_clip'), 'the app’s tools ride as functions')
  const round2 = calls[1].body.messages
  assert.deepEqual(round2.at(-2).tool_calls.map((t) => t.id), ['t1'], 'round 2 re-sends the call …')
  assert.equal(round2.at(-1).role, 'tool')
  assert.equal(round2.at(-1).tool_call_id, 't1')
  assert.match(round2.at(-1).content, /^created clip_id=/, '… and its result, keyed to it')
  assert.ok(m.getProject().clips.some((c) => c.name === 'Opening'), 'the clip was really created')
  assert.equal(m.getProject().codir.brief, 'Opening = the first shot.')
  assert.equal(r.reply, 'Making it.\n\nThe clip is in the Bin and the brief is updated.')
  assert.deepEqual({ i: r.usage.inputTokens, o: r.usage.outputTokens, c: r.usage.cacheReadTokens, rounds: r.usage.rounds }, { i: 120, o: 60, c: 180, rounds: 3 })
  assert.deepEqual(m.CODIR_VENICE_MODELS.map((x) => x.id).slice(0, 3), ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'])

  console.log('PASS Co-Director on a Venice key: requests and replies translated both ways, an Anthropic key untouched, sub-calls, and the real tool loop (two tool rounds) writing the project')
  const mapped = m.toResponses({ ...body, model: 'gpt-6.1-sol', output_config: { effort: 'high' } })
  assert.deepEqual([mapped.model, mapped.store, mapped.include, mapped.reasoning], ['gpt-6.1-sol', false, ['reasoning.encrypted_content'], { effort: 'high' }])
  assert.ok(mapped.input.some(x => x.content?.[0]?.type === 'input_image'), 'images reach Responses')
  assert.equal(mapped.tools[0].strict, false, 'existing optional tool fields remain optional')
  assert.equal(mapped.input.at(-1).call_id, 'call_1')
  assert.deepEqual(m.toResponses({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'image', content: [{ type: 'image', source: { media_type: 'image/png', data: 'AAAA' } }] }] }] }).input[0].output[0], { type: 'input_image', image_url: 'data:image/png;base64,AAAA' })
  for (const arguments of ['not-json', '[]', 'null']) assert.throws(() => m.fromResponses({ output: [{ type: 'function_call', call_id: 'c', name: 'create_clip', arguments }] }), /invalid tool arguments/)
  assert.throws(() => m.fromResponses({ output: [{ type: 'function_call', arguments: '{}' }] }), /invalid tool call/)
  assert.throws(() => m.fromResponses({ status: 'failed', error: { message: 'refused' } }), /refused/)
  assert.equal(m.fromResponses({ status: 'incomplete' }).stop_reason, 'max_tokens')
  await m.newProject(tmp, 'OpenAI Wire'); m.setExchangeDir(m.getProject().dir); calls.length = 0
  const output = [{ type: 'reasoning', id: 'rs1', encrypted_content: 'opaque', summary: [] }, { type: 'message', id: 'msg1', role: 'assistant', status: 'completed', phase: 'commentary', content: [{ type: 'output_text', text: 'Creating the opening.', annotations: [] }] }, { type: 'function_call', id: 'fc1', call_id: 'o1', name: 'create_clip', arguments: '{"name":"OpenAI opening"}', status: 'completed' }]
  answer = n => ({ body: { status: 'completed', output: n === 1 ? output : [{ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Done.' }] }], usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 60 } } } })
  const oa = await m.codirSend({ text: 'create the opening clip', imageIds: [], selectedClipId: null, focus: null, apiKey: 'openai:fake-key', model: 'gpt-6.1-sol' }, () => {}, () => {})
  assert.equal(oa.ok, true, oa.error)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(c => c.url === 'https://api.openai.com/v1/responses' && c.headers.Authorization === 'Bearer fake-key'))
  assert.ok(m.getProject().clips.some(c => c.name === 'OpenAI opening'), 'Responses call uses the real project tool')
  assert.deepEqual(calls[1].body.input.slice(-4, -1), output, 'reasoning, phase and original call are replayed unchanged')
  assert.equal(calls[1].body.input.at(-1).type, 'function_call_output')
  assert.equal(calls[1].body.input.at(-1).call_id, 'o1')
  assert.deepEqual([oa.usage.inputTokens, oa.usage.outputTokens, oa.usage.cacheReadTokens], [80, 40, 120])
  assert.equal(oa.reply, 'Creating the opening.\n\nDone.')
  calls.length = 0
  assert.equal((await m.runSubCalls([{ id: 'digest', prompt: 'digest' }], { engine: 'api', apiKey: 'openai:fake-key' })).results[0].ok, true)
  assert.equal(calls[0].body.model, 'gpt-6.1-sol')
  answer = () => ({ status: 401, body: { error: { message: 'invalid key' } } })
  assert.equal((await m.postMessages('openai:bad', body)).status, 401)
  assert.equal((await m.validateLlmKey('openai', 'bad')).ok, false)
  assert.equal(calls.at(-1).url, 'https://api.openai.com/v1/models')
  assert.equal(calls.at(-1).body, undefined, 'validation makes no generation request')
  console.log('PASS OpenAI Responses: images, tools, stateless reasoning replay, real project writes, token accounting, subcalls, invalid calls and free key validation')
})().catch((e) => { console.error(e); process.exitCode = 1 })
