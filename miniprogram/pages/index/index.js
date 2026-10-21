const {
  getDailyPractice,
  getDailyPracticeOptions,
  changeDailyPractice,
  getRecommendedThemeWeek,
  getTopicLibraryStats,
  listPackages,
  prefetchLibraryData,
  startThemeWeek,
} = require("../../services/app-service");
const { AGE_GROUP_META } = require("../../utils/theme");
const { shouldRefreshEntitlement } = require("../../utils/entitlement-refresh");

const AGE_GROUP_STORAGE_KEY = "parent-dialogue-selected-age-group";
const HOME_CACHE_KEY = "home_cache";
const HOME_CACHE_VERSION = 3;
const HOME_CACHE_TTL = 5 * 60 * 1000;

function getHomeCache() {
  try {
    const cached = wx.getStorageSync(HOME_CACHE_KEY);
    return cached &&
      cached.version === HOME_CACHE_VERSION &&
      Date.now() - cached.time < HOME_CACHE_TTL
      ? cached
      : null;
  } catch (error) {
    return null;
  }
}

function setHomeCache(data) {
  try {
    wx.setStorageSync(HOME_CACHE_KEY, {
      version: HOME_CACHE_VERSION,
      time: Date.now(),
      data,
    });
  } catch (error) {}
}

function getHomeCacheData(data) {
  return {
    heroFreeCount: data.heroFreeCount,
    heroTotalCount: data.heroTotalCount,
    heroPercent: data.heroPercent,
    statsReady: Boolean(data.statsReady),
    dailyPractice: data.dailyPractice,
    dailyPracticeOptions: data.dailyPracticeOptions || [],
    dailyPracticeIndex: data.dailyPracticeIndex || 0,
    themeWeek: data.themeWeek,
    packages: (data.packages || []).slice(0, 3),
    selectedAgeGroup: data.selectedAgeGroup || "",
    showAgeSheet: Boolean(data.showAgeSheet),
  };
}

function getSavedAgeGroup() {
  try {
    const ageGroup = wx.getStorageSync(AGE_GROUP_STORAGE_KEY);
    return AGE_GROUP_META.some((item) => item.ageGroup === ageGroup)
      ? ageGroup
      : "";
  } catch (error) {
    return "";
  }
}

Page({
  data: {
    heroFreeCount: 0,
    heroTotalCount: null,
    heroPercent: 0,
    statsReady: false,
    dailyPractice: null,
    dailyPracticeOptions: [],
    dailyPracticeIndex: 0,
    changeLeft: 3,
    changingPractice: false,
    themeWeek: null,
    packages: [],
    isMember: false,
    loading: true,
    statsLoading: true,
    practiceLoading: true,
    themeWeekLoading: true,
    packagesLoading: true,
    errorMessage: "",
    ageOptions: AGE_GROUP_META,
    selectedAgeGroup: "",
    showAgeSheet: false,
  },

  onShow() {
    const forceRefresh = shouldRefreshEntitlement();
    if (forceRefresh) {
      try {
        wx.removeStorageSync(HOME_CACHE_KEY);
      } catch (error) {}
    }
    const cached = forceRefresh ? null : getHomeCache();
    if (cached) {
      const cachedData = cached.data || {};
      this.setData(
        Object.assign({}, cachedData, {
          loading: false,
          statsReady:
            cachedData.statsReady !== undefined
              ? Boolean(cachedData.statsReady)
              : cachedData.heroTotalCount !== null &&
                cachedData.heroTotalCount !== undefined,
          statsLoading: false,
          practiceLoading: false,
          themeWeekLoading: false,
          packagesLoading: false,
        })
      );
    }
    if (this._skipNextHomeRefresh) {
      this._skipNextHomeRefresh = false;
      return;
    }
    this.loadHome({ silent: Boolean(cached) });
  },

  onReady() {
    clearTimeout(this._libraryPrefetchTimer);
    this._libraryPrefetchTimer = setTimeout(() => {
      prefetchLibraryData("7-9", "proactive");
    }, 3000);
  },

  onUnload() {
    clearTimeout(this._libraryPrefetchTimer);
  },

  onPullDownRefresh() {
    try {
      wx.removeStorageSync(HOME_CACHE_KEY);
    } catch (error) {}
    this.loadHome({ force: true }).finally(() => wx.stopPullDownRefresh());
  },

  retryHome() {
    try {
      wx.removeStorageSync(HOME_CACHE_KEY);
    } catch (error) {}
    this.setData({ errorMessage: "" });
    this.loadHome({ force: true });
  },

  onByteHiContact(event) {
    const detail = (event && event.detail) || {};
    if (detail.errNo === undefined || Number(detail.errNo) === 0) {
      return;
    }
    wx.showModal({
      title: "客服暂不可用",
      content: "请到「我的」页的「意见反馈」留言，我们会尽快处理。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  loadHome(options) {
    const selectedAgeGroup =
      this.data.selectedAgeGroup || getSavedAgeGroup();
    const requestId = (this._homeRequestId || 0) + 1;
    this._homeRequestId = requestId;
    let pending = 4;

    const apply = (patch) => {
      if (requestId !== this._homeRequestId) {
        return;
      }
      this.setData(patch, () => setHomeCache(getHomeCacheData(this.data)));
    };

    const complete = () => {
      pending -= 1;
      if (pending === 0) {
        const hasContent = Boolean(
          this.data.dailyPractice ||
          (this.data.packages && this.data.packages.length) ||
          this.data.themeWeek
        );
        apply({
          loading: false,
          errorMessage: hasContent ? "" : "内容加载失败，请检查网络后重试",
        });
      }
    };

    if (!options || !options.silent) {
      this.setData({
        loading: true,
        errorMessage: "",
        statsLoading: true,
        practiceLoading: true,
        themeWeekLoading: true,
        packagesLoading: true,
      });
    } else {
      this.setData({
        errorMessage: "",
        statsLoading: true,
        practiceLoading: true,
        themeWeekLoading: true,
        packagesLoading: true,
      });
    }

    getTopicLibraryStats()
      .then((libraryStats) =>
        apply({
          heroFreeCount: libraryStats.freeCount,
          heroTotalCount: libraryStats.totalCount,
          heroPercent: libraryStats.percent,
          statsReady: true,
          statsLoading: false,
        })
      )
      .catch(() => apply({ statsLoading: false }))
      .finally(complete);

    getDailyPractice(selectedAgeGroup)
      .then((dailyResult) =>
        apply({
          dailyPractice: dailyResult.practice || null,
          dailyPracticeOptions: [],
          dailyPracticeIndex: 0,
          changeLeft: dailyResult.changeLeft === undefined ? 3 : dailyResult.changeLeft,
          selectedAgeGroup,
          showAgeSheet: Boolean(dailyResult.needProfile && !selectedAgeGroup),
          practiceLoading: false,
        })
      )
      .catch(() => apply({ practiceLoading: false }))
      .finally(complete);

    listPackages()
      .then((packages) =>
        apply({
          packages: packages.slice(0, 3),
          packagesLoading: false,
        })
      )
      .catch(() => apply({ packagesLoading: false }))
      .finally(complete);

    getRecommendedThemeWeek()
      .then((themeWeek) => apply({ themeWeek, themeWeekLoading: false }))
      .catch(() => apply({ themeWeekLoading: false }))
      .finally(complete);
  },

  chooseAge(event) {
    const ageGroup = event.currentTarget.dataset.age;
    if (!ageGroup) {
      return;
    }
    try {
      wx.setStorageSync(AGE_GROUP_STORAGE_KEY, ageGroup);
    } catch (error) {}
    this.setData({
      selectedAgeGroup: ageGroup,
      showAgeSheet: false,
    });
    try {
      wx.removeStorageSync(HOME_CACHE_KEY);
    } catch (error) {}
    this.loadHome({ force: true });
  },

  openPractice() {
    const practice = this.data.dailyPractice;
    if (!practice) {
      return;
    }
    this._skipNextHomeRefresh = true;
    wx.navigateTo({
      url: `/pages/topic-detail/index?id=${encodeURIComponent(
        practice.topicId
      )}&fromDaily=1`,
      fail: () => {
        this._skipNextHomeRefresh = false;
      },
    });
  },

  changePractice() {
    const { selectedAgeGroup, dailyPractice } = this.data;
    const ageGroup =
      selectedAgeGroup ||
      getSavedAgeGroup() ||
      (dailyPractice && dailyPractice.ageGroup) ||
      "";
    if (!dailyPractice || this.data.changingPractice) {
      return;
    }

    this.setData({ changingPractice: true });
    changeDailyPractice(ageGroup)
      .then((result) => {
        if (result.code === "CHANGE_LIMIT_REACHED") {
          wx.showModal({ title: "换题次数已用完", content: "非会员每天可换 3 次，开通会员后可无限换题。", confirmText: "去开通", success: (res) => { if (res.confirm) wx.navigateTo({ url: "/pages/extra/activation/index" }); } });
          return;
        }
        if (!result.practice) { wx.showToast({ title: "暂时没有更多练习题", icon: "none" }); return; }
        const nextData = { dailyPractice: result.practice, dailyPracticeOptions: [], dailyPracticeIndex: 0, changeLeft: result.changeLeft };
        this.setData(nextData); setHomeCache(getHomeCacheData(Object.assign({}, this.data, nextData)));
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "换题失败，请稍后再试",
          icon: "none",
        });
      })
      .finally(() => this.setData({ changingPractice: false }));
  },

  stopPropagation() {},

  openThemeWeek() {
    const plan = this.data.themeWeek;
    if (!plan) {
      wx.navigateTo({ url: "/pages/training/theme-week-list/index" });
      return;
    }
    if (plan.locked) {
      wx.navigateTo({
        url: `/pages/training/training-plan/index?planId=${encodeURIComponent(
          plan.planId
        )}`,
      });
      return;
    }
    if (plan.current || plan.completed) {
      wx.navigateTo({
        url: `/pages/training/training-plan/index?planId=${plan.planId}`,
      });
      return;
    }
    startThemeWeek(plan.planId)
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
          url: `/pages/training/training-plan/index?planId=${plan.planId}`,
        });
      })
      .catch((error) => {
        wx.showToast({ title: error.message || "暂时无法开始", icon: "none" });
      });
  },

  openThemeWeeks() {
    wx.navigateTo({ url: "/pages/training/theme-week-list/index" });
  },

  openAllPackages() {
    wx.navigateTo({ url: "/pages/package/package-list/index?tab=locked" });
  },

  openPackage(event) {
    wx.navigateTo({
      url: `/pages/package/package-chapter/index?packageId=${event.currentTarget.dataset.id}`,
    });
  },
});
