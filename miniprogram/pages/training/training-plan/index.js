const {
  completeThemeTask,
  getThemeWeek,
} = require("../../../services/app-service");
const { getAgeMeta } = require("../../../utils/theme");
const {
  shouldRefreshEntitlement,
} = require("../../../utils/entitlement-refresh");

const PAGE_REFRESH_INTERVAL = 30 * 1000;

const DAY_FIELDS = [
  "title",
  "moment",
  "action",
  "scriptTemplate",
  "scriptExample",
  "fallback",
  "completionRule",
  "reflection",
  "reflectionExample",
  "abilityFocus",
  "growthSignal",
];

function normalizePlan(plan) {
  if (!plan) {
    return null;
  }

  const rawDays = Array.isArray(plan.days) ? plan.days : [];
  const daySource =
    rawDays.length > 0
      ? rawDays
      : plan.previewDay && typeof plan.previewDay === "object"
        ? [plan.previewDay]
        : [];
  const days = daySource.length
    ? daySource.map((day) => {
        const normalized = { day: Number(day.day) };
        DAY_FIELDS.forEach((field) => {
          normalized[field] = typeof day[field] === "string" ? day[field] : "";
        });
        if (typeof day.done === "boolean") {
          normalized.done = day.done;
        }
        return normalized;
      })
    : [];

  const dayCatalog = Array.isArray(plan.dayCatalog)
    ? plan.dayCatalog.map((item) => ({
        day: Number(item.day),
        title: typeof item.title === "string" ? item.title : "",
        moment: typeof item.moment === "string" ? item.moment : "",
        abilityFocus:
          typeof item.abilityFocus === "string" ? item.abilityFocus : "",
        locked: Boolean(item.locked),
      }))
    : days.map((item) => ({
        day: item.day,
        title: item.title,
        moment: item.moment,
        abilityFocus: item.abilityFocus,
        locked: false,
      }));

  return Object.assign({}, plan, {
    days,
    dayCatalog,
    ageLabel: getAgeMeta(plan.ageGroup).label,
  });
}

Page({
  data: {
    loading: true,
    locked: false,
    plan: null,
    completedCount: 0,
    totalDays: 7,
    selectedDay: null,
    previewMode: false,
  },

  onLoad(options) {
    this._planId = decodeURIComponent(options.planId || "");
  },

  onShow() {
    const shouldRefresh = shouldRefreshEntitlement();
    if (!this._hasShown) {
      this._hasShown = true;
      this.loadPlan({ force: shouldRefresh });
      return;
    }
    if (!shouldRefresh && this._lastLoadedAt && Date.now() - this._lastLoadedAt < PAGE_REFRESH_INTERVAL) {
      return;
    }
    this.loadPlan({ force: shouldRefresh });
  },

  loadPlan() {
    // Clear the previous selection before loading so an old plan's detail
    // fields cannot remain visible while the new plan is being resolved.
    this.setData({ loading: true, selectedDay: null });
    getThemeWeek(this._planId)
      .then((result) => {
        if (!result || !result.plan) {
          this.setData({ loading: false, plan: null });
          return;
        }
        const plan = normalizePlan(result.plan);
        const nextDay =
          plan.days.find((item) => !item.done) || plan.days[0];
        this.setData({
          loading: false,
          locked: result.locked,
          plan,
          completedCount: result.completedCount,
          totalDays: result.totalDays,
          selectedDay: nextDay || null,
          previewMode: Boolean(result.locked),
        });
        this._lastLoadedAt = Date.now();
      })
      .catch((error) => {
        this.setData({ loading: false, plan: null });
        wx.showToast({
          title: error.message || "主题周加载失败",
          icon: "none",
        });
      });
  },

  openDay(event) {
    const dayNumber = Number(event.currentTarget.dataset.day);
    const day = this.data.plan.days.find((item) => item.day === dayNumber);
    if (day) {
      this.setData({ selectedDay: day });
      return;
    }
    if (this.data.locked) {
      wx.showModal({
        title: "后续内容已锁定",
        content: "开通会员后可继续 Day 2—Day 7。",
        confirmText: "开通会员",
        success: (res) => {
          if (res.confirm) this.openActivation();
        },
      });
    }
  },

  completeDay() {
    const day = this.data.selectedDay;
    if (!day || day.done || this.data.locked) {
      return;
    }
    completeThemeTask(this._planId, day.day)
      .then(() => this.loadPlan())
      .catch((error) => {
        wx.showToast({
          title: error.message || "暂时无法完成",
          icon: "none",
        });
      });
  },

  retryLoad() {
    this._lastLoadedAt = 0;
    this.loadPlan();
  },

  openActivation() {
    const title = this.data.plan && this.data.plan.title;
    wx.navigateTo({
      url: `/pages/extra/activation/index?sourceTitle=${encodeURIComponent(
        title || ""
      )}&sourcePlanId=${encodeURIComponent(this._planId || "")}`,
    });
  },
});
