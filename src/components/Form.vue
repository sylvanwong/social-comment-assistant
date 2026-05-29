<script setup>
import { bitable, FieldType, NumberFormatter } from "@lark-base-open/js-sdk";
import { ref, onMounted, onUnmounted, watch } from "vue";
import request from '@/utils/request'

let note_timer = null;
const API_KEY_CLEARED_MARKER = "__cleared__";

const api_key = ref("");
const api_key_disabled = ref(true);

const formData = ref({
  radio: 1, url: "",
  // social_type: "xhs",
  pages: 1,
  reply_pages: -1,
  table_id: "",
});
const table_options = ref([]);
const EXISTING_TABLE_REQUIRED_FIELD = "评论ID";
const FIELD_CONFIG = [
  { name: "评论ID", type: FieldType.Text, getValue: (item) => item?.cid ?? "" },
  { name: "上级评论ID", type: FieldType.Text, getValue: (item) => item?.reply_id ?? "" },
  { name: "作品ID", type: FieldType.Text, getValue: (item) => item?.note_id ?? "" },
  { name: "评论内容", type: FieldType.Text, getValue: (item) => item?.text ?? "" },
  { name: "作者名称", type: FieldType.Text, getValue: (item) => item?.nickname ?? "" },
  { name: "作者ID", type: FieldType.Text, getValue: (item) => item?.uid ?? "" },
  { name: "小红书ID", type: FieldType.Text, getValue: (item) => item?.social_user_number ?? "" },
  { name: "点赞数", type: FieldType.Number, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.digg_count) || 0 },
  { name: "回复数", type: FieldType.Number, formatter: NumberFormatter.INTEGER, getValue: (item) => Number(item?.reply_comment_total) || 0 },
  { name: "平台", type: FieldType.Text, getValue: (item) => item?.social_type ?? "" },
  { name: "评论时间", type: FieldType.DateTime, getValue: (item) => (item?.t_create ? item.t_create * 1000 : "") },
];
// 字段类型名称映射
const FIELD_TYPE_NAME = {
  [FieldType.Text]: 'Text',
  [FieldType.Number]: 'Number',
  [FieldType.DateTime]: 'DateTime',
  [FieldType.Url]: 'Url',
  [FieldType.Attachment]: 'Attachment',
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
let page = 1;
const page_size = 20;
let total = 0;

onMounted(async () => {
  const key = await bitable.bridge.getData("api_key");
  // 只有 key 非空且为字符串且不是清除标记时才使用
  if (key && typeof key === "string" && key.trim() && key.trim() !== API_KEY_CLEARED_MARKER) {
    api_key.value = key.trim();
  }
  const note_url = await bitable.bridge.getData("note_url");
  // const note_platform = await bitable.bridge.getData("note_platform");
  if (note_url && typeof note_url == "string") {
    formData.value.url = note_url;
  }
  // if (note_platform && typeof note_platform == "string") {
  //   formData.value.social_type = note_platform;
  // }
});

const loadTableOptions = async () => {
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
    showErrorMsg("获取表格列表失败，请稍后重试");
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
  closeNoteInterval();
});

const saveApiKey = async () => {
  const normalizedKey = String(api_key.value || "").trim();
  if (!normalizedKey) {
    // 清除存储的 api_key，使用特殊标记值
    api_key_disabled.value = true;
    api_key.value = "";
    await bitable.bridge.setData("api_key", API_KEY_CLEARED_MARKER);
    return;
  } else {
    api_key_disabled.value = true;
    api_key.value = normalizedKey;
    await bitable.bridge.setData("api_key", normalizedKey);
    ElMessage({
      message: "保存成功",
      type: "success",
      plain: true,
    });
  }
}

const resetParams = () => {
  loading.value = false;
  page = 1;
  total = 0;
};

// 写入数据: 新建表格
const createAndWriteData = async (list, type, task_id, targetTableId = "") => {
  if (!list) {
    ElMessage({
      message: "获取数据异常，请稍后重试",
      type: "warning",
      plain: true,
    });
    resetParams();
    return;
  }
  if (list && list.length == 0) {
    ElMessage({
      message: "获取数据为空",
      type: "warning",
      plain: true,
    });
    resetParams();
    return;
  }
  try {
    const fields = FIELD_CONFIG.map(({ name, type, formatter }) => formatter ? { name, type, formatter } : { name, type });
    // console.log("🚀 ~ createAndWriteData ~ fields:", fields)
    // 创建表格，创建表格中的字段
    if (!type && !targetTableId) { // 第一次请求且为新建表格
      let tableName = '';
      // const firstItem = list[0];
      tableName = '社媒评论加载工具';

      // 创建表格
      const { tableId, index } = await createSequentialTable(tableName);
      const newTable = await bitable.base.getTable(tableId);
      // console.log("🚀 ~ createAndWriteData ~ newTable:", newTable)
      await bitable.ui.switchToTable(tableId);
      // 修改表格中第一个字段为"评论ID"，再添加其余字段
      const fieldMetaList = await newTable.getFieldMetaList();
      const firstFieldId = fieldMetaList[0]?.id;
      if (firstFieldId) {
        await newTable.setField(firstFieldId, { ...fields[0] });
      }
      for (let i = 1; i < fields.length; i++) {
        await newTable.addField({ ...fields[i] });
      }
      // console.log(`表格"${tableName}"创建成功，包含${createdFields.length}个字段`);
    }
    // 写入数据
    const activeTable = targetTableId
      ? await bitable.base.getTableById(targetTableId)
      : await bitable.base.getActiveTable();

    // 使用现有表格：仅要求存在"文本"字段，其余字段按存在即写入
    if (targetTableId) {
      const existingFieldMap = new Map();
      for (const config of FIELD_CONFIG) {
        try {
          const field = await activeTable.getField(config.name);
          if (field) {
            existingFieldMap.set(config.name, field);
          }
        } catch (error) {
          // 字段不存在时 getField 会抛异常，这里按可选字段处理
          console.warn(`现有表格缺少字段：${config.name}`);
        }
      }

      if (!existingFieldMap.has(EXISTING_TABLE_REQUIRED_FIELD)) {
        // showErrorMsg(`所选表格缺少必需字段：${EXISTING_TABLE_REQUIRED_FIELD}`);
        ElNotification({ title: '出错', message: `主字段"评论ID"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`, type: 'error', duration: 0 });
        resetParams();
        return;
      }

      const availableMappings = FIELD_CONFIG.filter(config => existingFieldMap.has(config.name));
      if (availableMappings.length === 0) {
        showErrorMsg("所选表格没有可写入字段");
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
          const field = existingFieldMap.get(config.name);
          record.push(await field.createCell(config.getValue(item)));
        }
        records.push(record);
      }
      await activeTable.addRecords(records);

      if (total > page) {
        page += 1;
        getList(task_id, 'next', targetTableId);
        return;
      } else {
        resetParams();
      }
      return;
    }

    // console.log("🚀 ~ createAndWriteData ~ activeTable:", activeTable, fields)
    const fieldList = [];
    for (const config of fields) {
      const field = await activeTable.getField(config.name);
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
        const mapping = FIELD_CONFIG[i];
        record.push(await fieldList[i].createCell(mapping.getValue(item)));
      }
      records.push(record);
    }
    // 写入记录
    const recordIds = await activeTable.addRecords(records);
    // console.log(`成功添加 ${recordIds.length} 条数据`, ' - ' + total + ' - ', page + ' - ', total > page);

    if (total > page) {
      page += 1;
      getList(task_id, 'next', targetTableId);
      return;
    } else {
      resetParams();
    }
  } catch (error) {
    console.error("🚀 ~ createAndWriteData ~ error:", error)
    resetParams();
  }
}

// 新建 顺序表
const createSequentialTable = async (baseTableName) => {
  try {
    // 获取所有表格元信息
    const existingTables = await bitable.base.getTableMetaList();
    const tableNames = existingTables.map(table => table.name);

    // 检查是否存在基础名称表格（无序号）或存在有序号的表格
    const existsBaseTable = tableNames.includes(baseTableName);
    const existsSequentialTable = tableNames.some(name => name.startsWith(`${baseTableName}`) && /\d+$/.test(name.slice(baseTableName.length)));
    if (!existsBaseTable && !existsSequentialTable) {
      // 存在基础表，直接创建基础名称表格
      const newTable = await bitable.base.addTable({
        name: baseTableName
      });
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
    // console.log(`已创建序号表格：${newTableName}`);
    return newTable;

  } catch (error) {
    console.error("获取表格序号失败：", error);
    throw error; // 抛出错误便于上层处理
  }
}

const showErrorMsg = (message) => {
  ElMessage({
    message: message,
    type: "error",
    plain: true,
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
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getNoteTaskInterval(data.task_id, targetTableId);
      } else {
        loading.value = false;
        showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

const closeNoteInterval = () => {
  note_timer && clearInterval(note_timer);
  note_timer = null;
};

// 主页 轮询获取任务状态
const getNoteTaskInterval = (task_id, targetTableId = "") => {
  const requestFn = () => {
    let time = 0;
    closeNoteInterval();
    note_timer = setInterval(() => {
      time += 3;
        if (time >= 600) {
        closeNoteInterval();
        showErrorMsg("获取数据超时，请稍后重试");
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
  const validApiKey = getValidApiKey();
  await request({
    url: "/social/api/v1/feishu/comment/task?task_id=" + task_id,
    method: "get",
    headers: {
      'authorization': `Bearer ${validApiKey}`,
    },
  })
    .then(function (response) {
      let res = response.data;
      if (res.sta == 0) {
        const { status } = res.data;
        if (status == 0) { // 进行中
          // 继续轮询
        } else if (status == 1) { // 成功
          closeNoteInterval();
          page = 1;
          getList(task_id, "", targetTableId);
        } else if (status == 2) { // 失败
          closeNoteInterval();
          showErrorMsg("获取数据失败，请稍后重试");
          loading.value = false;
        }
      }
    })
    .catch(function (error) {
      console.log(error);
    });
}

// 获取帖子列表
const getList = async (task_id, type, targetTableId = "") => {
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
      let res = response.data;
      if (res.sta == 0) {
        const { count, data } = res.data;
        if (!type) { // 第一次请求
          total = Math.ceil(count / page_size);
          createAndWriteData(data, '', task_id, targetTableId);
        } else if (type == 'next') {
          createAndWriteData(data, type, task_id, targetTableId);
        }
      } else {
        loading.value = false;
        ElNotification({ title: '错误', message: res.msg, type: 'error', duration: 0 });
        // showErrorMsg(res.msg);
      }
    })
    .catch(function (error) {
      loading.value = false;
      console.log(error);
      showErrorMsg(error);
    });
};

// 主页数据
const getNoteData = async (targetTableId = "") => {
  // 新建表格，表格中第一个字段为视频编号
  // createAndWriteData([]);
  // return;
  loading.value = true;
  await postNoteTask(targetTableId);
};

const commit = () => {
  if (loading.value) return;
  const validApiKey = getValidApiKey();
  if (!validApiKey) {
    showErrorMsg("请输入API key");
    return;
  }
  // const { url } = formData.value;
  const { url, radio, table_id } = formData.value;
  if (!String(url || "").trim()) {
    showErrorMsg("请输入帖子链接");
    return;
  }
  if (radio === 2 && !table_id) {
    showErrorMsg("请选择现有表格");
    return;
  }

  // 如果是使用现有表格，验证表格字段
  if (radio === 2) {
    validateTableFields(table_id).then(isValid => {
      if (isValid) {
        getNoteData(table_id);
      }
    }).catch(error => {
      console.error("验证表格字段时出错:", error);
      showErrorMsg("验证表格字段失败，请稍后重试");
    });
    return;
  }

  // const targetTableId = formData.value.radio === 2 ? String(formData.value.table_id || "") : "";
  getNoteData();
  //
  bitable.bridge.setData("note_url", formData.value.url);
  // bitable.bridge.setData("note_platform", formData.value.social_type);

};

// 验证表格字段
const validateTableFields = async (tableId) => {
  try {
    const activeTable = await bitable.base.getTableById(tableId);
    const fieldMetaList = await activeTable.getFieldMetaList();
    const fieldIdByName = new Map(fieldMetaList.map(meta => [meta.name, meta.id]));

    // 检查必需字段是否存在
    if (!fieldIdByName.has(EXISTING_TABLE_REQUIRED_FIELD)) {
      // showErrorMsg(`所选表格缺少必需字段：${EXISTING_TABLE_REQUIRED_FIELD}`);
      ElNotification({ title: '出错', message: `主字段"评论ID"不存在于现有表格中，无法写入数据。请确保表格中包含该字段。`, type: 'error', duration: 0 });
      return false;
    }

    // 检查每个映射字段的类型是否匹配
    for (const config of FIELD_CONFIG) {
      const fieldId = fieldIdByName.get(config.name);
      
      // 如果字段不存在，跳过类型检查（因为这是可选字段）
      if (!fieldId) {
        continue;
      }
      
      // 获取字段元数据
      const fieldMeta = fieldMetaList.find(meta => meta.id === fieldId);
      
      // 验证字段类型是否匹配
      const expectedType = config.type;
      if (expectedType && fieldMeta.type !== expectedType) {
        // showErrorMsg(`所选表格中 "${config.name}" 字段的类型不正确`);
        ElNotification({ title: '出错', message: `字段类型不匹配:字段"${config.name}" 的类型是 ${FIELD_TYPE_NAME[fieldMeta.type] || fieldMeta.type}，但Schema定义为 ${FIELD_TYPE_NAME[expectedType] || expectedType}，无法写入数据`, type: 'error', duration: 0 });
        return false;
      }
    }
    
    // 检查是否有至少一个可用的映射字段
    const availableMappings = FIELD_CONFIG.filter(config => fieldIdByName.has(config.name));
    if (availableMappings.length === 0) {
      showErrorMsg("所选表格没有可写入字段");
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("验证表格字段时出错:", error);
    showErrorMsg("验证表格字段失败，请稍后重试");
    return false;
  }
};

</script>

<template>
  <div class="key-box">
    <div class="key-title">
      <div>
        API key 设置
        <a class="key-url" href="https://52choujiang.com/assistant" target="_blank">获取API秘钥</a>
      </div>
      <img src="https://cdn.zhinizhushou.com/material/20250826/7cbcdd6c440e86fdf51c553973211e54.png"
        style="width: 16px; height: 16px; cursor: pointer" alt="" @click="api_key_disabled = !api_key_disabled" />
    </div>
    <el-input type="password" v-model="api_key" class="key-input" placeholder="" :disabled="api_key_disabled"
      show-password />
    <div v-if="!api_key_disabled" class="key-save-btn" @click="saveApiKey">
      <img src="https://cdn.zhinizhushou.com/material/20250826/2db36bfc55033175693a18a5f927d938.png"
        style="width: 14px; height: 14px; margin-right: 8px" />
      保存
    </div>
  </div>
  <div class="create-box">
    <el-form ref="form" class="form" :model="formData" label-position="top">
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
      </el-form-item>
      <el-form-item>
        <div slot="label" class="c-label">
          帖子链接
          <el-tooltip effect="dark" placement="top">
            <template #content>支持单个或多个帖子链接，可用换行、英文逗号或中文逗号分隔</template>
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
          placeholder="请输入帖子链接，支持换行或逗号分隔"
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
    </el-form>

    <el-button color="#a8071a" class="commit-btn" :loading="loading" @click="commit">提交</el-button>
  </div>
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

.commit-btn {
  background: #a8071a;
  width: 100%;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  margin-top: 8px;
  cursor: pointer;
}

.c-label {
  display: flex;
  align-items: center;
}

.help-icon {
  width: 16px;
  height: 16px;
  margin-left: 4px;
}
</style>
