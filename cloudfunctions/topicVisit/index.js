const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const VISIT_COLLECTION = "communication_topic_visits";
const TOPIC_COLLECTION = "communication_topics";

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
}

async function handleRecord(openid, event) {
  if (!event.topicId) {
    throw new Error("缺少 topicId");
  }
  const docId = `${openid}_${event.topicId}`;
  const [topicResponse, visitResponse] = await Promise.all([
    db.collection(TOPIC_COLLECTION).doc(event.topicId).get(),
    db
      .collection(VISIT_COLLECTION)
      .doc(docId)
      .get()
      .catch(() => ({ data: null })),
  ]);
  const topic = topicResponse.data;
  if (!topic || topic.status !== "published") {
    throw new Error("话题不存在");
  }
  const current = visitResponse.data;

  // `_id` is supplied by doc(docId); it is a reserved field and cannot be
  // included in the data payload passed to set().
  const visitData = Object.assign({}, current || {}, {
    openid,
    topicId: event.topicId,
    ageGroup: topic.ageGroup,
    level1: topic.level1,
    level2: topic.level2,
    firstViewedAt: current && current.firstViewedAt ? current.firstViewedAt : db.serverDate(),
    lastViewedAt: db.serverDate(),
  });
  delete visitData._id;
  delete visitData._openid;

  await db.collection(VISIT_COLLECTION).doc(docId).set({
    data: visitData,
  });

  return {
    success: true,
  };
}

async function handleStats(openid) {
  const [visitCount, topicCount] = await Promise.all([
    db.collection(VISIT_COLLECTION).where({ openid }).count(),
    db.collection(TOPIC_COLLECTION).where({ status: "published" }).count(),
  ]);

  return {
    success: true,
    viewedCount: visitCount.total || 0,
    totalCount: topicCount.total || 0,
  };
}

exports.main = async (event) => {
  try {
    const openid = getRequesterOpenid();
    if (!openid) {
      throw new Error("未获取到用户身份");
    }

    switch (event.action) {
      case "record":
        return await handleRecord(openid, event);
      case "stats":
        return await handleStats(openid);
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "topicVisit 执行失败",
    };
  }
};
