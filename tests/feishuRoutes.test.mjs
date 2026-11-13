import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadEnv, loadConfigFromFile } from 'vite';
import { FieldType, DateFormatter, NumberFormatter } from '@lark-base-open/js-sdk';
import { loadComponent, mountComponent, flush } from './helpers/component.mjs';
import { loadRequestModule } from './helpers/feishuRequest.mjs';

for (const [mode, base] of [['production', 'https://api.socialdatax.com'], ['test', 'https://test-lotto.weiyoubot.cn'], ['development', '']]) {
  test(`${mode} 评论创建、查询、停止和结果共用新后端，保留鉴权和分页参数`, async t => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const api = loadRequestModule(loadEnv(mode, root, ''));
    const calls = [];
    api.service.defaults.adapter = async config => {
      calls.push({ ...config, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data });
      const data = config.url.endsWith('/list') ? { sta: 1, msg: '结束测试结果读取' } : { sta: 0, data: config.method === 'post' ? { task_id: 'task/id' } : { status: 0 } };
      return { config, status: 200, data };
    };
    const sdk = { FieldType, DateFormatter, NumberFormatter, bitable: {
      bridge: { getData: async key => key === 'api_key' ? 'test-only' : undefined, setData: async () => {} },
      base: { getTableList: async () => [], getTableMetaList: async () => [] },
    } };
    const component = await loadComponent(fileURLToPath(new URL('../src/components/Form.vue', import.meta.url)), {
      '@lark-base-open/js-sdk': sdk, '@/utils/request': { ...api, default: api.service },
      ElMessage() {}, ElNotification() {}, console: { log() {}, warn() {}, error() {} },
    });
    const host = mountComponent(component); t.after(() => host.app.unmount()); await flush();
    t.mock.method(globalThis, 'setInterval', () => 1);
    t.mock.method(globalThis, 'clearInterval', () => {});
    const view = host.state;
    view.formData.value.url = 'https://example.com/note';
    view.formData.value.pages = 2;
    view.formData.value.reply_pages = -1;
    view.loading.value = true;
    await view.postNoteTask();
    await view.getNoteTask('task/id');
    await view.cancelCommentTask();
    await view.getList('task/id');
    assert.deepEqual(calls.map(c => c.url), [
      '/socialdatax/api/v1/feishu/comment/task',
      '/socialdatax/api/v1/feishu/comment/task?task_id=task%2Fid',
      '/socialdatax/api/v1/feishu/comment/task/cancel',
      '/socialdatax/api/v1/feishu/comment/list',
    ]);
    assert.ok(calls.every(c => c.baseURL === base && c.headers.authorization === 'Bearer test-only'));
    assert.deepEqual(calls[0].data, { url: 'https://example.com/note', pages: 2, reply_pages: -1, version: 'test-version' });
    assert.equal(calls[1].params.supports_partial_results, 1);
    assert.equal(calls[1].params.version, 'test-version');
    assert.equal(calls[2].data.task_id, 'task/id');
    assert.equal(calls[3].data.page, 1);
    assert.equal(calls[3].data.version, 'test-version');
    assert.equal(calls[0].timeout, 30000);
  });
}

test('评论开发代理支持新旧前缀', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' }, `${root}/vite.config.js`, root);
  assert.equal(config.server.proxy['/socialdatax/api'].target, 'https://test-lotto.weiyoubot.cn');
  assert.equal(config.server.proxy['/social/api'].target, 'https://test-lotto.weiyoubot.cn');
});
