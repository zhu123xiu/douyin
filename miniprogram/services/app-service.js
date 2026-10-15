const { AGE_GROUP_META, getAgeMeta, getGradientStyle } = require("../utils/theme");
const { callFunction } = require("../utils/cloud");
const { canPurchase, getPaymentProduct, requestPay } = require("../config/payment");
const { markEntitlementRefresh } = require("../utils/entitlement-refresh");

const FAVORITE_IDS_CACHE_KEY = "favorite_topic_ids";
const LIBRARY_STATS_CACHE_KEY = "library_stats_cache";
const PACKAGES_CACHE_KEY = "packages_cache";
const LIBRARY_LIST_CACHE_KEY = "library_list_cache";
const LIBRARY_LIST_CACHE_TTL = 5 * 60 * 1000;

const PACKAGE_VISUALS = {
  emotion: {
    packageLabel: "情绪管理",
    shortTitle: "情绪火山",
    gradientFrom: "#E4AA92",
    gradientTo: "#C88E63",
  },
  homework: {
    packageLabel: "学习习惯",
    shortTitle: "作业拖延",
    gradientFrom: "#94BAD8",
    gradientTo: "#6598C4",
  },
  screen: {
    packageLabel: "屏幕管理",
    shortTitle: "屏幕共管",
    gradientFrom: "#B595D3",
    gradientTo: "#8D68B8",
  },
};

function getPackageVisual(pkg) {
  const visual = PACKAGE_VISUALS[pkg._id] || {};
  const gradientFrom = pkg.gradientFrom || visual.gradientFrom || "#D8A47D";
  const gradientTo = pkg.gradientTo || visual.gradientTo || "#B98261";

  return {
    packageLabel: visual.packageLabel || "沟通专题",
    shortTitle: visual.shortTitle || pkg.title,
    gradientFrom,
    gradientTo,
    gradientStyle: getGradientStyle(gradientFrom, gradientTo, 155),
  };
}

function callCloud(name, data, fallbackMessage) {
  return callFunction({ name, data }).then((response) => {
    const result = response.result || {};
    if (!result.success) {
      throw new Error(result.message || fallbackMessage);
    }
    return result;
  });
}

function callTopicData(action, data) {
  return callCloud(
    "topicData",
    Object.assign({ action }, data || {}),
    "话题数据读取失败"
  );
}

function callUserData(action, data) {
  return callCloud(
    "userData",
    Object.assign({ action }, data || {}),
    "用户数据读取失败"
  );
}

function callTopicVisit(action, data) {
  return callCloud(
    "topicVisit",
    Object.assign({ action }, data || {}),
    "浏览记录读取失败"
  );
}

function callTrainingService(action, data, allowFailure) {
  return callFunction({
    name: "trainingService",
    data: Object.assign({ action }, data || {}),
  }).then((response) => {
    const result = response.result || {};
    const canHandleFailure =
      allowFailure &&
      (result.needMembership || result.code === "ACTIVE_PLAN_EXISTS");
    if (!result.success && !canHandleFailure) {
      throw new Error(result.message || "主题周数据读取失败");
    }
    return result;
  });
}

function callPackageData(action, data) {
  return callCloud(
    "packageData",
    Object.assign({ action }, data || {}),
    "专题包数据读取失败"
  );
}

function callPayService(type, data) {
  return callCloud(
    "payService",
    Object.assign({ type, action: type }, data || {}),
    "购买数据读取失败"
  );
}

function normalizeTopic(topic) {
  const contentType = topic.contentType || "response";
  return Object.assign({}, topic, {
    contentType,
    displayTitle:
      topic.displayTitle ||
      (contentType === "proactive" ? topic.title : topic.scenario),
  });
}

function decorateCloudTopic(topic, favoriteIds) {
  const normalized = normalizeTopic(topic);
  const meta = getAgeMeta(normalized.ageGroup);
  return Object.assign({}, normalized, {
    ageLabel: meta.label,
    tone: meta.tone,
    toneColor: meta.color,
    toneLightColor: meta.lightColor,
    mark: meta.mark,
    favorited:
      favoriteIds.indexOf(normalized._id) >= 0 || Boolean(normalized.favorited),
  });
}

function getCachedFavoriteIds() {
  try {
    const favoriteIds = wx.getStorageSync(FAVORITE_IDS_CACHE_KEY);
    return Array.isArray(favoriteIds) ? favoriteIds : [];
  } catch (error) {
    return [];
  }
}

function cacheFavoriteIds(favoriteIds) {
  try {
    wx.setStorageSync(FAVORITE_IDS_CACHE_KEY, favoriteIds);
  } catch (error) {}
}

function getCachedValue(key, fallback) {
  try {
    return wx.getStorageSync(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function cacheValue(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {}
}

function libraryListCacheKey(params) {
  const options = params || {};
  return [
    options.ageGroup || "",
    options.contentType || "",
    options.level1 || "",
    options.keyword || "",
  ].join("|");
}

function getLibraryListCache(params) {
  const key = libraryListCacheKey(params);
  try {
    const cache = wx.getStorageSync(LIBRARY_LIST_CACHE_KEY) || {};
    const entry = cache[key];
    if (
      !entry ||
      !Array.isArray(entry.topics) ||
      !Number.isFinite(Number(entry.at)) ||
      Date.now() - Number(entry.at) > LIBRARY_LIST_CACHE_TTL
    ) {
      return null;
    }
    return Object.assign({ key }, entry);
  } catch (error) {
    return null;
  }
}

function cacheLibraryList(params, result) {
  const key = libraryListCacheKey(params);
  try {
    const cache = wx.getStorageSync(LIBRARY_LIST_CACHE_KEY) || {};
    cache[key] = {
      key,
      topics: (result.topics || []).slice(),
      total: result.total || 0,
      hasMore: Boolean(result.hasMore),
      at: Date.now(),
    };
    wx.setStorageSync(LIBRARY_LIST_CACHE_KEY, cache);
  } catch (error) {}
}

function updateLibraryListFavorite(topicId, favorited) {
  try {
    const cache = wx.getStorageSync(LIBRARY_LIST_CACHE_KEY) || {};
    Object.keys(cache).forEach((key) => {
      const entry = cache[key];
      if (!entry || !Array.isArray(entry.topics)) return;
      entry.topics = entry.topics.map((topic) =>
        topic._id === topicId ? Object.assign({}, topic, { favorited }) : topic
      );
    });
    wx.setStorageSync(LIBRARY_LIST_CACHE_KEY, cache);
  } catch (error) {}
}

function getCounts() {
  return callTopicData("counts").then((result) =>
    AGE_GROUP_META.map((item) =>
      Object.assign({}, item, {
        total: (result.counts || {})[item.ageGroup] || 0,
      })
    )
  );
}

function getTopicLibraryStats() {
  return callTopicData("libraryStats").then((result) => {
    const stats = {
      freeCount: result.freeCount || 0,
      totalCount: result.totalCount || 0,
      percent: result.percent || 0,
    };
    cacheValue(LIBRARY_STATS_CACHE_KEY, stats);
    return stats;
  });
}

function getLevel1Categories(ageGroup, contentType) {
  const fallback = () =>
    // Keep the filter row usable when the materialized category stats are
    // temporarily unavailable. The topic list is only a fallback source.
    (() => {
      const categories = [];
      const loadPage = (skip, pageCount) =>
        listTopics({ ageGroup, contentType, skip, limit: 50 }).then((result) => {
          (result.topics || []).forEach((topic) => {
            const category = topic.level1;
            if (category && categories.indexOf(category) < 0) categories.push(category);
          });
          if (result.hasMore && pageCount < 2) {
            return loadPage(skip + 50, pageCount + 1);
          }
          return categories;
        });
      return loadPage(0, 0);
    })();

  return callTopicData("level1List", Object.assign(
    { ageGroup },
    contentType ? { contentType } : {}
  )).then((result) => {
    const categories = result.categories || [];
    if (categories.length) return categories;
    return fallback();
  }).catch(fallback);
}

function changeDailyPractice(ageGroup) {
  // `changeDailyPractice` uses a structured response for the daily limit so
  // the home page can show the membership upsell.  Do not route this call
  // through `callCloud`, whose default behaviour turns every `success:false`
  // response into a rejected promise before the page can inspect the code.
  return callFunction({
    name: "topicData",
    data: Object.assign(
      { action: "changeDailyPractice" },
      ageGroup ? { ageGroup } : {}
    ),
  }).then((response) => {
    const result = response.result || {};
    if (result.code === "CHANGE_LIMIT_REACHED") {
      return result;
    }
    if (!result.success) {
      throw new Error(result.message || "换题失败，请稍后再试");
    }
    return result;
  });
}

function listTopics(params) {
  const favoriteIds = getCachedFavoriteIds();
  return callTopicData("list", params).then((result) => ({
    topics: (result.topics || []).map((topic) =>
      decorateCloudTopic(topic, favoriteIds)
    ),
    total: result.total || 0,
    hasMore: Boolean(result.hasMore),
  }));
}

function prefetchLibraryData(ageGroup, contentType) {
  const options = { ageGroup: ageGroup || "7-9", contentType: contentType || "proactive" };
  return Promise.all([
    getLevel1Categories(options.ageGroup, options.contentType),
    listTopics({
      ageGroup: options.ageGroup,
      contentType: options.contentType,
      level1: "",
      keyword: "",
      skip: 0,
      limit: 20,
    }),
  ])
    .then((result) => {
      cacheLibraryList(
        {
          ageGroup: options.ageGroup,
          contentType: options.contentType,
          level1: "",
          keyword: "",
        },
        result[1]
      );
      return true;
    })
    .catch(() => false);
}

function getTopicDetail(topicId, options) {
  const favoriteIds = getCachedFavoriteIds();
  return callTopicData(
    "detail",
    Object.assign(
      { id: topicId },
      options && options.fromDaily ? { fromDaily: true } : {}
    )
  ).then((result) => {
    if (!result.topic) {
      return {
        topic: null,
        locked: false,
        packageTip: null,
      };
    }
    return {
      topic: decorateCloudTopic(result.topic, favoriteIds),
      locked: Boolean(result.locked),
      freeToRead: Boolean(result.freeToRead),
      todayFree: Boolean(result.todayFree),
      packageTip: result.packageTip || null,
    };
  });
}

function getRelatedTopics(topicId) {
  return callTopicData("related", { id: topicId }).then(
    (result) => result.topics || []
  );
}

function toggleFavorite(topicId) {
  return callUserData("toggleFavorite", { topicId }).then((result) => {
    const favorited = Boolean(result.favorited);
    const favoriteIds = getCachedFavoriteIds().filter((id) => id !== topicId);
    if (favorited) favoriteIds.push(topicId);
    cacheFavoriteIds(favoriteIds);
    updateLibraryListFavorite(topicId, favorited);
    markEntitlementRefresh();
    return { favorited };
  });
}

function getFavoriteIds() {
  return callUserData("favoriteIds").then((result) => {
    const favoriteIds = result.favoriteIds || [];
    cacheFavoriteIds(favoriteIds);
    return favoriteIds;
  });
}

function listFavorites() {
  return callUserData("listFavorites").then((result) => {
    const favoriteIds = (result.favorites || []).map((item) => item._id);
    cacheFavoriteIds(favoriteIds);
    return {
      favorites: (result.favorites || []).map((topic) =>
        decorateCloudTopic(topic, favoriteIds)
      ),
      total: result.total || 0,
      stats: result.stats || {},
    };
  });
}

function recordVisit(topicId) {
  // Visit statistics are auxiliary; a failed write must not break topic detail.
  return callTopicVisit("record", { topicId })
    .then(() => true)
    .catch(() => false);
}

function getVisitStats() {
  return callTopicVisit("stats").then((result) => {
    const totalCount = result.totalCount || 0;
    const viewedCount = result.viewedCount || 0;
    return {
      viewedCount,
      totalCount,
      percent: totalCount ? Math.round((viewedCount / totalCount) * 100) : 0,
    };
  });
}

function getDailyPracticeCategories() {
  return callTopicData("listDailyPracticeCategories").then(
    (result) => result.categories || []
  );
}

function getDailyPracticeOptions(ageGroup) {
  return callTopicData(
    "dailyPracticeOptions",
    ageGroup ? { ageGroup } : {}
  )
    .then((result) => result.options || [])
    .catch(() =>
      // Compatibility fallback for environments where topicData has not yet
      // been redeployed with the dailyPracticeOptions action.
      listTopics({
        ageGroup,
        contentType: "proactive",
        skip: 0,
        limit: 50,
      }).then((result) =>
        (result.topics || [])
          .filter((topic) => topic.freeToRead || topic.isFree)
          .map((topic) => ({
            topicId: topic._id,
            category: topic.level1,
            contentType: "proactive",
            title: topic.displayTitle || topic.title,
            summary: topic.sceneDescription || topic.scenarioDesc || "",
            script: topic.script || "",
            valueHook: topic.valueHook || "",
            abilityFocus: topic.abilityFocus || "",
            todayFree: true,
            completed: false,
          }))
      )
    );
}

function getDailyPractice(ageGroup) {
  return callTopicData(
    "dailyPractice",
    ageGroup ? { ageGroup } : {}
  )
    .then((result) => ({
      needProfile: Boolean(result.needProfile),
      allowedAgeGroups: result.allowedAgeGroups || [],
      practice: result.practice || null,
      changeLeft: result.changeLeft,
    }))
    .catch(() => ({
      needProfile: false,
      allowedAgeGroups: [],
      practice: null,
    }));
}

function setProfileAgeGroup(ageGroup) {
  if (!AGE_GROUP_META.some((item) => item.ageGroup === ageGroup)) {
    return Promise.reject(new Error("年龄段无效"));
  }
  return callTopicData("setProfileAgeGroup", { ageGroup }).then(() => true);
}

function setDailyPracticePreference(category) {
  return callUserData("setDailyPracticePreference", { category }).then(() => true);
}

function completeDailyPractice(topicId) {
  return callUserData("completeDailyPractice", { topicId }).then(() => true);
}

function submitFeedback(data) {
  return callUserData("submitFeedback", data || {}).then((result) => result.feedback);
}

function listFeedback() {
  return callUserData("listFeedback").then((result) => result.feedbacks || []);
}

function listThemeWeeks(ageGroup) {
  return callTrainingService(
    "listThemeWeeks",
    ageGroup ? { ageGroup } : {}
  ).then((result) => result.plans || []);
}

function getThemeWeek(planId) {
  return callTrainingService("getThemeWeek", { planId });
}

function startThemeWeek(planId) {
  return callTrainingService("startThemeWeek", { planId }, true);
}

function completeThemeTask(planId, dayNumber) {
  return callTrainingService("completeTask", {
    planId,
    day: dayNumber,
  });
}

function getThemeWeekProgress() {
  return callTrainingService("getProgress").then((result) => ({
    selectedAgeGroup:
      result.selectedAgeGroup ||
      (result.trainingProgress || {}).selectedAgeGroup ||
      "",
    themeWeekProgress: result.themeWeekProgress || {},
    trainingProgress: result.trainingProgress || {},
  }));
}

function getRecommendedThemeWeek() {
  return getThemeWeekProgress().then((progress) =>
    listThemeWeeks(progress.selectedAgeGroup).then((plans) => {
      const selected =
        plans.find((plan) => plan.current) ||
        plans.find((plan) => !plan.completed) ||
        null;

      if (!selected) {
        return null;
      }

      return {
        planId: selected._id,
        title: selected.title,
        subtitle: selected.subtitle,
        valueHook: selected.valueHook || "",
        themeType: selected.themeType,
        current: selected.current,
        completed: selected.completed,
        memberOnly: selected.memberOnly,
        locked: selected.locked,
      };
    })
  );
}

function getTrainingProgress() {
  return getThemeWeekProgress().then((result) => {
    const themeProgress = result.themeWeekProgress || {};
    const completedPlans = themeProgress.completedPlanIds || [];
    const completedDays = themeProgress.completedDays || [];
    return {
      selectedAgeGroup: result.selectedAgeGroup,
      currentPlan: themeProgress.activePlanId
        ? {
            planId: themeProgress.activePlanId,
            planType: "theme_week",
            dayProgress: completedDays.map(() => true),
          }
        : null,
      completedPlans,
      onboardingDone: Boolean(result.selectedAgeGroup),
    };
  });
}

function getTrainingState(progress) {
  if (!progress || !progress.selectedAgeGroup) {
    return "not_started";
  }
  if (progress.currentPlan) {
    return "theme_week_active";
  }
  return (progress.completedPlans || []).length
    ? "theme_week_done"
    : "onboarding_done";
}

function completeDay(planId, dayNumber) {
  return completeThemeTask(planId, dayNumber);
}

function listPackages(options) {
  return callPackageData(
    "list",
    options && options.skipCache ? { skipCache: true } : {}
  ).then((result) => {
    const packages = (result.packages || []).map((pkg) =>
      Object.assign({}, pkg, getPackageVisual(pkg))
    );
    cacheValue(PACKAGES_CACHE_KEY, packages);
    return packages;
  });
}

function getPackageDetail(packageId, options) {
  return callPackageData(
    "detail",
    Object.assign(
      { packageId },
      options && options.skipCache ? { skipCache: true } : {}
    )
  ).then(
    (result) => ({
      package: result.package
        ? Object.assign({}, result.package, getPackageVisual(result.package))
        : null,
    })
  );
}

function getPackageChapter(chapterId, options) {
  return callPackageData(
    "chapter",
    Object.assign(
      { chapterId },
      options && options.skipCache ? { skipCache: true } : {}
    )
  ).then(
    (result) => ({
      package: result.package
        ? Object.assign({}, result.package, getPackageVisual(result.package))
        : null,
      chapter: result.chapter || null,
    })
  );
}

function updatePackageProgress(packageId, chapterIndex) {
  return callPackageData("progress", { packageId, chapterIndex });
}

function getUserPurchases() {
  return retryPendingPayment()
    .then(() => callPayService("getUserPurchases"))
    .then((result) => {
    const libraryStats = getCachedValue(LIBRARY_STATS_CACHE_KEY, {
      freeCount: 0,
      totalCount: 0,
    });
    const packages = getCachedValue(PACKAGES_CACHE_KEY, []);
    const packagesById = {};
    packages.forEach((pkg) => {
      packagesById[pkg._id] = pkg;
    });

    const purchasedPackages = (result.unlockedPackages || [])
      .map((packageId) => packagesById[packageId])
      .filter(Boolean)
      .map((pkg) => ({
        packageId: pkg._id,
        title: pkg.title,
        subtitle: pkg.subtitle,
        gradientStyle: pkg.gradientStyle,
        readCount: pkg.readCount || 0,
        chapterCount: pkg.chapterCount || 0,
      }));

    const unlockedTopicIds = result.unlockedTopicIds || [];
    const unlockedTopicCount = result.isMember
      ? libraryStats.totalCount
      : Math.min(
          libraryStats.totalCount,
          (libraryStats.freeCount || 0) + unlockedTopicIds.length
        );

    return {
      isMember: Boolean(result.isMember),
      membershipName: result.membershipName || "沟通话题会员",
      membershipPriceFen: result.membershipPriceFen || 9900,
      packagePriceFen: result.packagePriceFen || 990,
      purchasedPackages,
      purchasedItems: result.purchasedItems || [],
      unlockedTopicCount,
      totalTopicCount: libraryStats.totalCount,
    };
  });
}

function getLoginCode() {
  return new Promise((resolve, reject) => {
    const api = typeof tt !== "undefined" ? tt : wx;
    api.login({
      success: (response) => response.code ? resolve(response.code) : reject(new Error("未能获取登录凭证")),
      fail: () => reject(new Error("未能获取登录凭证")),
    });
  });
}
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const PENDING_PAYMENT_STORAGE_KEY = "pending_virtual_payment";
const ENTITLEMENT_MAX_ATTEMPTS = 30;

function clearPendingPayment() {}
function retryPendingPayment() { return Promise.resolve(); }
function waitForEntitlement(itemType, itemId, attempt, outTradeNo) {
  return callPayService("getUserPurchases").then((result) => {
    const purchased =
      Boolean(result.isMember) ||
      (itemType === "package" &&
        Array.isArray(result.unlockedPackages) &&
        result.unlockedPackages.indexOf(itemId) >= 0);
    if (purchased) {
      return true;
    }
    if (attempt >= ENTITLEMENT_MAX_ATTEMPTS) {
      const currentOrder = (result.purchasedItems || []).find(
        (item) => item.outTradeNo === outTradeNo
      );
      const suffix = currentOrder && currentOrder.status
        ? `（订单状态：${currentOrder.status}）`
        : "";
      throw new Error(`支付已完成，但权益同步失败${suffix}，请稍后重新进入本页`);
    }
    return delay(attempt === 0 ? 1000 : 2000).then(() =>
      waitForEntitlement(itemType, itemId, attempt + 1, outTradeNo)
    );
  });
}

function syncOrderStatus(outTradeNo, attempt) {
  const currentAttempt = attempt || 0;
  return callFunction({
    name: "pay",
    data: { action: "syncOrderStatus", outOrderNo: outTradeNo },
  })
    .then((response) => {
      const result = response.result || {};
      if (result.status === "paid") return true;
      if (currentAttempt >= 4) return false;
      return delay(1000).then(() =>
        syncOrderStatus(outTradeNo, currentAttempt + 1)
      );
    })
    .catch(() => false);
}

function createPurchase(itemType, itemId, sourceTitle) {
  const gate = canPurchase();
  if (!gate.allowed) return Promise.reject(new Error(gate.reason));
  const product = getPaymentProduct(itemType, itemId);
  if (!product) return Promise.reject(new Error("当前专题包尚未配置支付道具"));
  return callFunction({
    name: "pay",
    data: { action: "createOrder", itemType, itemId: itemId || "", sourceTitle: sourceTitle || "", productId: product.productId },
  }).then((response) => {
    const result = response.result || {};
    if (!result.success) throw new Error(result.message || "预下单失败");
    if (result.alreadyPurchased) return { success: true, synchronized: true };
    return requestPay(result)
      .then(() => syncOrderStatus(result.outTradeNo))
      .then((synchronized) => {
        if (synchronized) {
          markEntitlementRefresh();
          return { success: true, synchronized: true };
        }
        waitForEntitlement(itemType, itemId, 0, result.outTradeNo)
          .then(() => markEntitlementRefresh())
          .catch(() => {});
        return { success: true, synchronized: false };
      })
      .catch((error) => {
        if (/11084|签名/.test(String(error && error.message))) {
          callFunction({ name: "pay", data: { action: "invalidateSecret" } }).catch(
            () => {}
          );
        }
        throw error;
      });
  });
}
function purchaseMembership(sourceTitle) {
  return createPurchase("membership", "", sourceTitle);
}

function purchasePackage(packageId) {
  return createPurchase("package", packageId, "");
}

function redeemActivationCode(code) {
  return callPayService("redeemActivationCode", { code });
}

module.exports = {
  completeDailyPractice,
  changeDailyPractice,
  completeDay,
  completeThemeTask,
  getCounts,
  getLibraryListCache,
  getDailyPractice,
  getDailyPracticeOptions,
  getDailyPracticeCategories,
  getFavoriteIds,
  getLevel1Categories,
  getPackageChapter,
  getPackageDetail,
  getRelatedTopics,
  getRecommendedThemeWeek,
  getThemeWeek,
  getThemeWeekProgress,
  getTopicDetail,
  getTopicLibraryStats,
  getTrainingProgress,
  getTrainingState,
  getUserPurchases,
  getVisitStats,
  listFavorites,
  listPackages,
  listThemeWeeks,
  listTopics,
  cacheLibraryList,
  purchaseMembership,
  purchasePackage,
  prefetchLibraryData,
  redeemActivationCode,
  recordVisit,
  setDailyPracticePreference,
  setProfileAgeGroup,
  submitFeedback,
  listFeedback,
  startThemeWeek,
  toggleFavorite,
  updatePackageProgress,
};
