import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ElInput, ElCheckbox, ElCheckboxGroup } from 'element-plus';
import { FieldType, DateFormatter, NumberFormatter } from '@lark-base-open/js-sdk';
import { loadComponent, mountComponent, deferred, flush as flushVue, findAll } from './helpers/component.mjs';
import { mappingControls, mappingEvents } from './helpers/writeModeControls.mjs';

const flush = async () => { await new Promise(setImmediate); await flushVue(); };
const fieldsKey = 'comment_fetch_selected_fields_v1';
const stages = [[fieldsKey, '字段勾选'], ['api_key', '密钥'], ['note_url', '作品链接']];
const stored = { [fieldsKey]: ['cid', 'text'], api_key: 'test-saved-key', note_url: 'https://example.test/original' };
const text = node => (node.text || '') + (node.children || []).map(text).join('');
const button = (f, label) => findAll(f.root, node => node.type === 'button' && text(node).trim() === label)[0];
const execute = f => findAll(f.root, node => node.type === 'button' && node.props.class?.includes('commit-btn'))[0];
const blocked = node => {
  for (let n = node; n; n = n.parent) if (n.props?.inert != null || n.props?.disabled === true || n.props?.disabled === '') return true;
  return false;
};
function click(node) {
  assert.ok(node, '真实操作控件存在');
  if (blocked(node)) return false;
  node.props.onClick(new MouseEvent('click')); return true;
}
function inputUrl(f, value) {
  const node = findAll(f.root, node => node.type === 'textarea')[0];
  assert.ok(node);
  if (blocked(node)) return false;
  node.value = value; node.props.onInput({ target: node }); return true;
}
async function fixture(t, values = {}) {
  mappingEvents(t);
  const previousDocument = globalThis.document;
  globalThis.document ||= { activeElement: null };
  const gates = new Map(), reads = [], saves = [], requests = [], notices = [];
  const valuesByKey = { ...stored, ...values };
  const sdk = { FieldType, DateFormatter, NumberFormatter, bitable: {
    bridge: {
      getData: async key => { reads.push(key); return gates.has(key) ? gates.get(key).promise : structuredClone(valuesByKey[key]); },
      setData: async (key, value) => saves.push({ key, value: JSON.parse(JSON.stringify(value)) }),
    },
    base: { getTableList: async () => [], getTableMetaList: async () => [] },
  } };
  const component = await loadComponent(fileURLToPath(new URL('../src/components/Form.vue', import.meta.url)), {
    '@lark-base-open/js-sdk': sdk,
    '@/utils/request': { default: async config => { requests.push(config); return { data: { sta: 1, msg: '测试请求结束' } }; } },
    ElMessage: value => notices.push(value), ElNotification: value => notices.push(value),
    console: { log() {}, warn() {}, error() {} },
  });
  let mounted, unmounted = false;
  const unmount = () => { if (mounted && !unmounted) { unmounted = true; mounted.app.unmount(); } };
  const mount = async () => {
    const controls = mappingControls(new URL('../package.json', import.meta.url));
    mounted = mountComponent(component, { ...controls, components: {
      ...controls.components,
      'el-input': ElInput, 'el-checkbox': ElCheckbox, 'el-checkbox-group': ElCheckboxGroup,
    } });
    await flush();
    return { ...mounted, unmount, reads, saves, requests, notices, gates, sdk, values: valuesByKey };
  };
  t.after(async () => {
    unmount(); for (const [key, gate] of gates) gate.resolve(valuesByKey[key]); await flush();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  return { gates, mount };
}

for (const [key, label] of stages) {
  test(`真实Vue初始化：${label}延迟时锁定编辑、执行及保存，读取成功后使用完整配置`, async t => {
    const pending = deferred(), setup = await fixture(t); setup.gates.set(key, pending);
    const f = await setup.mount(), s = f.state;
    assert.equal(text(execute(f)).trim(), '准备中…');
    assert.ok(blocked(execute(f))); assert.equal(click(execute(f)), false);
    assert.equal(inputUrl(f, 'https://example.test/too-early'), false);
    const output = findAll(f.root, node => node.type === 'label' && text(node).trim() === '评论内容')[0];
    assert.ok(output); assert.ok(blocked(findAll(output, node => node.type === 'input')[0]));
    const editor = findAll(f.root, node => node.type === 'img' && node.props['aria-disabled'] != null)[0];
    editor.props.onClick(); await flush(); assert.equal(s.api_key_disabled.value, true);
    await s.commit(); await s.saveApiKey();
    assert.equal(f.notices.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.saves.length, 0);
    pending.resolve(stored[key]); await flush(); await flush();
    assert.equal(s.fieldSelectionReady.value, true);
    assert.equal(s.api_key.value, stored.api_key); assert.equal(s.formData.value.url, stored.note_url);
    assert.deepEqual(s.selectedFieldKeys.value, stored[fieldsKey]);
    assert.equal(text(execute(f)).trim(), '立即执行'); assert.equal(blocked(execute(f)), false);
    assert.equal(inputUrl(f, 'https://example.test/edited'), true); await flush();
    assert.equal(click(execute(f)), true); await flush(); await flush();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].headers.authorization, `Bearer ${stored.api_key}`);
    assert.equal(f.requests[0].data.url, 'https://example.test/edited');
  });

  test(`真实Vue初始化：${label}读取失败保留原错，原页延迟重试成功后解锁`, async t => {
    const failed = deferred(), setup = await fixture(t); setup.gates.set(key, failed);
    const f = await setup.mount(); failed.reject(new Error(`${label}读取原错`)); await flush();
    assert.equal(f.state.fieldSelectionReady.value, false);
    assert.match(text(f.root), new RegExp(`${label}读取原错`));
    assert.equal(text(execute(f)).trim(), '立即执行'); assert.ok(blocked(execute(f)));
    assert.equal(inputUrl(f, 'https://example.test/too-early'), false);
    const retry = deferred(); f.gates.set(key, retry);
    assert.ok(click(button(f, '重试'))); await flush();
    assert.equal(text(execute(f)).trim(), '准备中…'); assert.ok(blocked(execute(f)));
    assert.doesNotMatch(text(f.root), new RegExp(`${label}读取原错`));
    const reads = [...f.reads]; await f.state.loadInitialConfig(); assert.deepEqual(f.reads, reads, '在途读取不会重复执行');
    retry.resolve(stored[key]); await flush(); await flush();
    assert.equal(f.state.fieldSelectionReady.value, true); assert.equal(blocked(execute(f)), false);
    assert.equal(button(f, '重试'), undefined); assert.equal(f.notices.length, 0);
    assert.equal(f.requests.length, 0); assert.equal(f.saves.length, 0);
  });

  for (const outcome of ['成功', '失败']) {
    test(`真实Vue初始化：${label}等待期间卸载，迟到${outcome}不更新、不读取下一项`, async t => {
      const pending = deferred(), setup = await fixture(t); setup.gates.set(key, pending);
      const f = await setup.mount(), s = f.state;
      f.unmount();
      const before = { fields: [...s.selectedFieldKeys.value], key: s.api_key.value, url: s.formData.value.url, reads: [...f.reads] };
      if (outcome === '成功') pending.resolve(stored[key]); else pending.reject(new Error('卸载后失败'));
      await flush(); await flush();
      assert.equal(s.fieldSelectionReady.value, false); assert.deepEqual([...s.selectedFieldKeys.value], before.fields);
      assert.equal(s.api_key.value, before.key); assert.equal(s.formData.value.url, before.url);
      assert.deepEqual(f.reads, before.reads); assert.equal(f.saves.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.notices.length, 0);
    });
  }
}

for (const apiKey of [undefined, '__cleared__']) {
  test(`真实Vue初始化：成功读取${apiKey ? '清除标记' : '空密钥'}后才提示配置密钥`, async t => {
    const setup = await fixture(t, { api_key: apiKey }), f = await setup.mount();
    assert.equal(f.state.fieldSelectionReady.value, true); assert.equal(blocked(execute(f)), false);
    assert.ok(click(execute(f))); await flush();
    assert.equal(f.notices.at(-1).message, '请输入 API Key'); assert.equal(f.requests.length, 0);
  });
}

test('真实Vue初始化：重试再次失败显示本次原因，继续同页重试成功', async t => {
  const first = deferred(), setup = await fixture(t); setup.gates.set('api_key', first);
  const f = await setup.mount(); first.reject(new Error('第一次读取失败')); await flush();
  assert.match(text(f.root), /第一次读取失败/);
  const next = deferred(); f.gates.set('api_key', next);
  assert.ok(click(button(f, '重试'))); await flush(); next.reject(new Error('第二次读取失败')); await flush();
  assert.match(text(f.root), /第二次读取失败/); assert.doesNotMatch(text(f.root), /第一次读取失败/);
  assert.ok(blocked(execute(f))); assert.equal(f.notices.length, 0);
  f.gates.delete('api_key'); assert.ok(click(button(f, '重试'))); await flush(); await flush();
  assert.equal(f.state.fieldSelectionReady.value, true); assert.equal(blocked(execute(f)), false);
  assert.equal(button(f, '重试'), undefined); assert.equal(f.requests.length, 0); assert.equal(f.saves.length, 0);
});
