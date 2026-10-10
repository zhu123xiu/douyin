const cloud = require("wx-server-sdk");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DATA_DIR = path.join(__dirname, "data");
const DEFAULT_LIMIT = 20;
const FEEDBACK_COLLECTION = "communication_feedback";
const ACTIVATION_CODE_COLLECTION = "communication_activation_codes";
const CHAPTER_COLLECTION = "communication_chapters";
const CHAPTER_SHARD_PREFIX = "communication_chapters_";
const developerOpenids = require("./developer-openids");

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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (error) {
    const message = String(error && (error.errMsg || error.message || error));
    if (!/exist|already|COLLECTION_EXIST/i.test(message)) {
      throw error;
    }
  }
}

function isChapterShard(fileName) {
  return (
    fileName.startsWith(CHAPTER_SHARD_PREFIX) &&
    fileName.endsWith(".json") &&
    !fileName.endsWith(".schema.json")
  );
}

function getChapterShardFiles() {
  return fs.readdirSync(DATA_DIR).filter(isChapterShard).sort();
}

function getChapterShardList() {
  return [`${CHAPTER_COLLECTION}.json`, ...getChapterShardFiles()];
}

function getDatasetNames() {
  return fs
    .readdirSync(DATA_DIR)
    .filter(
      (fileName) =>
        fileName.endsWith(".json") &&
        !fileName.endsWith(".schema.json") &&
        !isChapterShard(fileName)
    )
    .map((fileName) => fileName.replace(/\.json$/, ""))
    .sort();
}

function getSchema(collection) {
  const schemaPath = path.join(DATA_DIR, `${collection}.schema.json`);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`缺少 schema 文件: ${collection}.schema.json`);
  }
  return readJsonFile(schemaPath);
}

function getDataset(collection) {
  const filePath = path.join(DATA_DIR, `${collection}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少数据文件: ${collection}.json`);
  }
  const data = readJsonFile(filePath);
  if (!Array.isArray(data)) {
    throw new Error(`${collection}.json 必须是数组`);
  }
  return data;
}

function getShardDataset(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`缺少分片文件: ${fileName}`);
  }
  const data = readJsonFile(filePath);
  if (!Array.isArray(data)) {
    throw new Error(`${fileName} 必须是数组`);
  }
  return data;
}

function validateType(value, expected) {
  if (expected === "array") {
    return Array.isArray(value);
  }
  if (expected === "number") {
    return typeof value === "number" && !Number.isNaN(value);
  }
  if (expected === "boolean") {
    return typeof value === "boolean";
  }
  if (expected === "object") {
    return value && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === expected;
}

function validateItem(item, schema) {
  const requiredFields = schema.requiredFields || {};
  const optionalFields = schema.optionalFields || {};

  Object.keys(requiredFields).forEach((field) => {
    if (typeof item[field] === "undefined") {
      throw new Error(`字段缺失: ${field}`);
    }
    if (!validateType(item[field], requiredFields[field])) {
      throw new Error(`字段类型错误: ${field}`);
    }
  });

  Object.keys(optionalFields).forEach((field) => {
    if (typeof item[field] !== "undefined" && !validateType(item[field], optionalFields[field])) {
      throw new Error(`字段类型错误: ${field}`);
    }
  });

  const arrayItemRequired = schema.arrayItemRequired || {};
  Object.keys(arrayItemRequired).forEach((field) => {
    if (!Array.isArray(item[field])) {
      return;
    }
    item[field].forEach((child) => {
      arrayItemRequired[field].forEach((childField) => {
        if (typeof child[childField] === "undefined") {
          throw new Error(`数组字段缺失: ${field}.${childField}`);
        }
      });
    });
  });
}

function validateTopicItem(item) {
  const type = item.contentType || "response";
  if (!["response", "proactive"].includes(type)) {
    throw new Error(`contentType 无效: ${item._id}`);
  }
  if (!Array.isArray(item.tags)) {
    throw new Error(`tags 必须是数组: ${item._id}`);
  }
  if (type === "response") {
    ["scenario", "scenarioDesc", "wrongScripts", "rightScripts", "tips"].forEach((field) => {
      if (typeof item[field] === "undefined") {
        throw new Error(`response 字段缺失: ${item._id}.${field}`);
      }
    });
    return;
  }
  [
    "title",
    "momentKey",
    "moment",
    "sceneDescription",
    "approachTitle",
    "script",
    "whyItWorks",
    "task",
    "fallback",
    "reflection",
  ].forEach((field) => {
    if (typeof item[field] !== "string" || !item[field].trim()) {
      throw new Error(`proactive 字段缺失: ${item._id}.${field}`);
    }
  });
  if (item.tags.length < 2 || item.tags.length > 3) {
    throw new Error(`proactive tags 必须包含 2 到 3 项: ${item._id}`);
  }
}

function validateTrainingPlanItem(item) {
  if (item.planType !== "theme_week" || item.memberOnly !== true) {
    throw new Error(`主题周必须是 memberOnly: true: ${item._id}`);
  }
  if (!Array.isArray(item.days) || item.days.length !== 7) {
    throw new Error(`主题周必须包含 7 个 Day: ${item._id}`);
  }
  item.days.forEach((day) => {
    [
      "title",
      "moment",
      "action",
      "scriptTemplate",
      "scriptExample",
      "fallback",
      "completionRule",
      "reflection",
      "reflectionExample",
    ].forEach((field) => {
      if (typeof day[field] !== "string" || !day[field].trim()) {
        throw new Error(
          `主题周 Day 字段缺失: ${item._id}.days.${day.day}.${field}`
        );
      }
    });
    if (!/【[^】]+】/.test(day.scriptTemplate)) {
      throw new Error(`scriptTemplate 必须包含可替换占位符: ${item._id}.days.${day.day}`);
    }
    if (day.scriptTemplate === day.scriptExample) {
      throw new Error(`scriptExample 不能与模板相同: ${item._id}.days.${day.day}`);
    }
  });
}

async function removeObsoleteRecords(collection, dataset) {
  const activeTopicIds = new Set(dataset.map((item) => item._id));
  const staleTopicIds = [];
  let offset = 0;

  while (true) {
    const response = await db
      .collection(collection)
      .orderBy("_id", "asc")
      .skip(offset)
      .limit(DEFAULT_LIMIT)
      .get();
    const records = response.data || [];

    records.forEach((record) => {
      if (!activeTopicIds.has(record._id)) {
        staleTopicIds.push(record._id);
      }
    });

    if (records.length < DEFAULT_LIMIT) {
      break;
    }
    offset += records.length;
  }

  for (let index = 0; index < staleTopicIds.length; index += 1) {
    await db.collection(collection).doc(staleTopicIds[index]).remove();
  }

  return staleTopicIds.length;
}

async function handleScan(openid) {
  const authorized = isAuthorized(openid);
  const datasets = [];
  const names = getDatasetNames();

  for (let index = 0; index < names.length; index += 1) {
    const collection = names[index];
    const schema = getSchema(collection);
    const isChapterCollection = collection === CHAPTER_COLLECTION;
    const shardFiles = isChapterCollection ? getChapterShardList() : null;
    const localCount = isChapterCollection
      ? shardFiles.reduce((count, fileName) => count + getShardDataset(fileName).length, 0)
      : getDataset(collection).length;
    let cloudCount = 0;

    try {
      const response = await db.collection(collection).count();
      cloudCount = response.total || 0;
    } catch (error) {
      cloudCount = 0;
    }

    datasets.push({
      collection,
      label: schema.label || collection,
      localCount,
      cloudCount,
      shardFiles,
    });
  }

  return {
    success: true,
    authorized,
    openid,
    datasets,
  };
}

async function handleImport(openid, event) {
  if (!isAuthorized(openid)) {
    throw new Error("当前账号不在开发者白名单中");
  }
  if (!event.collection) {
    throw new Error("缺少 collection");
  }

  const schema = getSchema(event.collection);
  const isChapterCollection = event.collection === CHAPTER_COLLECTION;
  let shardFiles = null;
  let shardIndex = 0;
  let dataset;

  if (isChapterCollection) {
    shardFiles = getChapterShardList();
    shardIndex = Math.max(Math.floor(Number(event.shardIndex) || 0), 0);
    if (shardIndex >= shardFiles.length) {
      return {
        success: true,
        collection: event.collection,
        imported: 0,
        nextOffset: 0,
        shardIndex,
        shardFiles,
        done: true,
        total: 0,
        removed: 0,
      };
    }
    dataset = getShardDataset(shardFiles[shardIndex]);
  } else {
    dataset = getDataset(event.collection);
  }
  const offset = Math.max(Number(event.offset) || 0, 0);
  const limit = Math.max(Number(event.limit) || DEFAULT_LIMIT, 1);
  const chunk = dataset.slice(offset, offset + limit);

  for (let index = 0; index < chunk.length; index += 1) {
    const item = chunk[index];
    validateItem(item, schema);
    if (event.collection === "communication_topics") {
      validateTopicItem(item);
    }
    if (event.collection === "training_plans") {
      validateTrainingPlanItem(item);
    }
    if (!item._id) {
      throw new Error("导入数据必须包含 _id");
    }
    const { _id: documentId, ...documentData } = item;
    await db.collection(event.collection).doc(documentId).set({
      data: documentData,
    });
  }

  const nextOffset = offset + chunk.length;
  const shardDone = nextOffset >= dataset.length;
  let done = shardDone;
  let nextShardIndex = null;
  if (isChapterCollection) {
    nextShardIndex = shardDone ? shardIndex + 1 : shardIndex;
    done = nextShardIndex >= shardFiles.length;
  }
  const removed =
    done && ["communication_topics", "training_plans"].includes(event.collection)
      ? await removeObsoleteRecords(event.collection, dataset)
      : 0;

  return {
    success: true,
    collection: event.collection,
    imported: chunk.length,
    nextOffset: isChapterCollection && shardDone ? 0 : nextOffset,
    shardIndex: nextShardIndex,
    shardFiles,
    done,
    total: dataset.length,
    removed,
  };
}

async function handleFeedbackList(openid, event) {
  if (!isAuthorized(openid)) {
    throw new Error("当前账号不在开发者白名单中");
  }
  const requestedStatus = String(event.status || "all");
  const status = ["all", "pending", "replied"].includes(requestedStatus)
    ? requestedStatus
    : "all";
  const collection = db.collection(FEEDBACK_COLLECTION);
  const query = status === "all" ? collection : collection.where({ status });
  const response = await query
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return {
    success: true,
    feedbacks: response.data || [],
  };
}

async function handleFeedbackReply(openid, event) {
  if (!isAuthorized(openid)) {
    throw new Error("当前账号不在开发者白名单中");
  }
  const feedbackId = String(event.feedbackId || "").trim();
  const reply = String(event.reply || "").trim().slice(0, 1000);
  if (!feedbackId) {
    throw new Error("缺少反馈 ID");
  }
  if (!reply) {
    throw new Error("请填写回复内容");
  }

  await db.collection(FEEDBACK_COLLECTION).doc(feedbackId).update({
    data: {
      reply,
      status: "replied",
      repliedAt: db.serverDate(),
    },
  });
  return {
    success: true,
    feedbackId,
    status: "replied",
  };
}

function buildActivationCode() {
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `ACT-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function handleActivationCodeGenerate(openid, event) {
  if (!isAuthorized(openid)) {
    throw new Error("当前账号不在开发者白名单中");
  }
  const count = Math.min(Math.max(Math.floor(Number(event.count) || 1), 1), 50);
  await ensureCollection(ACTIVATION_CODE_COLLECTION);
  const codes = [];
  let attempts = 0;
  while (codes.length < count && attempts < count * 5) {
    attempts += 1;
    const code = buildActivationCode();
    try {
      await db.collection(ACTIVATION_CODE_COLLECTION).doc(code).set({
        data: {
          code,
          type: "membership",
          status: "unused",
          createdBy: openid,
          createdAt: db.serverDate(),
        },
      });
      codes.push(code);
    } catch (error) {
      // 极低概率的随机码碰撞，重新生成即可。
    }
  }
  if (codes.length !== count) {
    throw new Error("激活码生成失败，请重试");
  }
  return { success: true, codes };
}

async function handleActivationCodeList(openid) {
  if (!isAuthorized(openid)) {
    throw new Error("当前账号不在开发者白名单中");
  }
  await ensureCollection(ACTIVATION_CODE_COLLECTION);
  const response = await db
    .collection(ACTIVATION_CODE_COLLECTION)
    .where({ status: "unused" })
    .limit(100)
    .get();
  const records = (response.data || []).sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime();
    const rightTime = new Date(right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
  return {
    success: true,
    codes: records.map((item) => item.code || item._id),
  };
}

exports.main = async (event) => {
  try {
    const openid = getRequesterOpenid();

    switch (event.action) {
      case "scan":
        return await handleScan(openid);
      case "import":
        { const result = await handleImport(openid, event); if (result && result.success) { await cloud.callFunction({ name: "topicData", data: { action: "rebuildStats" } }).catch(() => {}); } return result; }
      case "feedbackList":
        return await handleFeedbackList(openid, event);
      case "feedbackReply":
        return await handleFeedbackReply(openid, event);
      case "activationCodeGenerate":
        return await handleActivationCodeGenerate(openid, event);
      case "activationCodeList":
        return await handleActivationCodeList(openid);
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "importData 执行失败",
    };
  }
};
