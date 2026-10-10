const cloud = require("wx-server-sdk");
const fs = require("fs");
const path = require("path");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DATA_DIR = path.join(__dirname, "data");
const developerOpenids = require("./developer-openids");

const DATASETS = [
  {
    collection: "communication_packages",
    label: "专题包目录",
    fileName: "communication_package_catalog.json",
  },
  {
    collection: "communication_chapters",
    label: "专题包章节",
    fileName: "communication_chapters.json",
  },
];

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
}

function getExtraDeveloperOpenids() {
  const raw = process.env.DEVELOPER_OPENIDS || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAuthorized(openid) {
  const allowList = developerOpenids.concat(getExtraDeveloperOpenids());
  if (!allowList.length) {
    return false;
  }
  return allowList.indexOf(openid) >= 0;
}

function readJsonFile(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少数据文件: ${fileName}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error(`${fileName} 必须是数组`);
  }
  return data;
}

async function countCollection(collection) {
  try {
    const response = await db.collection(collection).count();
    return response.total || 0;
  } catch (error) {
    return 0;
  }
}

async function handleStatus(openid) {
  const datasets = await Promise.all(
    DATASETS.map(async (item) => {
      const localData = readJsonFile(item.fileName);
      return {
        collection: item.collection,
        label: item.label,
        localCount: localData.length,
        cloudCount: await countCollection(item.collection),
      };
    })
  );

  return {
    success: true,
    authorized: isAuthorized(openid),
    openid,
    datasets,
  };
}

async function importDataset(dataset) {
  const records = readJsonFile(dataset.fileName);
  for (let index = 0; index < records.length; index += 1) {
    const item = records[index];
    if (!item || !item._id) {
      throw new Error(`${dataset.fileName} 中存在缺少 _id 的记录`);
    }
    await db.collection(dataset.collection).doc(item._id).set({
      data: item,
    });
  }
  return {
    collection: dataset.collection,
    imported: records.length,
  };
}

async function handleImport(openid, event) {
  if (!isAuthorized(openid)) {
    throw new Error("当前账号不在开发者白名单中");
  }
  const targetCollection = event.collection || "";
  const targets = targetCollection
    ? DATASETS.filter((item) => item.collection === targetCollection)
    : DATASETS;
  if (!targets.length) {
    throw new Error("未找到可导入的数据集");
  }

  const results = [];
  for (let index = 0; index < targets.length; index += 1) {
    results.push(await importDataset(targets[index]));
  }

  return {
    success: true,
    importedCollections: results,
  };
}

exports.main = async (event) => {
  try {
    const openid = getRequesterOpenid();
    switch (event.action) {
      case "status":
        return await handleStatus(openid);
      case "import":
        { const result = await handleImport(openid, event); if (result && result.success) { await cloud.callFunction({ name: "topicData", data: { action: "rebuildStats" } }).catch(() => {}); } return result; }
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "packageImport 执行失败",
    };
  }
};
