import { createRequire } from 'node:module';
import { findAll } from './component.mjs';

// 与待测组件使用同一份 Vue / Element Plus；实际派发原生单选框事件。
export function writeModeControls(packageJson = new URL('../../package.json', import.meta.url)) {
  const { ElForm, ElRadioGroup, ElRadio, ID_INJECTION_KEY } = createRequire(packageJson)('element-plus');
  return { components: { 'el-form': ElForm, 'el-radio-group': ElRadioGroup, 'el-radio': ElRadio }, provides: [[ID_INJECTION_KEY, { prefix: 1, current: 0 }]] };
}
export function writeModeInput(root, value = 'append') {
  const input = findAll(root, node => node.type === 'input' && node.props.type === 'radio' && node.props.value === value)[0];
  if (!input) throw new Error(`未渲染写入方式 ${value}`);
  return input;
}
export function selectWriteMode(root, value) {
  const input = writeModeInput(root, value);
  // 浏览器不会向 disabled / inert 控件派发用户输入。
  for (let node = input; node; node = node.parent) {
    if (node.props?.inert != null || node.props?.disabled === true || node.props?.disabled === '') return false;
  }
  input.checked = true;
  for (const handler of input.events.change || []) handler({ target: input });
  input.props.onChange?.({ target: input });
  return true;
}

// 映射下拉仅模拟选择边界；表单、按钮、单选及 SFC watcher / 写入均使用实际实现。
export function mappingControls(packageJson = new URL('../../package.json', import.meta.url)) {
  const require = createRequire(packageJson);
  const { defineComponent, h } = require('vue'), { ElButton } = require('element-plus');
  const controls = writeModeControls(packageJson);
  controls.components['el-button'] = ElButton;
  controls.components['el-select'] = defineComponent({
    props: ['modelValue', 'disabled'], emits: ['update:modelValue'],
    setup: (props, { emit, slots }) => () => h('select', { value: props.modelValue, disabled: props.disabled, onChange: event => emit('update:modelValue', event.target.value) }, slots.default?.()),
  });
  controls.components['el-option'] = defineComponent({ props: ['value', 'label', 'disabled'], setup: props => () => h('option', { value: props.value, disabled: props.disabled }, props.label) });
  return controls;
}
const nodeText = node => (node.text || '') + (node.children || []).map(nodeText).join('');
export const mappingButtons = root => findAll(root, node => node.type === 'button' && (/添加字段映射|^删除$/.test(nodeText(node))));
function interactable(input) {
  if (!input) throw new Error('未渲染预期映射控件');
  for (let node = input; node; node = node.parent) if (node.props?.inert != null || node.props?.disabled === true || node.props?.disabled === '') return false;
  return true;
}
export function addMapping(root) {
  const input = mappingButtons(root).find(node => nodeText(node).includes('添加字段映射'));
  if (!interactable(input)) return false;
  input.props.onClick(new MouseEvent('click')); return true;
}
export function selectMappingTarget(root, value) {
  const select = findAll(root, node => node.type === 'select' && node.props.placeholder === '选择目标字段')[0];
  if (!interactable(select)) return false;
  if (!select.children.some(node => node.props?.value === value)) throw new Error('目标列不在可选列表');
  select.props.onChange({ target: { value } }); return true;
}
export function mappingEvents(t) {
  const previous = globalThis.MouseEvent;
  globalThis.MouseEvent ||= class extends Event {};
  t.after(() => { if (previous) globalThis.MouseEvent = previous; else delete globalThis.MouseEvent; });
}
