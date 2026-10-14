const cloud = require("../wx-compat");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TOPIC_COLLECTION = "communication_topics";
const PROFILE_COLLECTION = "communication_user_profiles";
const PACKAGE_COLLECTION = "communication_packages";
const AGE_GROUPS = ["3-6", "7-9", "10-12"];
const MAX_QUERY_LIMIT = 50;
const STATS_COLLECTION = "communication_stats";
const DAILY_CHANGE_LIMIT = 3;

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
}

function getBusinessDateKey() {
  const shanghaiTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = shanghaiTime.getUTCFullYear();
  const month = String(shanghaiTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shanghaiTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getUserProfile(openid) {
  if (!openid) {
    return {
      membershipActive: false,
      unlockedTopicIds: [],
      trainingProgress: {},
      dailyPractice: {},
    };
  }
  try {
    const response = await db.collection(PROFILE_COLLECTION).doc(openid).get();
    const profile = response.data || {};
    return {
      membershipActive: Boolean(profile.membershipActive || profile.activated),
      unlockedTopicIds: Array.isArray(profile.unlockedTopicIds) ? profile.unlockedTopicIds : [],
      trainingProgress: profile.trainingProgress || {},
      dailyPractice: profile.dailyPractice || {},
    };
  } catch (error) {
    return {
      membershipActive: false,
      unlockedTopicIds: [],
      trainingProgress: {},
      dailyPractice: {},
    };
  }
}

function normalizeTopic(topic) {
  const contentType = topic.contentType || "response";
  return Object.assign({}, topic, {
    contentType,
    displayTitle: contentType === "proactive" ? topic.title : topic.scenario,
  });
}

function isTodayFree(topic, profile, today) {
  const dailyPractice = profile.dailyPractice || {};
  return (
    dailyPractice.dateKey === today &&
    dailyPractice.topicId === topic._id
  );
}

function isPermanentlyFree(topic) {
  return Boolean(topic.isFree);
}

function isUnlocked(topic, profile, today) {
  return Boolean(
    isPermanentlyFree(topic) ||
      profile.membershipActive ||
      profile.unlockedTopicIds.indexOf(topic._id) >= 0 ||
      isTodayFree(topic, profile, today)
  );
}

function toPreviewTopic(topic) {
  const normalized = normalizeTopic(topic);
  if (normalized.contentType === "proactive") {
    return Object.assign({}, normalized, {
      approachTitle: "",
      script: "",
      whyItWorks: "",
      task: "",
      fallback: "",
      reflection: "",
    });
  }
  return Object.assign({}, normalized, {
    wrongScripts: [],
    rightScripts: [],
    tips: "",
  });
}

function hashText(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return hash >>> 0;
}

async function getStats() {
  try { const response = await db.collection(STATS_COLLECTION).doc("stats_v1").get(); return response.data || null; } catch (error) { return null; }
}

async function rebuildStats() {
  const topics = []; let skip = 0;
  while (true) {
    const response = await db.collection(TOPIC_COLLECTION).where({ status: "published" }).field({ ageGroup: true, contentType: true, level1: true, isFree: true }).skip(skip).limit(MAX_QUERY_LIMIT).get();
    const page = response.data || []; topics.push(...page); if (page.length < MAX_QUERY_LIMIT) break; skip += page.length;
  }
  const counts = {}, countsByType = {}, level1 = {}; let totalFree = 0;
  topics.forEach((t) => { counts[t.ageGroup] = (counts[t.ageGroup] || 0) + 1; const key = `${t.ageGroup}:${t.contentType || "response"}`; countsByType[key] = countsByType[key] || { total: 0, free: 0 }; countsByType[key].total += 1; if (t.isFree) { countsByType[key].free += 1; totalFree += 1; } level1[key] = level1[key] || []; if (t.level1 && !level1[key].includes(t.level1)) level1[key].push(t.level1); });
  await db.collection(STATS_COLLECTION).doc("stats_v1").set({ data: { counts, countsByType, level1, totalCount: topics.length, totalFree, rebuiltAt: db.serverDate() } });
  return { success: true, totalCount: topics.length };
}

async function getStatsWithFallback() {
  const [stats, countResult] = await Promise.all([getStats(), db.collection(TOPIC_COLLECTION).where({ status: "published" }).count()]);
  if (stats && stats.totalCount === (countResult.total || 0)) return stats;
  await rebuildStats(); return getStats();
}

async function handleCounts() {
  const stats = await getStatsWithFallback();
  if (stats) return { success: true, counts: stats.counts || {} };
  const counts = {};
  await Promise.all(
    AGE_GROUPS.map(async (ageGroup) => {
      const result = await db
        .collection(TOPIC_COLLECTION)
        .where({ ageGroup, status: "published" })
        .count();
      counts[ageGroup] = result.total || 0;
    })
  );
  return { success: true, counts };
}

async function handleLibraryStats() {
  const stats = await getStatsWithFallback();
  if (stats) {
    const totalCount = stats.totalCount || 0;
    const freeCount = stats.totalFree || 0;
    return { success: true, freeCount, totalCount, percent: totalCount ? Math.round((freeCount / totalCount) * 100) : 0 };
  }
  const [allCount, freeCount] = await Promise.all([
    db.collection(TOPIC_COLLECTION).where({ status: "published" }).count(),
    db
      .collection(TOPIC_COLLECTION)
      .where({ status: "published", isFree: true })
      .count(),
  ]);
  const totalCount = allCount.total || 0;
  const free = freeCount.total || 0;

  return {
    success: true,
    freeCount: free,
    totalCount,
    percent: totalCount ? Math.round((free / totalCount) * 100) : 0,
  };
}

async function listDistinctCategories(ageGroup, contentType) {
  if (!ageGroup) {
    return [];
  }
  const categories = new Set();
  let skip = 0;
  while (true) {
    const response = await db
      .collection(TOPIC_COLLECTION)
      .where(Object.assign({ ageGroup, status: "published" }, contentType ? { contentType } : {}))
      .field({ level1: true, sortOrder: true })
      .orderBy("sortOrder", "asc")
      .skip(skip)
      .limit(MAX_QUERY_LIMIT)
      .get();
    const topics = response.data || [];
    topics.forEach((topic) => {
      if (topic.level1) categories.add(topic.level1);
    });
    if (topics.length < MAX_QUERY_LIMIT) break;
    skip += topics.length;
  }
  return Array.from(categories);
}

async function handleLevel1List(event) {
  let cachedCategories = [];
  if (event.contentType) {
    try {
      const stats = await getStatsWithFallback();
      const key = `${event.ageGroup}:${event.contentType}`;
      cachedCategories = stats && stats.level1 && stats.level1[key]
        ? stats.level1[key]
        : [];
    } catch (error) {
      // Fall through to the live collection query when stats are stale or
      // temporarily unavailable.
    }
  }

  const liveCategories = await listDistinctCategories(event.ageGroup, event.contentType);
  const categories = liveCategories.length ? liveCategories : cachedCategories;
  return { success: true, categories };
}

async function handleDailyPracticeCategories(event) {
  const profile = await getUserProfile(getRequesterOpenid());
  const ageGroup = event.ageGroup || profile.trainingProgress.selectedAgeGroup;
  return {
    success: true,
    categories: await listDistinctCategories(ageGroup, "proactive"),
  };
}

function matchesKeyword(topic, keyword) {
  if (!keyword) return true;
  const searchable = [
    topic.title,
    topic.scenario,
    topic.scenarioDesc,
    topic.sceneDescription,
    topic.moment,
    topic.level1,
    topic.level2,
    topic.abilityFocus,
    topic.valueHook,
    Array.isArray(topic.tags) ? topic.tags.join(" ") : topic.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchable.indexOf(keyword) >= 0;
}

function buildListQuery(event) {
  const query = {
    ageGroup: event.ageGroup,
    status: "published",
  };
  if (event.level1) query.level1 = String(event.level1).trim();
  if (event.contentType) query.contentType = String(event.contentType).trim();
  if (event.momentKey) query.momentKey = String(event.momentKey).trim();
  return query;
}

async function searchTopics(query, keyword) {
  const matches = [];
  let skip = 0;
  while (true) {
    const response = await db
      .collection(TOPIC_COLLECTION)
      .where(query)
      .orderBy("sortOrder", "asc")
      .skip(skip)
      .limit(MAX_QUERY_LIMIT)
      .get();
    const topics = response.data || [];
    matches.push(...topics.filter((topic) => matchesKeyword(topic, keyword)));
    if (topics.length < MAX_QUERY_LIMIT) break;
    skip += topics.length;
  }
  return matches.sort(compareTopicOrder);
}

function compareTopicOrder(left, right) {
  const freeDifference = Number(Boolean(right.isFree)) - Number(Boolean(left.isFree));
  if (freeDifference !== 0) {
    return freeDifference;
  }
  return (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
}

async function getTopicPage(query, skip, limit) {
  const response = await db
    .collection(TOPIC_COLLECTION)
    .where(query)
    .orderBy("sortOrder", "asc")
    .skip(skip)
    .limit(limit)
    .get();
  return response.data || [];
}

async function listPublishedTopicsByAge(ageGroup) {
  const topics = [];
  let skip = 0;
  while (true) {
    const response = await db
      .collection(TOPIC_COLLECTION)
      .where({ ageGroup, status: "published" })
      .orderBy("sortOrder", "asc")
      .skip(skip)
      .limit(MAX_QUERY_LIMIT)
      .get();
    const page = response.data || [];
    topics.push(...page);
    if (page.length < MAX_QUERY_LIMIT) break;
    skip += page.length;
  }
  return topics;
}

async function listFreeProactiveTopics(ageGroup) {
  const response = await db.collection(TOPIC_COLLECTION).where({ ageGroup, status: "published", contentType: "proactive", isFree: true }).orderBy("sortOrder", "asc").limit(MAX_QUERY_LIMIT).get();
  return response.data || [];
}

function buildPracticePayload(topic, ageGroup, extra) {
  const normalized = normalizeTopic(topic);
  return Object.assign({ dateKey: getBusinessDateKey(), topicId: normalized._id, ageGroup, category: normalized.level1, contentType: normalized.contentType, title: normalized.displayTitle, summary: normalized.sceneDescription, script: normalized.script, valueHook: normalized.valueHook || "", abilityFocus: normalized.abilityFocus || "", todayFree: true, completed: false }, extra || {});
}

async function handleChangeDailyPractice(event) {
  const openid = getRequesterOpenid(); if (!openid) throw new Error("未获取到用户身份");
  const profile = await getUserProfile(openid); const daily = profile.dailyPractice || {}; const today = getBusinessDateKey();
  const requested = String(event.ageGroup || "").trim();
  const ageGroup = AGE_GROUPS.includes(requested)
    ? requested
    : (profile.trainingProgress || {}).selectedAgeGroup || daily.ageGroup || "";
  if (!ageGroup) return { success: false, message: "请先选择孩子的年龄" };
  // `getUserProfile` normalizes both membershipActive and the legacy
  // activated flag, so this check applies the same entitlement everywhere.
  const member = Boolean(profile.membershipActive); const used = daily.dateKey === today ? Math.max(0, Number(daily.changeCount) || 0) : 0;
  if (!member && used >= DAILY_CHANGE_LIMIT) return { success: false, code: "CHANGE_LIMIT_REACHED", message: "每天可换 3 次，开通会员后不限次数" };
  const candidates = (await listFreeProactiveTopics(ageGroup)).filter((topic) => topic._id !== daily.topicId);
  if (!candidates.length) {
    return {
      success: true,
      practice: null,
      changeLeft: member ? -1 : Math.max(0, DAILY_CHANGE_LIMIT - used),
    };
  }
  const topic = candidates[hashText(`daily-change:${today}:${ageGroup}:${used + 1}`) % candidates.length]; const next = used + 1;
  await updateProfile(openid, { dailyPractice: { dateKey: today, topicId: topic._id, ageGroup, category: topic.level1, completed: false, changeCount: next, shownAt: db.serverDate(), completedAt: null } });
  return { success: true, practice: buildPracticePayload(topic, ageGroup), changeLeft: member ? -1 : DAILY_CHANGE_LIMIT - next };
}

async function handleList(event) {
  if (!event.ageGroup) {
    throw new Error("缺少 ageGroup");
  }
  const skip = Math.max(Number(event.skip) || 0, 0);
  const limit = Math.min(Math.max(Number(event.limit) || 20, 1), 50);
  const keyword = String(event.keyword || "").trim().toLowerCase();
  const today = getBusinessDateKey();
  const query = buildListQuery(event);
  const profilePromise = getUserProfile(getRequesterOpenid());
  let topics;
  let total;
  if (keyword) {
    const matches = await searchTopics(query, keyword);
    total = matches.length;
    topics = matches.slice(skip, skip + limit);
  } else {
    const freeQuery = Object.assign({}, query, { isFree: true });
    const paidQuery = Object.assign({}, query, { isFree: false });
    const [freeCountResult, paidCountResult] = await Promise.all([
      db.collection(TOPIC_COLLECTION).where(freeQuery).count(),
      db.collection(TOPIC_COLLECTION).where(paidQuery).count(),
    ]);
    const freeTotal = freeCountResult.total || 0;
    const paidTotal = paidCountResult.total || 0;
    total = freeTotal + paidTotal;

    if (skip < freeTotal) {
      const freeLimit = Math.min(limit, freeTotal - skip);
      const freeTopics = await getTopicPage(freeQuery, skip, freeLimit);
      const remaining = limit - freeTopics.length;
      const paidTopics = remaining
        ? await getTopicPage(paidQuery, 0, remaining)
        : [];
      topics = freeTopics.concat(paidTopics);
    } else {
      topics = await getTopicPage(paidQuery, skip - freeTotal, limit);
    }
  }
  const profile = await profilePromise;
  const sliced = topics.map((topic) => {
    const unlocked = isUnlocked(topic, profile, today);
    const clientTopic = unlocked ? normalizeTopic(topic) : toPreviewTopic(topic);
    const permanentlyFree = isPermanentlyFree(topic);
    return Object.assign({}, clientTopic, {
      isFree: permanentlyFree,
      unlocked,
      freeToRead: permanentlyFree,
      todayFree:
        isTodayFree(topic, profile, today) &&
        !permanentlyFree &&
        !profile.membershipActive,
    });
  });
  return {
    success: true,
    topics: sliced,
    total,
    hasMore: skip + limit < total,
  };
}

async function findTopicPackage(topic) {
  if (!topic.packageId) {
    return null;
  }
  try {
    const response = await db.collection(PACKAGE_COLLECTION).doc(topic.packageId).get();
    return response.data && response.data.status === "published"
      ? response.data
      : null;
  } catch (error) {
    return null;
  }
}

async function handleDetail(event) {
  if (!event.id) {
    throw new Error("缺少话题 id");
  }
  const response = await db.collection(TOPIC_COLLECTION).doc(event.id).get();
  const topic = response.data;
  if (!topic || topic.status !== "published") {
    return { success: true, topic: null, locked: false };
  }
  const today = getBusinessDateKey();
  const profile = await getUserProfile(getRequesterOpenid());
  const permanentlyFree = isPermanentlyFree(topic);
  const unlocked = isUnlocked(topic, profile, today);
  const packageInfo = await findTopicPackage(topic);
  const clientTopic = unlocked ? normalizeTopic(topic) : toPreviewTopic(topic);
  if (clientTopic.contentType === "response") {
    clientTopic.isFree = permanentlyFree;
  }
  return {
    success: true,
    topic: clientTopic,
    locked: !unlocked,
    freeToRead: permanentlyFree,
    todayFree:
      isTodayFree(topic, profile, today) &&
      !permanentlyFree,
    packageTip: packageInfo
      ? {
          packageId: packageInfo._id,
          title: packageInfo.title,
          priceFen: 990,
        }
      : null,
  };
}

async function handleRelated(event) {
  if (!event.id) {
    throw new Error("缺少话题 id");
  }
  const [response, profile] = await Promise.all([
    db.collection(TOPIC_COLLECTION).doc(event.id).get(),
    getUserProfile(getRequesterOpenid()),
  ]);
  const topic = response.data;
  if (!topic || topic.status !== "published") {
    return { success: true, topics: [] };
  }

  const today = getBusinessDateKey();
  const contentType = topic.contentType || "response";
  const relatedIds = Array.isArray(topic.relatedTopicIds)
    ? topic.relatedTopicIds
    : [];
  const relatedResponses = await Promise.all(
    relatedIds.slice(0, 4).map((id) =>
      db.collection(TOPIC_COLLECTION).doc(id).get().catch(() => ({ data: null }))
    )
  );
  const candidates = relatedResponses
    .map((item) => item.data)
    .filter(
      (item) =>
        item &&
        item.status === "published" &&
        item.ageGroup === topic.ageGroup &&
        (item.contentType || "response") === contentType
    );
  if (candidates.length < 4 && topic.level1) {
    const fallbackResponse = await db
      .collection(TOPIC_COLLECTION)
      .where({
        ageGroup: topic.ageGroup,
        status: "published",
        contentType,
        level1: topic.level1,
      })
      .orderBy("sortOrder", "asc")
      .limit(8)
      .get();
    const usedIds = new Set([topic._id].concat(candidates.map((item) => item._id)));
    (fallbackResponse.data || []).forEach((item) => {
      if (candidates.length < 4 && !usedIds.has(item._id)) {
        candidates.push(item);
        usedIds.add(item._id);
      }
    });
  }

  return {
    success: true,
    topics: candidates.map((item) => ({
      topicId: item._id,
      scenario: normalizeTopic(item).displayTitle,
      type:
        relatedIds.indexOf(item._id) >= 0
          ? "theme_chain"
          : "same_category",
      label:
        relatedIds.indexOf(item._id) >= 0
          ? "延伸练习"
          : "同类场景",
      unlocked: isUnlocked(item, profile, today),
    })),
  };
}

async function updateProfile(openid, data) {
  try {
    await db.collection(PROFILE_COLLECTION).doc(openid).update({
      data: Object.assign({}, data, { updatedAt: db.serverDate() }),
    });
  } catch (error) {
    const profileData = Object.assign({}, data, {
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    });
    delete profileData._id;
    delete profileData._openid;
    await db.collection(PROFILE_COLLECTION).doc(openid).set({
      data: profileData,
    });
  }
}

async function handleSetProfileAgeGroup(event) {
  const openid = getRequesterOpenid();
  if (!openid) {
    throw new Error("未获取到用户身份");
  }
  if (AGE_GROUPS.indexOf(event.ageGroup) < 0) {
    throw new Error("年龄段无效");
  }

  const profile = await getUserProfile(openid);
  await updateProfile(openid, {
    trainingProgress: Object.assign({}, profile.trainingProgress || {}, {
      selectedAgeGroup: event.ageGroup,
      currentPlan: null,
      onboardingDone: false,
      completedPlans: [],
    }),
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

  return {
    success: true,
    ageGroup: event.ageGroup,
  };
}

async function handleDailyPractice(event) {
  const openid = getRequesterOpenid();
  const profile = await getUserProfile(openid);
  const requestedAgeGroup = String(event.ageGroup || "").trim();
  const savedAgeGroup = String(
    (profile.dailyPractice || {}).ageGroup || ""
  ).trim();
  const ageGroup = AGE_GROUPS.includes(requestedAgeGroup)
    ? requestedAgeGroup
    : (profile.trainingProgress || {}).selectedAgeGroup || savedAgeGroup;
  if (!ageGroup) {
    return {
      success: true,
      needProfile: true,
      allowedAgeGroups: AGE_GROUPS,
      practice: null,
    };
  }

  const today = getBusinessDateKey();
  const dailyPractice = profile.dailyPractice || {};
  const current = dailyPractice.topicId
    ? await db
        .collection(TOPIC_COLLECTION)
        .doc(dailyPractice.topicId)
        .get()
        .catch(() => null)
    : null;
  if (
    dailyPractice.dateKey === today &&
    current &&
    current.data &&
    current.data.status === "published" &&
    current.data.ageGroup === ageGroup &&
    current.data.contentType === "proactive"
  ) {
    const topic = normalizeTopic(current.data);
    return {
      success: true,
      needProfile: false,
      practice: {
        dateKey: today,
        topicId: topic._id,
        ageGroup,
        category: topic.level1,
        contentType: topic.contentType,
        title: topic.displayTitle,
        summary: topic.sceneDescription,
        script: topic.script,
        valueHook: topic.valueHook || "",
        abilityFocus: topic.abilityFocus || "",
        todayFree: true,
        completed: Boolean(dailyPractice.completed),
        changeCount: Number(dailyPractice.changeCount) || 0,
      },
      changeLeft: profile.membershipActive ? -1 : Math.max(0, DAILY_CHANGE_LIMIT - (Number(dailyPractice.changeCount) || 0)),
    };
  }

  const candidates = await listFreeProactiveTopics(ageGroup);
  if (!candidates.length) {
    return { success: true, needProfile: false, practice: null };
  }
  const index = hashText(`daily-practice:${today}:${ageGroup}`) % candidates.length;
  const topic = candidates[index];
  if (!topic) {
    return { success: true, needProfile: false, practice: null };
  }
  const nextDailyPractice = {
    dateKey: today,
    topicId: topic._id,
    ageGroup,
    category: topic.level1,
    completed: false,
    changeCount: 0,
    shownAt: db.serverDate(),
    completedAt: null,
  };
  await updateProfile(openid, { dailyPractice: nextDailyPractice });
  const normalized = normalizeTopic(topic);
  return {
    success: true,
    needProfile: false,
    practice: {
      dateKey: today,
      topicId: normalized._id,
      ageGroup,
      category: normalized.level1,
      contentType: normalized.contentType,
      title: normalized.displayTitle,
      summary: normalized.sceneDescription,
      script: normalized.script,
      valueHook: normalized.valueHook || "",
      abilityFocus: normalized.abilityFocus || "",
      todayFree: true,
      completed: false,
    },
  };
}

async function handleDailyPracticeOptions(event) {
  const profile = await getUserProfile(getRequesterOpenid());
  const requestedAgeGroup = String(event.ageGroup || "").trim();
  const savedAgeGroup = String(
    (profile.dailyPractice || {}).ageGroup || ""
  ).trim();
  const ageGroup = AGE_GROUPS.includes(requestedAgeGroup)
    ? requestedAgeGroup
    : (profile.trainingProgress || {}).selectedAgeGroup || savedAgeGroup;
  if (!ageGroup) {
    return { success: true, options: [] };
  }
  const topics = await listFreeProactiveTopics(ageGroup);
  return {
    success: true,
    options: topics
      .filter((topic) => topic.contentType === "proactive" && topic.isFree)
      .map((topic) => {
      const normalized = normalizeTopic(topic);
      return {
        topicId: normalized._id,
        ageGroup,
        category: normalized.level1,
        contentType: normalized.contentType,
        title: normalized.displayTitle,
        summary: normalized.sceneDescription || normalized.scenarioDesc || "",
        script: normalized.script || "",
        valueHook: normalized.valueHook || "",
        abilityFocus: normalized.abilityFocus || "",
        todayFree: true,
        completed: false,
      };
      }),
  };
}

exports.main = async (event) => {
  try {
    switch (event.action) {
      case "counts":
        return await handleCounts();
      case "libraryStats":
        return await handleLibraryStats();
      case "level1List":
        return await handleLevel1List(event);
      case "listDailyPracticeCategories":
        return await handleDailyPracticeCategories(event);
      case "list":
        return await handleList(event);
      case "detail":
        return await handleDetail(event);
      case "related":
        return await handleRelated(event);
      case "setProfileAgeGroup":
        return await handleSetProfileAgeGroup(event);
      case "dailyPractice":
        return await handleDailyPractice(event);
      case "dailyPracticeOptions":
        return await handleDailyPracticeOptions(event);
      case "changeDailyPractice":
        return await handleChangeDailyPractice(event);
      case "rebuildStats":
        return await rebuildStats();
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "topicData 执行失败",
    };
  }
};
