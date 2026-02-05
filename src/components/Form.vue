<script setup>
import { bitable, FieldType } from "@lark-base-open/js-sdk";
import { ref, onMounted, onUnmounted } from "vue";
import request from '@/utils/request'

let note_timer = null;

const api_key = ref("");
const api_key_disabled = ref(true);

const formData = ref({ radio: 1, url: "", social_type: "xhs", pages: 1 });
const pages_options = ref([
  {
    value: 0,
    label: "全量获取",
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
const social_type_options = ref([
  {
    value: "xhs",
    label: "小红书",
  },
  {
    value: "douyin",
    label: "抖音",
  },
]);

const loading = ref(false);
let page = 1;
const page_size = 20;
let total = 0;

onMounted(async () => {
  const key = await bitable.bridge.getData("api_key");
  if (key && typeof key === "string") {
    api_key.value = key;
  }
  const note_url = await bitable.bridge.getData("note_url");
  const note_platform = await bitable.bridge.getData("note_platform");
  if (note_url && typeof note_url == "string") {
    formData.value.url = note_url;
  }
  if (note_platform && typeof note_platform == "string") {
    formData.value.social_type = note_platform;
  }
});

onUnmounted(() => {
  closeNoteInterval();
});

const saveApiKey = async () => {
  if (api_key.value === "") {
    return;
  } else {
    api_key_disabled.value = true;
    bitable.bridge.setData("api_key", api_key.value);
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
const createAndWriteData = async (list, type, task_id) => {
  if (!list || list.length == 0) {
    ElMessage({
      message: "获取数据异常，请稍后重试",
      type: "warning",
      plain: true,
    });
    resetParams();
    return;
  }
  try {
    const fields = [
      { type: FieldType.Text, name: "文本" },
      { type: FieldType.Text, name: "头像" },
      { type: FieldType.Text, name: "昵称" },
      { type: FieldType.Text, name: "IP地址" },
      { type: FieldType.DateTime, name: "评论时间" },
    ];
    // console.log("🚀 ~ createAndWriteData ~ fields:", fields)
    // 创建表格，创建表格中的字段
    if (!type) { // 第一次请求
      let tableName = '';
      // const firstItem = list[0];
      tableName = '社媒评论加载工具';

      // 创建表格
      const { tableId, index } = await createSequentialTable(tableName);
      const newTable = await bitable.base.getTable(tableId);
      // console.log("🚀 ~ createAndWriteData ~ newTable:", newTable)
      await bitable.ui.switchToTable(tableId);
      // 修改表格中第一个字段
      const first_field = await newTable.getField('文本');
      // 批量添加字段（并行处理提高效率）
      const fieldPromises = fields.map((config, index) => {
        if (index === 0 && first_field) {
          return newTable.setField(first_field.id, {
            ...config,
          })
        }
        return newTable.addField({
          ...config,
        })
      }
      );
      const createdFields = await Promise.all(fieldPromises);
      // console.log(`表格"${tableName}"创建成功，包含${createdFields.length}个字段`);
    }
    // 写入数据
    const activeTable = await bitable.base.getActiveTable();
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
      record.push(await fieldList[0].createCell(item.text));
      record.push(await fieldList[1].createCell(item.avatar));
      record.push(await fieldList[2].createCell(item.nickname));
      record.push(await fieldList[3].createCell(item.ip_label));
      record.push(await fieldList[4].createCell(item.t_create ? item.t_create * 1000 : ''));
      records.push(record);
    }
    // 写入记录
    const recordIds = await activeTable.addRecords(records);
    // console.log(`成功添加 ${recordIds.length} 条数据`, ' - ' + total + ' - ', page + ' - ', total > page);

    if (total > page) {
      page += 1;
      getList(task_id, 'next');
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

// 主页 提交任务
const postNoteTask = async () => {
  await request({
    url: "/social/api/v1/feishu/comment/task",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
    },
    data: {
      url: formData.value.url,
      social_type: formData.value.social_type,
      pages: Number(formData.value.pages),
    },
  })
    .then(function (response) {
      // loading.value = false;
      let res = response.data;
      if (res.sta == 0) {
        const data = res.data;
        getNoteTaskInterval(data.task_id);
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
const getNoteTaskInterval = (task_id) => {
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
        getNoteTask(task_id);
      }
    }, 3000)
  }
  requestFn();
};

// 主页 获取任务状态
const getNoteTask = async (task_id) => {
  await request({
    url: "/social/api/v1/feishu/comment/task?task_id=" + task_id,
    method: "get",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
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
          getList(task_id);
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
const getList = async (task_id, type) => {
  await request({
    url: "/social/api/v1/feishu/comment/list",
    method: "post",
    headers: {
      'authorization': `Bearer ${api_key.value}`,
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
          createAndWriteData(data, '', task_id);
        } else if (type == 'next') {
          createAndWriteData(data, type, task_id);
        }
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

// 主页数据
const getNoteData = async () => {
  // 新建表格，表格中第一个字段为视频编号
  // createAndWriteData([]);
  // return;
  loading.value = true;
  await postNoteTask();
};

const commit = () => {
  if (loading.value) return;
  if (!api_key.value) {
    showErrorMsg("请输入API key");
    return;
  }
  const { url } = formData.value;
  if (!String(url)) {
    showErrorMsg("请输入帖子链接");
    return;
  }
  getNoteData();
  //
  bitable.bridge.setData("note_url", formData.value.url);
  bitable.bridge.setData("note_platform", formData.value.social_type);

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
          <el-radio :value="2" :disabled="true">使用现有表格</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item>
        <div slot="label" class="c-label">
          帖子链接
          <el-tooltip effect="dark" placement="top">
            <template #content>帖子链接</template>
            <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
              class="help-icon" />
          </el-tooltip>
        </div>
        <el-input v-model="formData.url" class="c-input" placeholder="" />
      </el-form-item>
      <el-form-item label="">
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
      </el-form-item>
      <el-form-item label="">
        <div slot="label" class="c-label">
          数据提取范围
          <el-tooltip effect="dark" placement="top">
            <template #content>每页 50 积分，实际扣费会按照<br />提取的页数进行计算</template>
            <img src="https://cdn.zhinizhushou.com/material/20250826/45c287c837d7c34626a8f441264db162.png"
              class="help-icon" />
          </el-tooltip>
        </div>
        <el-select v-model="formData.pages" placeholder="请选择" style="width: 100%">
          <el-option v-for="tl in pages_options" :key="tl.value" :label="tl.label" :value="tl.value" />
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
