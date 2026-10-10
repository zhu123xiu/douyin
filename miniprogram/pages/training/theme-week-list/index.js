const {
  listThemeWeeks,
  startThemeWeek,
} = require("../../../services/app-service");
const { AGE_GROUP_META, getAgeMeta } = require("../../../utils/theme");

const PAGE_REFRESH_INTERVAL = 30 * 1000;

const THEME_VISUALS = {
  tw_3_6_daily_connection: {
    label: "亲密连接",
    icon: "聊",
    color: "#A88BD0",
    textColor: "#FFFFFF",
  },
  tw_7_9_listen_again: {
    label: "认真倾听",
    icon: "听",
    color: "#84AED2",
    textColor: "#FFFFFF",
  },
  tw_10_12_equal_talk: {
    label: "平等对话",
    icon: "谈",
    color: "#D69B78",
    textColor: "#FFFFFF",
  },
  tw_7_9_after_school_ten_minutes: {
    label: "放学时光",
    icon: "放",
    color: "#79B598",
    textColor: "#FFFFFF",
  },
  tw_7_9_family_agreement: {
    label: "家庭约定",
    icon: "约",
    color: "#B99B6B",
    textColor: "#FFFFFF",
  },
  tw_7_9_screen_together: {
    label: "屏幕共管",
    icon: "屏",
    color: "#9A8ACB",
    textColor: "#FFFFFF",
  },
  tw_10_12_weekend_choice: {
    label: "周末选择",
    icon: "选",
    color: "#DC927E",
    textColor: "#FFFFFF",
  },
  tw_10_12_puberty_listen: {
    label: "理解变化",
    icon: "理",
    color: "#B8A0D0",
    textColor: "#FFFFFF",
  },
  tw_10_12_screen_truce: {
    label: "屏幕共处",
    icon: "屏",
    color: "#9A8ACB",
    textColor: "#FFFFFF",
  },
  tw_10_12_pocket_money: {
    label: "独立成长",
    icon: "钱",
    color: "#C79C72",
    textColor: "#FFFFFF",
  },
  tw_3_6_emotion_volcano: {
    label: "情绪陪伴",
    icon: "情",
    color: "#E0A998",
    textColor: "#FFFFFF",
  },
  tw_3_6_routine: {
    label: "日常习惯",
    icon: "日",
    color: "#D6A77C",
    textColor: "#FFFFFF",
  },
  tw_3_6_self_care: {
    label: "自主尝试",
    icon: "试",
    color: "#86B89C",
    textColor: "#FFFFFF",
  },
  tw_3_6_goodbye_ease: {
    label: "安心分离",
    icon: "安",
    color: "#9EB8D6",
    textColor: "#FFFFFF",
  },
  tw_7_9_emotion_signals: {
    label: "情绪识别",
    icon: "情",
    color: "#D69B78",
    textColor: "#FFFFFF",
  },
};

const AGE_FILTERS = [{ ageGroup: "", label: "全部" }].concat(
  AGE_GROUP_META.map((item) => ({
    ageGroup: item.ageGroup,
    label: item.label,
  }))
);

function getThemeVisual(plan) {
  return (
    THEME_VISUALS[plan._id] || {
      label: "主题练习",
      icon: "周",
      color: "#A88BD0",
      textColor: "#FFFFFF",
    }
  );
}

function decoratePlans(plans) {
  const recommendedPlan = plans.find(
    (plan) => !plan.current && !plan.completed && !plan.locked
  );

  return plans.map((plan) => {
    const visual = getThemeVisual(plan);
    const isRecommended =
      recommendedPlan && recommendedPlan._id === plan._id;
    const completedCount = plan.completedCount || 0;
    let statusText = "7 天 · 7 个话题练习";
    let actionText = "";

    if (plan.completed) {
      statusText = `${plan.totalDays} / ${plan.totalDays} 天`;
    } else if (plan.current) {
      statusText = `已完成 ${completedCount} / ${plan.totalDays} 天`;
      actionText = "继续练习";
    } else if (plan.locked) {
      statusText = "可预览 Day 1 · 开通会员解锁";
    } else {
      actionText = isRecommended ? "开始本周计划" : "开始主题周";
    }

    return Object.assign({}, plan, {
      visualLabel: visual.label,
      visualIcon: visual.icon,
      iconColor: visual.color,
      iconTextColor: visual.textColor,
      ageLabel: getAgeMeta(plan.ageGroup).label,
      recommended: Boolean(isRecommended),
      statusText,
      actionText,
    });
  });
}

Page({
  data: {
    plans: [],
    ageFilters: AGE_FILTERS,
    selectedAgeGroup: "",
    loading: true,
  },

  onShow() {
    if (
      this._lastLoadedAt &&
      Date.now() - this._lastLoadedAt < PAGE_REFRESH_INTERVAL
    ) {
      return;
    }
    this.loadPage(this.data.selectedAgeGroup);
  },

  loadPage(ageGroup) {
    this.setData({ loading: true });
    listThemeWeeks(ageGroup)
      .then((plans) => {
        this.setData({ plans: decoratePlans(plans) });
        this._lastLoadedAt = Date.now();
      })
      .catch(() => {
        wx.showToast({ title: "主题周加载失败，请稍后重试", icon: "none" });
      })
      .finally(() => this.setData({ loading: false }));
  },

  selectAgeGroup(event) {
    const ageGroup = event.currentTarget.dataset.ageGroup || "";
    if (ageGroup === this.data.selectedAgeGroup) {
      return;
    }
    this.setData({ selectedAgeGroup: ageGroup });
    this._lastLoadedAt = 0;
    this.loadPage(ageGroup);
  },

  startThemePlan(event) {
    const planId = event.currentTarget.dataset.id;
    const locked =
      event.currentTarget.dataset.locked === true ||
      event.currentTarget.dataset.locked === "true";
    if (locked) {
      wx.navigateTo({
        url: `/pages/training/training-plan/index?planId=${encodeURIComponent(
          planId
        )}`,
      });
      return;
    }
    const selectedPlan = this.data.plans.find((plan) => plan._id === planId);
    if (selectedPlan && (selectedPlan.current || selectedPlan.completed)) {
      wx.navigateTo({
        url: `/pages/training/training-plan/index?planId=${planId}`,
      });
      return;
    }
    startThemeWeek(planId)
      .then((result) => {
        if (result && result.needMembership) {
          wx.navigateTo({ url: "/pages/extra/activation/index" });
          return;
        }
        if (result && result.code === "ACTIVE_PLAN_EXISTS") {
          wx.showModal({
            title: "已有进行中的主题周",
            content: "完成当前主题周后，再开始新的连续练习。",
            showCancel: false,
          });
          return;
        }
        wx.navigateTo({
          url: `/pages/training/training-plan/index?planId=${planId}`,
        });
      })
      .catch((error) => {
        wx.showToast({ title: error.message || "暂时无法开始", icon: "none" });
      });
  },
});
