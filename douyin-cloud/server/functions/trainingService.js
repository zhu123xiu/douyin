const cloud = require("../wx-compat");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PROFILE_COLLECTION = "communication_user_profiles";
const PLAN_COLLECTION = "training_plans";
const FREE_PREVIEW_DAYS = 1;

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
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

async function getPlan(planId) {
  const response = await db.collection(PLAN_COLLECTION).doc(planId).get();
  return response.data;
}

function memberOnly(profile) {
  return Boolean(profile.membershipActive || profile.activated);
}

function getProgress(profile) {
  return Object.assign(
    {
      activePlanId: "",
      startedAt: "",
      completedDays: [],
      dayRecords: {},
      completedPlanIds: [],
    },
    profile.themeWeekProgress || {}
  );
}

function decorateSummary(plan, progress, member) {
  const current = progress.activePlanId === plan._id;
  const completed = progress.completedPlanIds.indexOf(plan._id) >= 0;
  const totalDays = (plan.days || []).length;
  return {
    _id: plan._id,
    title: plan.title,
    subtitle: plan.subtitle,
    ageGroup: plan.ageGroup,
    themeType: plan.themeType,
    recommendedCategories: plan.recommendedCategories || [],
    abilityFocus: plan.abilityFocus || "",
    valueHook: plan.valueHook || "",
    memberOnly: Boolean(plan.memberOnly),
    locked: Boolean(plan.memberOnly) && !member,
    current,
    completed,
    completedCount: completed
      ? totalDays
      : current
        ? progress.completedDays.length
        : 0,
    totalDays,
  };
}

// The catalog is intentionally limited to display metadata. Never expose any
// paid task正文 fields here; the detail response only includes those for
// members (or for the free preview day).
function buildDayCatalog(days, freePreviewDays) {
  return (days || []).map((item) => ({
    day: Number(item.day),
    title: typeof item.title === "string" ? item.title : "",
    moment: typeof item.moment === "string" ? item.moment : "",
    abilityFocus:
      typeof item.abilityFocus === "string" ? item.abilityFocus : "",
    locked: Number(item.day) > Number(freePreviewDays || 0),
  }));
}

async function handleListThemeWeeks(openid, event) {
  const profile = await getProfile(openid);
  const progress = getProgress(profile);
  const where = {
    planType: "theme_week",
    status: "published",
  };
  if (event.ageGroup) {
    where.ageGroup = event.ageGroup;
  }
  const response = await db
    .collection(PLAN_COLLECTION)
    .where(where)
    .orderBy("sortOrder", "asc")
    .get();
  const member = memberOnly(profile);
  return {
    success: true,
    plans: (response.data || []).map((plan) =>
      decorateSummary(plan, progress, member)
    ),
  };
}

async function handleGetThemeWeek(openid, event) {
  const plan = await getPlan(event.planId);
  if (!plan || plan.status !== "published") {
    throw new Error("主题周不存在");
  }
  const profile = await getProfile(openid);
  const progress = getProgress(profile);
  const member = memberOnly(profile);
  const completed = progress.completedPlanIds.indexOf(plan._id) >= 0;
  const completedDays =
    progress.activePlanId === plan._id
      ? progress.completedDays
      : completed
        ? (plan.days || []).map((item) => item.day)
        : [];
  const freePreviewDays = member || !plan.memberOnly ? 0 : FREE_PREVIEW_DAYS;
  const visibleDays = member || !plan.memberOnly
    ? (plan.days || []).map((item) =>
        Object.assign({}, item, {
          done: completedDays.indexOf(item.day) >= 0,
        })
      )
    : (plan.days || [])
        .slice(0, FREE_PREVIEW_DAYS)
        .map((item) => Object.assign({}, item, { done: false }));
  return {
    success: true,
    locked: Boolean(plan.memberOnly) && !member,
    freePreviewDays,
    plan: Object.assign({}, plan, {
      freePreviewDays,
      dayCatalog: buildDayCatalog(
        plan.days,
        member || !plan.memberOnly
          ? (plan.days || []).length
          : FREE_PREVIEW_DAYS
      ),
      days: visibleDays,
      // Keep the free preview explicit so clients do not lose Day 1 when an
      // older response normalizer or cached payload omits the days array.
      previewDay:
        Boolean(plan.memberOnly) && !member ? visibleDays[0] || null : null,
    }),
    completedCount: completedDays.length,
    totalDays: (plan.days || []).length,
    activePlanId: progress.activePlanId,
  };
}

async function handleStartThemeWeek(openid, event) {
  const profile = await getProfile(openid);
  if (!memberOnly(profile)) {
    return { success: false, needMembership: true };
  }
  const plan = await getPlan(event.planId);
  if (!plan || plan.status !== "published") {
    throw new Error("主题周不存在");
  }
  const progress = getProgress(profile);
  if (progress.activePlanId && progress.activePlanId !== plan._id) {
    return {
      success: false,
      code: "ACTIVE_PLAN_EXISTS",
      activePlanId: progress.activePlanId,
    };
  }
  await updateProfile(openid, {
    themeWeekProgress: Object.assign({}, progress, {
      activePlanId: plan._id,
      startedAt: progress.startedAt || new Date().toISOString(),
    }),
  });
  return { success: true };
}

async function handleGetTodayTask(openid, event) {
  const profile = await getProfile(openid);
  const progress = getProgress(profile);
  const plan = await getPlan(event.planId || progress.activePlanId);
  if (!plan) {
    return { success: true, task: null };
  }
  if (!memberOnly(profile)) {
    return { success: true, locked: true, task: null };
  }
  const nextDay = (plan.days || []).find(
    (item) => progress.completedDays.indexOf(item.day) < 0
  );
  return {
    success: true,
    locked: false,
    task: nextDay || null,
  };
}

async function handleCompleteTask(openid, event) {
  const profile = await getProfile(openid);
  if (!memberOnly(profile)) {
    return { success: false, needMembership: true };
  }
  const progress = getProgress(profile);
  if (!progress.activePlanId || progress.activePlanId !== event.planId) {
    throw new Error("没有进行中的主题周");
  }
  const plan = await getPlan(event.planId);
  const nextDay =
    (plan.days || []).find(
      (item) => progress.completedDays.indexOf(item.day) < 0
    ) || null;
  if (!nextDay || Number(nextDay.day) !== Number(event.day)) {
    throw new Error("只能完成当前待进行的任务");
  }
  const completedDays = progress.completedDays.concat(nextDay.day);
  const nextProgress = Object.assign({}, progress, {
    completedDays,
    dayRecords: Object.assign({}, progress.dayRecords, {
      [nextDay.day]: { completedAt: db.serverDate() },
    }),
  });
  if (completedDays.length >= plan.days.length) {
    nextProgress.completedPlanIds = progress.completedPlanIds.concat(plan._id);
    nextProgress.activePlanId = "";
    nextProgress.startedAt = "";
    nextProgress.completedDays = [];
    nextProgress.dayRecords = {};
  }
  await updateProfile(openid, { themeWeekProgress: nextProgress });
  return { success: true, progress: nextProgress };
}

async function handleGetProgress(openid) {
  const profile = await getProfile(openid);
  const progress = getProgress(profile);
  return {
    success: true,
    selectedAgeGroup: (profile.trainingProgress || {}).selectedAgeGroup || "",
    themeWeekProgress: progress,
    trainingProgress: Object.assign(
      {
        selectedAgeGroup: "",
        currentPlan: null,
        completedPlans: [],
        onboardingDone: false,
      },
      profile.trainingProgress || {}
    ),
  };
}

exports.main = async (event) => {
  try {
    const openid = getRequesterOpenid();
    if (!openid) throw new Error("未获取到用户身份");
    switch (event.action) {
      case "listThemeWeeks":
        return await handleListThemeWeeks(openid, event);
      case "getThemeWeek":
        return await handleGetThemeWeek(openid, event);
      case "startThemeWeek":
        return await handleStartThemeWeek(openid, event);
      case "getTodayTask":
        return await handleGetTodayTask(openid, event);
      case "completeTask":
        return await handleCompleteTask(openid, event);
      case "getProgress":
        return await handleGetProgress(openid);
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "trainingService 执行失败",
    };
  }
};
