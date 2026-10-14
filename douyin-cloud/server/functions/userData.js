const cloud = require("../wx-compat");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const FAVORITE_COLLECTION = "communication_favorites";
const TOPIC_COLLECTION = "communication_topics";
const PROFILE_COLLECTION = "communication_user_profiles";
const FEEDBACK_COLLECTION = "communication_feedback";
const AGE_GROUPS = ["3-6", "7-9", "10-12"];
const FEEDBACK_CATEGORIES = ["suggestion", "content", "bug", "other"];
let favoriteCollectionReadyPromise = null;

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

function ensureFavoriteCollection() {
  if (!favoriteCollectionReadyPromise) {
    favoriteCollectionReadyPromise = ensureCollection(FAVORITE_COLLECTION).catch(
      (error) => {
        favoriteCollectionReadyPromise = null;
        throw error;
      }
    );
  }
  return favoriteCollectionReadyPromise;
}

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
}

async function getTopic(topicId) {
  const response = await db.collection(TOPIC_COLLECTION).doc(topicId).get();
  return response.data;
}

function getBusinessDateKey() {
  const shanghaiTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = shanghaiTime.getUTCFullYear();
  const month = String(shanghaiTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shanghaiTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getProfile(openid) {
  try {
    const response = await db.collection(PROFILE_COLLECTION).doc(openid).get();
    return response.data || {};
  } catch (error) {
    return {};
  }
}

async function updateProfile(openid, data) {
  try {
    await db.collection(PROFILE_COLLECTION).doc(openid).update({
      data: Object.assign({}, data, { updatedAt: db.serverDate() }),
    });
  } catch (error) {
    await db.collection(PROFILE_COLLECTION).doc(openid).set({
      data: Object.assign(
        { _id: openid, _openid: openid },
        data,
        { createdAt: db.serverDate(), updatedAt: db.serverDate() }
      ),
    });
  }
}

async function handleSetProfileAgeGroup(openid, event) {
  if (AGE_GROUPS.indexOf(event.ageGroup) < 0) {
    throw new Error("年龄段无效");
  }
  const profile = await getProfile(openid);
  const progress = Object.assign({}, profile.trainingProgress || {}, {
    selectedAgeGroup: event.ageGroup,
    currentPlan: null,
    onboardingDone: false,
    completedPlans: [],
  });
  await updateProfile(openid, {
    trainingProgress: progress,
    themeWeekProgress: {
      activePlanId: "",
      startedAt: "",
      completedDays: [],
      dayRecords: {},
      completedPlanIds: [],
    },
    dailyPractice: {
      dateKey: "",
      topicId: "",
      category: "",
      preferredCategory: "",
      completed: false,
      recentTopicIds: [],
    },
  });
  return { success: true };
}

async function handleSetDailyPracticePreference(openid, event) {
  if (!event.category) {
    throw new Error("缺少 category");
  }
  const profile = await getProfile(openid);
  const ageGroup = (profile.trainingProgress || {}).selectedAgeGroup;
  const result = await db
    .collection(TOPIC_COLLECTION)
    .where({ ageGroup, status: "published", level1: event.category })
    .limit(1)
    .get();
  if (!(result.data || []).length) {
    throw new Error("该方向当前没有可用话题");
  }
  const dailyPractice = Object.assign({}, profile.dailyPractice || {}, {
    preferredCategory: event.category,
  });
  await updateProfile(openid, { dailyPractice });
  return { success: true };
}

async function handleCompleteDailyPractice(openid, event) {
  const profile = await getProfile(openid);
  const dailyPractice = profile.dailyPractice || {};
  if (
    dailyPractice.dateKey !== getBusinessDateKey() ||
    dailyPractice.topicId !== event.topicId
  ) {
    throw new Error("今日练习已更新");
  }
  await updateProfile(openid, {
    dailyPractice: Object.assign({}, dailyPractice, {
      completed: true,
      completedAt: db.serverDate(),
    }),
  });
  return { success: true };
}

function createFeedbackId() {
  return `fb_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function normalizeFeedbackText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function handleSubmitFeedback(openid, event) {
  const category = normalizeFeedbackText(event.category, 32);
  const content = normalizeFeedbackText(event.content, 1000);
  const contact = normalizeFeedbackText(event.contact, 100);
  if (!FEEDBACK_CATEGORIES.includes(category)) {
    throw new Error("反馈类型无效");
  }
  if (!content) {
    throw new Error("请填写反馈内容");
  }

  const feedbackId = createFeedbackId();
  await db.collection(FEEDBACK_COLLECTION).doc(feedbackId).set({
    data: {
      openid,
      category,
      content,
      contact,
      status: "pending",
      reply: "",
      createdAt: db.serverDate(),
      repliedAt: null,
    },
  });
  return {
    success: true,
    feedback: {
      _id: feedbackId,
      category,
      content,
      contact,
      status: "pending",
      reply: "",
    },
  };
}

async function handleListFeedback(openid) {
  const response = await db
    .collection(FEEDBACK_COLLECTION)
    .where({ openid })
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();
  return {
    success: true,
    feedbacks: response.data || [],
  };
}

async function handleFavoriteIds(openid) {
  const favoriteIds = (await fetchAllFavorites(openid)).map((item) => item.topicId);
  return {
    success: true,
    favoriteIds,
  };
}

async function fetchAllFavorites(openid) {
  await ensureFavoriteCollection();
  const items = []; let skip = 0;
  while (true) {
    const response = await db.collection(FAVORITE_COLLECTION).where({ openid }).skip(skip).limit(100).get();
    const page = response.data || []; items.push(...page); if (page.length < 100) break; skip += page.length;
  }
  items.sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
  return items;
}

async function handleToggleFavorite(openid, event) {
  if (!event.topicId) {
    throw new Error("缺少 topicId");
  }
  await ensureFavoriteCollection();
  const docId = `${openid}_${event.topicId}`;

  try {
    await db.collection(FAVORITE_COLLECTION).doc(docId).get();
    await db.collection(FAVORITE_COLLECTION).doc(docId).remove();
    return {
      success: true,
      favorited: false,
    };
  } catch (error) {
    const topic = await getTopic(event.topicId);
    if (!topic || topic.status !== "published") {
      throw new Error("话题不存在或不可收藏");
    }
    await db.collection(FAVORITE_COLLECTION).doc(docId).set({
      data: {
        openid,
        topicId: event.topicId,
        ageGroup: topic.ageGroup,
        level1: topic.level1,
        level2: topic.level2,
        scenario: topic.scenario,
        createdAt: db.serverDate(),
      },
    });
    return {
      success: true,
      favorited: true,
    };
  }
}

async function handleListFavorites(openid) {
  const favorites = await fetchAllFavorites(openid);
  if (!favorites.length) {
    return {
      success: true,
      favorites: [],
      total: 0,
      stats: {},
    };
  }

  const topicIds = favorites.map((item) => item.topicId);
  const topicMap = new Map();
  for (let i = 0; i < topicIds.length; i += 50) {
    const topicResponse = await db.collection(TOPIC_COLLECTION).where({ _id: db.command.in(topicIds.slice(i, i + 50)), status: "published" }).get();
    (topicResponse.data || []).forEach((topic) => topicMap.set(topic._id, topic));
  }

  const list = [];
  const stats = {};

  favorites.forEach((item) => {
    const topic = topicMap.get(item.topicId);
    if (!topic) {
      return;
    }
    const merged = Object.assign({}, topic, {
      favoriteAt: item.createdAt,
      favorited: true,
    });
    list.push(merged);
    stats[topic.level2] = (stats[topic.level2] || 0) + 1;
  });

  return {
    success: true,
    favorites: list,
    total: list.length,
    stats,
  };
}

exports.main = async (event) => {
  try {
    const openid = getRequesterOpenid();
    if (!openid) {
      throw new Error("未获取到用户身份");
    }

    switch (event.action) {
      case "favoriteIds":
        return await handleFavoriteIds(openid);
      case "toggleFavorite":
        return await handleToggleFavorite(openid, event);
      case "listFavorites":
        return await handleListFavorites(openid);
      case "setProfileAgeGroup":
        return await handleSetProfileAgeGroup(openid, event);
      case "setDailyPracticePreference":
        return await handleSetDailyPracticePreference(openid, event);
      case "completeDailyPractice":
        return await handleCompleteDailyPractice(openid, event);
      case "submitFeedback":
        return await handleSubmitFeedback(openid, event);
      case "listFeedback":
        return await handleListFeedback(openid);
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "userData 执行失败",
    };
  }
};
