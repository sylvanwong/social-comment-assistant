import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Vue from 'vue';
import { ID_INJECTION_KEY } from 'element-plus';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

// Compile the real SFC; substitute only the external SDK/HTTP/UI notification boundaries.
export async function loadComponent(filename, overrides = {}) {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const script = compileScript(descriptor, { id: 'test-component', genDefaultAs: '__component' });
  const bindings = Object.fromEntries(Object.entries(overrides).filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name)));
  let body = script.content;
  for (const node of parseJS(body, { sourceType: 'module' }).program.body.filter(n => n.type === 'ImportDeclaration').reverse()) {
    let dependency = overrides[node.source.value];
    if (!dependency) {
      const source = node.source.value;
      dependency = source === 'vue' ? Vue : source.endsWith('.vue')
        ? { default: await loadComponent(path.resolve(path.dirname(filename), source), overrides) }
        : await import(source.startsWith('.') ? pathToFileURL(path.resolve(path.dirname(filename), source)).href : source);
    }
    for (const specifier of node.specifiers) bindings[specifier.local.name] = specifier.type === 'ImportDefaultSpecifier' ? dependency.default : dependency[specifier.imported.name];
    body = body.slice(0, node.start) + body.slice(node.end);
  }
  const component = new Function(...Object.keys(bindings), `${body};return __component`)(...Object.values(bindings));
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'test-component', compilerOptions: { bindingMetadata: script.bindings } });
  assertNoErrors(template.errors);
  const templateBody = template.code.replace(/import \{([^}]+)\} from "vue"/, (_, names) => `const {${names.replace(/ as /g, ': ')}} = Vue`).replace('export function render', 'function render');
  component.render = new Function('Vue', `${templateBody};return render`)(Vue);
  return component;
}
function assertNoErrors(errors) { if (errors.length) throw new Error(errors.join('\n')); }
export function mountComponent(component, { components = {}, provides = [], runtime = Vue } = {}) {
  let state;
  const setup = component.setup;
  component.setup = (props, context) => { state = setup(props, context); return state; };
  const renderer = runtime.createRenderer({
    createElement: type => ({ type, children: [], props: {}, style: {}, parent: null, events: {},
      addEventListener(name, handler) { (this.events[name] ||= []).push(handler); },
      removeEventListener(name, handler) { this.events[name] = (this.events[name] || []).filter(item => item !== handler); },
      querySelectorAll() { return findAll(this, node => node.type === 'input' && node.props.type === 'radio'); },
      setAttribute(name, value) { this.props[name] = value; }, removeAttribute(name) { delete this.props[name]; },
    }),
    createText: text => ({ text, parent: null }), createComment: text => ({ comment: text, parent: null }),
    setText: (n, text) => { n.text = text; }, setElementText: (n, text) => { n.text = text; n.children = []; },
    patchProp: (n, key, prev, value) => { n.props[key] = value; if (key === 'value') n.value = n._value = value; },
    insert(n, parent, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = parent; const i = anchor ? parent.children.indexOf(anchor) : -1; if (i < 0) parent.children.push(n); else parent.children.splice(i, 0, n); },
    remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
  });
  const app = renderer.createApp(component);
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 });
  for (const [key, value] of provides) app.provide(key, value);
  // 默认保留轻量槽位；交互回归可显式注册真实 Element Plus 控件。
  for (const name of ['el-input', 'el-form', 'el-form-item', 'el-radio-group', 'el-radio', 'el-select', 'el-option', 'el-tooltip', 'el-checkbox-group', 'el-checkbox', 'el-button']) {
    app.component(name, components[name] || { setup: (_, { slots }) => () => runtime.h('div', {}, slots.default?.()) });
  }
  const root = { children: [] };
  app.mount(root);
  return { state, app, root };
}
export const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await Vue.nextTick(); };
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
export function findAll(root, predicate) { return [...(predicate(root) ? [root] : []), ...(root.children || []).flatMap(child => findAll(child, predicate))]; }
