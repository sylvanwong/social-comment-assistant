<script setup>
import { resolveWritableField } from "../utils/tableFields.js";
import { bitable, DateFormatter, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { computed, ref, nextTick, onMounted, onUnmounted, watch } from "vue";
import request from '@/utils/request'
import TaskFeedback from './TaskFeedback.vue';
import { useTaskFeedback } from '../composables/useTaskFeedback.mjs';

let note_timer = null;
let disposed = false;
const assertActive = () => { if (disposed) throw new Error('页面已卸载'); };
const activeCommentTaskId = ref('');
const cancelling = ref(false);
let latestTaskStatus = null;
const API_KEY_CLEARED_MARKER = "__cleared__";

const api_key = ref("");
const api_key_disabled = ref(true);
const apiKeySaving = ref(false);

const formData = ref({
  radio: 1, url: "",
  // social_type: "xhs",
  pages: 1,
  reply_pages: -1,
  table_id: "",
});
const table_options = ref([]);
const EXISTING_TABLE_REQUIRED_FIELD = "评论ID";
const FIELD_SELECTION_STORAGE_KEY = 'comment_fetch_selected_fields_v1';
const FIELD_CONFIG = [
  { key: "cid", name: "评论ID", type: FieldType.Text, required: true, getValue: (item) => item?.cid ?? "" },
  { key: "reply_id", name: "上级评论ID", type: FieldType.Text, getValue: (item) => item?.reply_id ?? "" },
  { key: "note_id", name: "作品ID", type: FieldType.Text, getValue: (item) => item?.note_id ?? "" },
  { key: "note_url", name: "作品链接", legacyNames: ["视频链接"], type: FieldType.Url, getValue: (item) => item?.note_url ?? "" },
  { key: "social_type", name: "平台", type: FieldType.Text, getValue: (item) => item?.social_type ?? "" },
  { key: "text", name: "评论内容", type: FieldType.Text, getValue: (item) => item?.text ?? "" },
  { key: "nickname", name: "评论者名称", legacyNames: ["作者名称"], type: FieldType.Text, getValue: (item) => item?.nickname ?? "" },
  { key: "social_user_number", name: "评论者账号", legacyNames: ["小红书ID"], type: FieldType.Text, getValue: (item) => item?.social_user_number ?? "" },
  { key: "uid", name: "评论者ID", legacyNames: ["作者ID"], type: FieldType.Text, getValue: (item) => item?.uid ?? "" },
  { key: "profile_url", name: "评论者主页链接", legacyNames: ["作者主页链接"], type: FieldType.Url, getValue: (item) => item?.profile_url ?? "" },
  { key: "avatar", name: "评论者头像", type: FieldType.Text, getValue: (item) => item?.avatar ?? "" },
  { key: "ip_label", name: "IP属地", type: FieldType.Text, getValue: (item) => item?.ip_label ?? "" },
  { key: "digg_count", name: "点赞数", type: FieldType.Number, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.digg_count) || 0 },
  { key: "reply_comment_total", name: "回复数", type: FieldType.Number, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.reply_comment_total) || 0 },
  { key: "t_create", name: "评论时间", type: FieldType.DateTime, dateFormat: DateFormatter.DATE_TIME, getValue: (item) => (item?.t_create == null || item.t_create === '' ? null : item.t_create * 1000) },
];
const selectedFieldKeys = ref([]);
const fieldSelectionReady = ref(false);
const initializationError = ref('');
const initializing = computed(() => !fieldSelectionReady.value && !initializationError.value);
// 字段类型名称映射
const FIELD_TYPE_NAME = {
  [FieldType.Text]: 'Text',
  [FieldType.Number]: 'Number',
  [FieldType.SingleSelect]: 'SingleSelect',
  [FieldType.DateTime]: 'DateTime',
  [FieldType.Url]: 'Url',
  [FieldType.Attachment]: 'Attachment',
};

const SINGLE_SELECT_COMPATIBLE_FIELDS = new Set(["评论者名称", "平台"]);

const getAllowedFieldTypes = (config) => {
  if (config.key === 'note_url' || config.key === 'profile_url') {
    return [FieldType.Url, FieldType.Text];
  }
  if (config.type === FieldType.Number) {
    return [FieldType.Number, FieldType.Text];
  }
  if (SINGLE_SELECT_COMPATIBLE_FIELDS.has(config.name)) {
    return [FieldType.Text, FieldType.SingleSelect];
  }
  return [config.type];
};

const isFieldTypeCompatible = (fieldType, config) => {
  return getAllowedFieldTypes(config).includes(fieldType);
};

const getFieldWriteValue = (config, item, fieldType) => {
  const value = config.getValue(item);
  if ((fieldType === FieldType.Number || fieldType === FieldType.DateTime) && (value == null || value === '')) return null;
  if (config.type === FieldType.Number && fieldType === FieldType.Text) {
    return String(value ?? '');
  }
  if (SINGLE_SELECT_COMPATIBLE_FIELDS.has(config.name) && fieldType === FieldType.SingleSelect) {
    return value || null;
  }
  return value;
};

const reply_pages_options = ref([
  {
    value: -1,
    label: "不获取",
  },
  {
    value: 0,
    label: "获取全部",
  },
  {
    value: 1,
    label: "仅获取首页",
  },
  {
    value: 5,
    label: "获取前5页",
  },
  {
    value: 10,
    label: "获取前10页",
  },
  {
    value: 20,
    label: "获取前20页",
  },
  {
    value: 30,
    label: "获取前30页",
  },
  {
    value: 50,
    label: "获取前50页",
  },
]);
const pages_options = ref([
  {
    value: 0,
    label: "获取全部",
  },
  {
    value: 1,
    label: "仅获取首页",
  },
  {
    value: 5,
    label: "获取前5页",
  },
  {
    value: 10,
    label: "获取前10页",
  },
  {
    value: 20,
    label: "获取前20页",
  },
  {
    value: 30,
    label: "获取前30页",
  },
  {
    value: 50,
    label: "获取前50页",
  },
]);
// const social_type_options = ref([
//   {
//     value: "xhs",
//     label: "小红书",
//   },
//   {
//     value: "douyin",
//     label: "抖音",
//   },
// ]);

const loading = ref(false);
const busy = computed(() => !fieldSelectionReady.value || loading.value || apiKeySaving.value);
const { toastVisible, toastText, toastType, toastLoading, taskNotice, noticeRequiresReopen, begin, progress, finish, fail } = useTaskFeedback();
const tableOptionsError = ref('');
let writtenCommentCount = 0;
let taskFailureMessage = '';
let page = 1;
const page_size = 20;
let total = 0;

let initializationPending = false;
const loadInitialConfig = async () => {
  if (disposed || initializationPending || fieldSelectionReady.value) return;
  initializationPending = true;
  initializationError.value = '';
  try {
    await loadSelectedFieldKeys();
    assertActive();
    const key = await bitable.bridge.getData("api_key");
    assertActive();
    const noteUrl = await bitable.bridge.getData("note_url");
    assertActive();
    api_key.value = typeof key === 'string' && key.trim() !== API_KEY_CLEARED_MARKER ? key.trim() : '';
    formData.value.url = typeof noteUrl === 'string' ? noteUrl : '';
    fieldSelectionReady.value = true;
  } catch (error) {
    if (!disposed) initializationError.value = error?.message || String(error || '读取插件配置失败，请重试');
  } finally {
    initializationPending = false;
  }
};
onMounted(loadInitialConfig);

const loadTableOptions = async () => {
  tableOptionsError.value = '';
  try {
    const tableList = await bitable.base.getTableList();
    const options = await Promise.all(
      tableList.map(async (table) => {
        const id = table?.id || table?.tableId || (typeof table?.getId === "function" ? await table.getId() : "");
        const name = typeof table?.getName === "function" ? await table.getName() : (table?.name || id);
        return { id, name };
      })
    );
    table_options.value = options.filter(item => !!item.id);
  } catch (error) {
    console.error("获取表格列表失败:", error);
    tableOptionsError.value = error?.message || '获取表格列表失败，请稍后重试';
  }
};

watch(
  () => formData.value.radio,
  (radio) => {
    if (radio === 2) {
      loadTableOptions();
    } else {
      formData.value.table_id = "";
    }
  }
);

onUnmounted(() => {
  disposed = true;
  closeNoteInterval();
});

const getDefaultSelectedFieldKeys = () => FIELD_CONFIG.map(field => field.key);

const getActiveFieldConfigs = () => {
  const selectedKeys = new Set(selectedFieldKeys.value);
  return FIELD_CONFIG.filter(field => field.required || selectedKeys.has(field.key));
};

const loadSelectedFieldKeys = async () => {
  const savedKeys = await bitable.bridge.getData(FIELD_SELECTION_STORAGE_KEY);
  assertActive();
  const validKeys = Array.isArray(savedKeys)
    ? savedKeys.filter(key => FIELD_CONFIG.some(field => field.key === key))
    : getDefaultSelectedFieldKeys();
  selectedFieldKeys.value = Array.from(new Set([
    ...validKeys,
    ...FIELD_CONFIG.filter(field => field.required).map(field => field.key),
  ]));
};

const saveApiKey = async () => {
  if (disposed || !fieldSelectionReady.value || loading.value || apiKeySaving.value) return;
  apiKeySaving.value = true;
  const normalizedKey = String(api_key.value || "").trim();
  try {
    api_key_disabled.value = true;
    api_key.value = normalizedKey;
    await bitable.bridge.setData("api_key", normalizedKey || API_KEY_CLEARED_MARKER);
    if (normalizedKey) ElMessage({ message: "保存成功", type: "success", plain: true, duration: 3000 });
  } catch (error) {
    ElMessage({ message: error?.message || "保存 API Key 失败，请重试", type: "error", plain: true, duration: 5000 });
  } finally {
    apiKeySaving.value = false;
  }
};

const resetParams = () => {
  loading.value = false;
  cancelling.value = false;
  page = 1;
  total = 0;
};

const finishCommentWrite = (taskStatus, hasComments = writtenCommentCount > 0) => {
  resetParams();
  if (taskStatus == 3) {
    finish(`任务已停止，已写入 ${writtenCommentCount} 条评论`, { stopped: true });
  } else if (taskStatus == 2) {
    fail(`${taskFailureMessage || '评论获取未完成'}，${hasComments ? `已写入 ${writtenCommentCount} 条评论` : '未获取到评论'}`);
  } else if (!hasComments) {
    finish('未获取到评论', { empty: true });
  } else {
    finish(`处理完成，已写入 ${writtenCommentCount} 条评论`);
  }
};

// 写入数据: 新建表格
const createAndWriteData = async (list, type, task_id, targetTableId = "", taskStatus = 1) => {
  if (disposed) return;
  if (!Array.isArray(list)) {
    resetParams();
    fail('获取数据异常，请稍后重试');
    return;
  }
  if (list.length === 0) {
    finishCommentWrite(taskStatus);
    return;
  }
  progress(`正在写入 ${list.length} 条评论，已写入 ${writtenCommentCount} 条评论`, { stopping: taskStatus == 3 });
  try {
    const activeFieldConfigs = getActiveFieldConfigs();
    const fields = activeFieldConfigs.map(({ name, type, formatter, dateFormat }) => {
      const field = { name, type };
      if (formatter) field.formatter = formatter;
      if (dateFormat) field.dateFormat = dateFormat;
      return field;
    });
    // console.log("🚀 ~ createAndWriteData ~ fields:", fields)
    // 创建表格，创建表格中的字段
    if (!type && !targetTableId) { // 第一次请求且为新建表格
      let tableName = '';
      // const firstItem = list[0];
      tableName = '社媒评论加载工具';

      // 创建表格
      const { tableId, index } = await createSequentialTable(tableName);
      assertActive();
      const newTable = await bitable.base.getTable(tableId);
      assertActive();
      // console.log("🚀 ~ createAndWriteData ~ newTable:", newTable)
      await bitable.ui.switchToTable(tableId);
      assertActive();
      // 修改表格中第一个字段为"评论ID"，再添加其余字段
      const fieldMetaList = await newTable.getFieldMetaList();
      assertActive();
      const firstFieldId = fieldMetaList[0]?.id;
      if (firstFieldId) {
        await newTable.setField(firstFieldId, { ...fields[0] });
        assertActive();
      }
      for (let i = 1; i < fields.length; i++) {
        await newTable.addField({ ...fields[i] });
        assertActive();
      }
      // console.log(`表格"${tableName}"创建成功，包含${createdFields.length}个字段`);
    }
    // 写入数据
    const activeTable = targetTableId
      ? await bitable.base.getTableById(targetTableId)
      : await bitable.base.getActiveTable();
    assertActive();

    // 使用现有表格：评论ID必需，其余字段仅在元信息确认存在时写入。
    if (targetTableId) {
      const fieldNames = new Set((await activeTable.getFieldMetaList()).map(field => field.name));
      assertActive();
      const existingFieldMap = new Map();
      for (const config of activeFieldConfigs) {
        const name = [config.name, ...(config.legacyNames || [])].find(name => fieldNames.has(name));
        if (!name) continue;
        const field = await activeTable.getField(name);
        assertActive();
        if (field) existingFieldMap.set(config.name, field);
      }

      if (!existingFieldMap.has(EXISTING_TABLE_REQUIRED_FIELD)) {
        // showErrorMsg(`所选表格缺少必需字段：${EXISTING_TABLE_REQUIRED_FIELD}`);
        fail(`主字段"评论ID"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`);
        resetParams();
        return;
      }

      const availableMappings = activeFieldConfigs.filter(config => existingFieldMap.has(config.name));
      if (availableMappings.length === 0) {
        fail("所选表格没有可写入字段");
        resetParams();
        return;
      }

      // 为 Number 类型字段设置整型格式
      // const NUMBER_FIELDS = ["点赞数", "回复数"];
      // for (const name of NUMBER_FIELDS) {
      //   if (existingFieldMap.has(name)) {
      //     try {
      //       await existingFieldMap.get(name).setFormatter(NumberFormatter.INTEGER);
      //     } catch (e) {
      //       console.warn(`设置字段格式失败：${name}`, e);
      //     }
      //   }
      // }

      const records = [];
      for (const item of list) {
        const record = [];
        for (const config of availableMappings) {
          const { field, fieldType } = await resolveWritableField(activeTable, existingFieldMap.get(config.name));
          assertActive();
          if (!isFieldTypeCompatible(fieldType, config)) {
            throw new Error(`字段类型不匹配:字段"${config.name}"，仅支持${getAllowedFieldTypes(config).map(type => FIELD_TYPE_NAME[type] || type).join(' / ')}`);
          }
          record.push(await field.createCell(getFieldWriteValue(config, item, fieldType)));
          assertActive();
        }
        records.push(record);
      }
      await activeTable.addRecords(records);
      assertActive();
      writtenCommentCount += records.length;

      if (total > page) {
        page += 1;
        return getList(task_id, 'next', targetTableId, taskStatus);
      } else {
        finishCommentWrite(taskStatus);
      }
      return;
    }

    // console.log("🚀 ~ createAndWriteData ~ activeTable:", activeTable, fields)
    const fieldList = [];
    for (const config of fields) {
      const field = await activeTable.getField(config.name);
      assertActive();
      if (!field) {
        console.error(`表格中未找到字段：${config.name}`);
      }
      fieldList.push(field);
    };
    // console.log("🚀 ~ createAndWriteData ~ fieldList:", fieldList)
    if (fieldList.length != fields.length) {
      console.error(`表格中获取的字段错误：` + fieldList.length);
      return;
    }
    let records = [];
    for (const item of list) {
      let record = [];
      for (let i = 0; i < fields.length; i++) {
        const mapping = activeFieldConfigs[i];
        const { field, fieldType } = await resolveWritableField(activeTable, fieldList[i]);
        assertActive();
        if (!isFieldTypeCompatible(fieldType, mapping)) {
          throw new Error(`字段类型不匹配:字段"${mapping.name}"，仅支持${getAllowedFieldTypes(mapping).map(type => FIELD_TYPE_NAME[type] || type).join(' / ')}`);
        }
        record.push(await field.createCell(getFieldWriteValue(mapping, item, fieldType)));
        assertActive();
      }
      records.push(record);
    }
    // 写入记录
    const recordIds = await activeTable.addRecords(records);
    assertActive();
    writtenCommentCount += records.length;
    // console.log(`成功添加 ${recordIds.length} 条数据`, ' - ' + total + ' - ', page + ' - ', total > page);

    if (total > page) {
      page += 1;
      return getList(task_id, 'next', targetTableId, taskStatus);
    } else {
      finishCommentWrite(taskStatus);
    }
  } catch (error) {
    if (disposed) return;
    console.error("🚀 ~ createAndWriteData ~ error:", error)
    resetParams();
    const reason = error?.response?.data?.msg || error?.message || String(error || '写入评论失败，请稍后重试');
    const message = `${reason}；请核对表格结果后再执行，勿重复启动任务`;
    fail(message, { persist: true, requiresReopen: !!error?.requiresReopen });
  }
}

// 新建 顺序表
const createSequentialTable = async (baseTableName) => {
  try {
    // 获取所有表格元信息
    const existingTables = await bitable.base.getTableMetaList();
    assertActive();
    const tableNames = existingTables.map(table => table.name);

    // 检查是否存在基础名称表格（无序号）或存在有序号的表格
    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      // 存在基础表，直接创建基础名称表格
      const newTable = await bitable.base.addTable({
        name: baseTableName
      });
      assertActive();
      // console.log(`已创建基础表格：${baseTableName}，ID：${newTable.id}`);
      return newTable;
    }

    // 存在基础表，查找最大序号
    // 正则匹配格式：基础名+数字（如"视频信息表1"）
    const reg = new RegExp(`^${baseTableName}(\\d+)$`);
    let maxIndex = 0;

    tableNames.forEach(name => {
      const match = name.match(reg);
      if (match) {
        // 提取数字部分并转换为整数
        const index = parseInt(match[1], 10);
        // 更新最大序号
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    });

    // 计算新表格名称（最大序号+1）
    const newTableName = `${baseTableName}${maxIndex + 1}`;

    // 创建新表格
    const newTable = await bitable.base.addTable({
      name: newTableName
    });
    assertActive();
    // console.log(`已创建序号表格：${newTableName}`);
    return newTable;

  } catch (error) {
    if (!disposed) console.error("获取表格序号失败：", error);
    throw error; // 抛出错误便于上层处理
  }
}


const showErrorMsg = (message) => {
  ElMessage({
    message: message,
    type: "error",
    plain: true,
    duration: 3000,
  });
};

const getValidApiKey = () => {
  const normalizedKey = String(api_key.value || "").trim();
  if (!normalizedKey || normalizedKey === API_KEY_CLEARED_MARKER) {
    return "";
  }
  return normalizedKey;
};

// 主页 提交任务
const postNoteTask = async (targetTableId = "") => {
  if (disposed) return;
  const validApiKey = getValidApiKey();
  const normalizedUrl = String(formData.value.url || "").trim();
  await request({
    url: "/social/api/v1/feishu/comment/task",
    method: "post",
    headers: {
      'authorization': `Bearer ${validApiKey}`,
    },
    data: {
      url: normalizedUrl,
      // social_type: formData.value.social_type,
      pages: Number(formData.value.pages),
      reply_pages: Number(formData.value.reply_pages),
    },
  })
    .then(function (response) {
      if (disposed) return;
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        progress('正在获取评论数据...');
        getNoteTaskInterval(data.task_id, targetTableId);
      } else {
        loading.value = false;
        fail(res.msg);
      }
    })
    .catch(function (error) {
      if (disposed) return;
      loading.value = false;
      console.log(error);
      fail(error);
    });
};

const closeNoteInterval = () => {
  note_timer && clearInterval(note_timer);
  note_timer = null;
  activeCommentTaskId.value = '';
};

// 主页 轮询获取任务状态
const getNoteTaskInterval = (task_id, targetTableId = "") => {
  if (disposed) return;
  const requestFn = () => {
    let time = 0;
    closeNoteInterval();
    activeCommentTaskId.value = task_id;
    cancelling.value = false;
    latestTaskStatus = null;
    note_timer = setInterval(() => {
      time += 3;
        if (time >= 600) {
        closeNoteInterval();
        fail("获取数据超时，请稍后重试");
        loading.value = false;
        } else {
        getNoteTask(task_id, targetTableId);
      }
    }, 3000)
  }
  requestFn();
};

// 主页 获取任务状态
const getNoteTask = async (task_id, targetTableId = "") => {
  if (disposed) return;
  const validApiKey = getValidApiKey();
  await request({
    url: "/social/api/v1/feishu/comment/task?task_id=" + task_id,
    method: "get",
    params: { supports_partial_results: 1 },
    headers: {
      'authorization': `Bearer ${validApiKey}`,
    },
  })
    .then(function (response) {
      if (disposed) return;
      // 停止轮询会清除任务编号，在途的重复或上一任务响应不再触发写入。
      if (activeCommentTaskId.value !== task_id) return;
      let res = response.data;
      if (Number(res.sta) === 4001) {
        const error = new Error(res.msg || 'API Key 已失效');
        error.code = 'INVALID_API_KEY';
        throw error;
      }
      if (res.sta == 0) {
        const { status } = res.data;
        // 已确认的停止请求不能被更早发出、较晚返回的进行中响应撤销。
        if (!isCancelRequested(latestTaskStatus) || isCancelRequested(res.data)) latestTaskStatus = res.data;
        if (isCancelRequested(latestTaskStatus)) {
          cancelling.value = true;
          progress(getStoppingText(), { stopping: true });
        }
        if (status == 2) taskFailureMessage = res.data.reason || res.data.msg || res.data.message || '';
        if (status == 0) { // 进行中
          // 继续轮询
        } else if (status == 1 || status == 2 || status == 3) { // 终态仍需交付已保存的评论
          closeNoteInterval();
          page = 1;
          progress(status == 3 ? `获取数据已停止，正在写入剩余结果，已写入 ${writtenCommentCount} 条评论` : '正在读取评论结果...', { stopping: status == 3 });
          return getList(task_id, "", targetTableId, status);
        }
      }
    })
    .catch(function (error) {
      if (disposed) return;
      if (activeCommentTaskId.value !== task_id) return;
      if (error.code === 'INVALID_API_KEY' || [401, 403].includes(error.response?.status)) {
        closeNoteInterval();
        resetParams();
        fail(error);
        return;
      }
      console.log(error);
    });
}

// 获取帖子列表
const getList = async (task_id, type, targetTableId = "", taskStatus = 1) => {
  if (disposed) return;
  const validApiKey = getValidApiKey();
  await request({
    url: "/social/api/v1/feishu/comment/list",
    method: "post",
    headers: {
      'authorization': `Bearer ${validApiKey}`,
    },
    data: {
      task_id: task_id,
      page: page,
      page_size: page_size,
    },
  })
    .then(function (response) {
      if (disposed) return;
      let res = response.data;
      if (res.sta == 0) {
        const { count, data } = res.data;
        if (!type) { // 第一次请求
          total = Math.ceil(count / page_size);
          return createAndWriteData(data, '', task_id, targetTableId, taskStatus);
        } else if (type == 'next') {
          return createAndWriteData(data, type, task_id, targetTableId, taskStatus);
        }
      } else {
        loading.value = false;
        fail(res.msg);
        // showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      if (disposed) return;
      loading.value = false;
      console.log(error);
      fail(error);
    });
};

// 同步校验后立即反馈，异步字段校验与HTTP提交共用现有忙碌状态。
const commit = async () => {
  if (disposed || !fieldSelectionReady.value || loading.value || apiKeySaving.value || noticeRequiresReopen.value) return;
  if (!getValidApiKey()) {
    showErrorMsg("请输入 API Key");
    return;
  }
  const { url, radio, table_id } = formData.value;
  if (!String(url || "").trim()) {
    showErrorMsg("请输入作品链接");
    return;
  }
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }
  loading.value = true;
  cancelling.value = false;
  writtenCommentCount = 0;
  taskFailureMessage = '';
  begin(radio === 2 ? '正在校验评论表格字段...' : '正在提交评论获取任务...');
  await nextTick();
  if (disposed) return;
  try {
    if (radio === 2 && !await validateTableFields(table_id)) {
      loading.value = false;
      return;
    }
    if (disposed) return;
    progress('正在提交评论获取任务...');
    await postNoteTask(radio === 2 ? table_id : '');
    if (disposed) return;
    if (radio !== 2) {
      // 保存输入不影响已提交任务的执行和结果提示。
      bitable.bridge.setData("note_url", url).catch(error => console.error('保存作品链接失败:', error));
    }
  } catch (error) {
    if (disposed) return;
    loading.value = false;
    fail(error);
  }
};

const isCancelRequested = status => Number(status?.status) === 3 || !!status?.cancel_requested || status?.status_text === 'cancel_requested';
const getStoppingText = () => `正在停止获取数据，已写入 ${writtenCommentCount} 条评论`;
const cancelCommentTask = async () => {
  const taskId = activeCommentTaskId.value;
  if (disposed || !loading.value || !taskId || cancelling.value) return;
  cancelling.value = true;
  progress(getStoppingText(), { stopping: true });
  try {
    const response = await request({
      url: '/social/api/v1/feishu/comment/task/cancel', method: 'post',
      headers: { authorization: `Bearer ${getValidApiKey()}` }, data: { task_id: taskId },
    });
    if (response.data?.sta !== 0) throw new Error(response.data?.msg || '停止任务失败');
  } catch (error) {
    if (disposed || activeCommentTaskId.value !== taskId) return;
    cancelling.value = isCancelRequested(latestTaskStatus);
    progress(cancelling.value ? getStoppingText() : '正在获取评论数据…', { stopping: cancelling.value });
    ElMessage({ message: error?.response?.data?.msg || error.message || '停止任务失败', type: 'error', plain: true, duration: 5000 });
  }
};
const taskActionState = computed(() => cancelling.value && loading.value ? 'stopping' : loading.value && activeCommentTaskId.value ? 'running' : loading.value ? 'submitting' : 'idle');
const handleTaskAction = () => {
  if (taskActionState.value === 'running') return cancelCommentTask();
  if (taskActionState.value === 'idle') return commit();
};

watch(selectedFieldKeys, async (keys) => {
  if (!fieldSelectionReady.value) return;
  const requiredKeys = FIELD_CONFIG.filter(field => field.required).map(field => field.key);
  const nextKeys = Array.from(new Set([...keys, ...requiredKeys]));
  if (nextKeys.length !== keys.length) {
    selectedFieldKeys.value = nextKeys;
    return;
  }
  try {
    await bitable.bridge.setData(FIELD_SELECTION_STORAGE_KEY, nextKeys);
  } catch (error) {
    console.error('保存字段勾选状态失败:', error);
  }
}, { deep: true });

// 验证表格字段
const validateTableFields = async (tableId) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
    const fieldMetaList = await activeTable.getFieldMetaList();
    if (disposed) return false;
    const fieldIdByName = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));

    // 检查必需字段是否存在
    if (!fieldIdByName.has(EXISTING_TABLE_REQUIRED_FIELD)) {
      // showErrorMsg(`所选表格缺少必需字段：${EXISTING_TABLE_REQUIRED_FIELD}`);
      fail(`主字段"评论ID"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`);
      return false;
    }

    // 检查每个映射字段的类型是否匹配
    for (const config of getActiveFieldConfigs()) {
      const fieldId = [config.name, ...(config.legacyNames || [])]
        .map(name => fieldIdByName.get(name))
        .find(Boolean);
      
      // 如果字段不存在，跳过类型检查（因为这是可选字段）
      if (!fieldId) {
        continue;
      }
      
      // 获取字段元数据
      const fieldMeta = fieldMetaList.find(meta => meta.id === fieldId);
      
      // 验证字段类型是否匹配
      const allowedTypes = getAllowedFieldTypes(config);
      if (config.type && !isFieldTypeCompatible(fieldMeta.type, config)) {
        // showErrorMsg(`所选表格中 "${config.name}" 字段的类型不正确`);
        const expectedTypesText = allowedTypes.map(type => FIELD_TYPE_NAME[type] || type).join(" / ");
        fail(`字段类型不匹配:字段"${config.name}" 的类型是 ${FIELD_TYPE_NAME[fieldMeta.type] || fieldMeta.type}，仅支持 ${expectedTypesText}，无法写入数据`);
        return false;
      }
    }
    
    // 检查是否有至少一个可用的映射字段
    const availableMappings = getActiveFieldConfigs().filter(config =>
      [config.name, ...(config.legacyNames || [])].some(name => fieldIdByName.has(name))
    );
    if (availableMappings.length === 0) {
      fail("所选表格没有可写入字段");
      return false;
    }
    
    return true;
  } catch (error) {
    if (disposed) return false;
    console.error("验证表格字段时出错:", error);
    fail(error);
    return false;
  }
};

</script>

<template>
  <div class="key-box">
    <div class="key-title">
      <div>
        API Key 设置
        <a class="key-url" href="https://52choujiang.com/assistant" target="_blank">点击获取API密钥</a>
      </div>
      <img src="https://cdn.zhinizhushou.com/material/20250826/7cbcdd6c440e86fdf51c553973211e54.png"
        style="width: 16px; height: 16px" :style="{ cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.45 : 1 }"
        :aria-disabled="busy" alt="" @click="!busy && (api_key_disabled = !api_key_disabled)" />
    </div>
    <el-input type="password" v-model="api_key" class="key-input" placeholder="" :disabled="api_key_disabled || busy"
      show-password />
    <button v-if="!api_key_disabled || apiKeySaving" type="button" class="key-save-btn" :disabled="busy" @click="saveApiKey">
      <img src="https://cdn.zhinizhushou.com/material/20250826/2db36bfc55033175693a18a5f927d938.png"
        style="width: 14px; height: 14px; margin-right: 8px" />
      {{ apiKeySaving ? '保存中…' : '保存' }}
    </button>
  </div>
  <div class="create-box">
    <el-form ref="form" class="form" :model="formData" label-position="top" :disabled="busy" :inert="busy ? '' : null" :aria-busy="initializing || loading || apiKeySaving">
      <el-form-item label="" style="margin-top: 12px">
        <el-radio-group v-model="formData.radio">
          <el-radio :value="1">新建表格</el-radio>
          <el-radio :value="2">使用现有表格</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="formData.radio === 2" label="">
        <div slot="label" class="c-label">选择现有表格</div>
        <el-select v-model="formData.table_id" placeholder="请选择" style="width: 100%">
          <el-option v-for="tl in table_options" :key="tl.id" :label="tl.name" :value="tl.id" />
        </el-select>
        <p v-if="tableOptionsError" class="sub-hint">{{ tableOptionsError }}</p>
      </el-form-item>
      <el-form-item>
        <div slot="label" class="c-label">
          作品链接
          <el-tooltip effect="dark" placement="top">
            <template #content>支持单个或多个作品链接，可用换行、英文逗号或中文逗号分隔</template>
            <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
              class="help-icon" />
          </el-tooltip>
        </div>
        <el-input
          v-model="formData.url"
          type="textarea"
          :rows="4"
          resize="none"
          class="c-input"
          placeholder="请输入作品链接，支持换行或逗号分隔"
        />
      </el-form-item>
      <!-- <el-form-item label="">
        <div slot="label" class="c-label">
          平台
          <el-tooltip effect="dark" placement="top">
            <template #content>平台</template>
            <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
              class="help-icon" />
          </el-tooltip>
        </div>
        <el-select v-model="formData.social_type" placeholder="请选择" style="width: 100%">
          <el-option v-for="tl in social_type_options" :key="tl.value" :label="tl.label" :value="tl.value" />
        </el-select>
      </el-form-item> -->
      <el-form-item label="">
        <div slot="label" class="c-label">
          主评论数据提取范围
          <el-tooltip effect="dark" placement="top">
            <template #content>每页 10 积分，实际扣费会按照<br />提取的页数进行计算</template>
            <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
              class="help-icon" />
          </el-tooltip>
        </div>
        <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
          <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="">
        <div slot="label" class="c-label">子评论提取范围</div>
        <el-select v-model="formData.reply_pages" placeholder="请选择" style="width: 100%">
          <el-option v-for="tl in reply_pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="" style="margin-top: 12px">
        <div slot="label" class="c-label">选择需要的字段</div>
        <el-checkbox-group v-model="selectedFieldKeys" class="field-checkbox-group">
          <el-checkbox
            v-for="field in FIELD_CONFIG"
            :key="field.key"
            :label="field.key"
            :disabled="field.required"
            class="field-checkbox-item"
          >
            {{ field.name }}
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>

    <p v-if="initializationError" class="sub-hint" role="status" aria-live="polite">
      <span>配置读取失败：{{ initializationError }}</span>
      <el-button link type="primary" @click="loadInitialConfig">重试</el-button>
    </p>
    <p v-if="taskNotice" class="sub-hint" role="status">{{ taskNotice }}</p>
    <el-button class="commit-btn" :class="{ 'is-running': taskActionState === 'running' || taskActionState === 'stopping' }" :loading="initializing || taskActionState === 'submitting' || taskActionState === 'stopping'" :disabled="!fieldSelectionReady || taskActionState === 'submitting' || taskActionState === 'stopping' || apiKeySaving || noticeRequiresReopen" @click="handleTaskAction">{{ initializing ? '准备中…' : taskActionState === 'stopping' ? '正在停止…' : taskActionState === 'running' ? '停止任务' : loading ? '执行中…' : noticeRequiresReopen ? '请重新进入插件' : '立即执行' }}</el-button>
  </div>
  <TaskFeedback :visible="toastVisible" :text="toastText" :kind="toastType" />
</template>

<style scoped>
.key-box {
  padding: 20px 16px 0;
  box-sizing: border-box;
}

.key-box .key-title {
  font-size: 14px;
  font-weight: normal;
  line-height: 22px;
  letter-spacing: 0px;
  color: #1d2129;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.key-box .key-url {
  color: #165dff;
  text-decoration: none;
}

.key-box .key-input {
  width: 100%;
  margin-top: 24px;
}

.key-box .key-save-btn {
  border: 0;
  padding: 0;
  font: inherit;
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  margin-top: 24px;
  cursor: pointer;
}

.key-box .key-save-btn:disabled { cursor: not-allowed; opacity: 0.65; }

.create-box {
  padding: 40px 16px 40px;
  box-sizing: border-box;
}

.form :deep(.el-form-item__label) {
  font-size: 14px;
  color: #1d2129;
  margin-bottom: 8px;
}

.form :deep(.el-form-item__content) {
  font-size: 14px;
}

.commit-btn { margin-top: 8px; }

.c-label {
  display: flex;
  align-items: center;
}

.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}

.field-checkbox-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  width: 100%;
}

.field-checkbox-item {
  margin-right: 0;
}

.field-checkbox-group :deep(.el-checkbox) {
  margin-right: 0;
}

.field-checkbox-group :deep(.el-checkbox__inner) {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border-color: #e5e6eb;
}

.field-checkbox-group :deep(.el-checkbox:hover .el-checkbox__inner) {
  border-color: #a8071a;
}

.field-checkbox-group :deep(.el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: #a8071a;
  border-color: #a8071a;
}

.field-checkbox-group :deep(.el-checkbox__input.is-checked + .el-checkbox__label) {
  color: #1d2129;
}

.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner) {
  background-color: #f7f8fa;
  border-color: #e5e6eb;
}

.field-checkbox-group :deep(.el-checkbox__input.is-disabled.is-checked .el-checkbox__inner::after) {
  border-color: #c9cdd4;
}

.sub-hint { margin: 8px 0; color: #86909c; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
</style>
