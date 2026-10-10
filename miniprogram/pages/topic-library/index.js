const {
  getCounts,
  getLevel1Categories,
  listTopics,
  toggleFavorite,
  getFavoriteIds,
} = require("../../services/app-service");
const { AGE_GROUP_META } = require("../../utils/theme");

const PAGE_REFRESH_INTERVAL = 30 * 1000;

Page({
  data: {
    ageGroups: AGE_GROUP_META,
    selectedAgeGroup: "7-9",
    level1Categories: [],
    displayedCategories: [],
    hasMoreCategories: false,
    categoriesExpanded: false,
    selectedLevel1: "",
    contentMode: "proactive",
    keyword: "",
    topics: [],
    loading: true,
    loadingMore: false,
    errorMessage: "",
    hasMore: true,
    total: 0,
    skeletonItems: [1, 2, 3, 4, 5],
  },

  onLoad() {
    this._listRequestId = 0;
    this.bootstrap();
  },

  onShow() {
    getFavoriteIds().then((ids) => {
      const patch = {}; (this.data.topics || []).forEach((topic, i) => { const value = ids.indexOf(topic._id) >= 0; if (Boolean(topic.favorited) !== value) patch[`topics[${i}].favorited`] = value; });
      if (Object.keys(patch).length) this.setData(patch);
    });
    if (this.data.errorMessage && !this.data.loading) { this.loadTopics(true); return; }
    if (
      this.data.topics.length &&
      (!this._lastLoadedAt ||
        Date.now() - this._lastLoadedAt >= PAGE_REFRESH_INTERVAL)
    ) {
      this.loadTopics(true);
    }
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.loadingMore && this.data.hasMore) {
      this.loadTopics(false);
    }
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadCounts(),
      this.loadLevel1Categories(),
      this.loadTopics(true),
    ]).finally(() => wx.stopPullDownRefresh());
  },

  bootstrap() {
    Promise.all([
      this.loadCounts(),
      this.loadLevel1Categories(),
      this.loadTopics(true),
    ]).finally(() => this.setData({ loading: false }));
  },

  loadCounts() {
    return getCounts().then((ageGroups) => this.setData({ ageGroups }));
  },

  loadLevel1Categories() {
    const requestId = (this._categoryRequestId || 0) + 1;
    this._categoryRequestId = requestId;
    const ageGroup = this.data.selectedAgeGroup;
    const contentMode = this.data.contentMode;
    return getLevel1Categories(ageGroup, contentMode).then((items) => {
      if (requestId !== this._categoryRequestId) {
        return;
      }
      this.setData({ level1Categories: items });
      this.updateDisplayedCategories();
    });
  },

  loadTopics(reset) {
    const requestId = ++this._listRequestId;
    const skip = reset ? 0 : this.data.topics.length;
    this.setData({
      loading: reset && !this.data.topics.length,
      loadingMore: !reset,
      errorMessage: "",
    });
    return listTopics({
      ageGroup: this.data.selectedAgeGroup,
      keyword: this.data.keyword,
      level1: this.data.selectedLevel1,
      contentType: this.data.contentMode,
      skip,
      limit: 20,
    })
      .then((result) => {
        if (requestId !== this._listRequestId) {
          return;
        }
        this.setData({
          topics: reset ? result.topics : this.data.topics.concat(result.topics),
          total: result.total,
          hasMore: result.hasMore,
          loading: false,
          loadingMore: false,
        });
        if (reset) {
          this._lastLoadedAt = Date.now();
        }
      })
      .catch(() => {
        this.setData({
          loading: false,
          loadingMore: false,
          errorMessage: "话题数据读取失败，请稍后再试。",
        });
      });
  },

  selectAgeGroup(event) {
    const ageGroup = event.currentTarget.dataset.age;
    if (!ageGroup || ageGroup === this.data.selectedAgeGroup) {
      return;
    }
    clearTimeout(this._searchTimer);
    this.setData({
      selectedAgeGroup: ageGroup,
      selectedLevel1: "",
      categoriesExpanded: false,
      topics: [],
      hasMore: true,
    }, () => {
      Promise.all([this.loadLevel1Categories(), this.loadTopics(true)]);
    });
  },

  selectContentMode(event) {
    const contentMode = event.currentTarget.dataset.mode;
    if (!contentMode || contentMode === this.data.contentMode) {
      return;
    }
    this.setData({
      contentMode,
      selectedLevel1: "",
      categoriesExpanded: false,
      topics: [],
      hasMore: true,
    }, () => {
      this.loadLevel1Categories();
      this.loadTopics(true);
    });
  },

  updateDisplayedCategories() {
    const maxVisible = 3;
    const all = this.data.level1Categories || [];
    const selected = this.data.selectedLevel1;
    if (all.length <= maxVisible || this.data.categoriesExpanded) {
      this.setData({
        displayedCategories: all,
        hasMoreCategories: all.length > maxVisible,
      });
      return;
    }

    let displayed = all.slice(0, maxVisible);
    // Keep the active category visible even when it is outside the first 3.
    if (selected && displayed.indexOf(selected) < 0) {
      displayed = displayed.slice(0, maxVisible - 1).concat(selected);
    }
    this.setData({
      displayedCategories: displayed,
      hasMoreCategories: true,
    });
  },

  selectLevel1(event) {
    const level1 = event.currentTarget.dataset.level1 || "";
    this.setData({
      selectedLevel1: level1 === this.data.selectedLevel1 ? "" : level1,
      topics: [],
      hasMore: true,
    });
    this.updateDisplayedCategories();
    this.loadTopics(true);
  },

  toggleCategories() {
    this.setData(
      { categoriesExpanded: !this.data.categoriesExpanded },
      () => this.updateDisplayedCategories()
    );
  },

  onKeywordInput(event) {
    const keyword = event.detail.value || "";
    this.setData({ keyword });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.setData({ topics: [], hasMore: true });
      this.loadTopics(true);
    }, 300);
  },

  clearKeyword() {
    clearTimeout(this._searchTimer);
    this.setData({ keyword: "", topics: [], hasMore: true });
    this.loadTopics(true);
  },

  openTopic(event) {
    wx.navigateTo({
      url: `/pages/topic-detail/index?id=${encodeURIComponent(
        event.currentTarget.dataset.id
      )}`,
    });
  },

  toggleFavorite(event) {
    const topicId = event.currentTarget.dataset.id;
    if (!topicId || this._togglingId) return; this._togglingId = topicId;
    const index = this.data.topics.findIndex((item) => item._id === topicId);
    toggleFavorite(topicId).then((result) => {
      if (index >= 0) this.setData({ [`topics[${index}].favorited`]: result.favorited });
      wx.showToast({
        title: result.favorited ? "已收藏" : "已取消",
        icon: "none",
      });
    }).catch((error) => wx.showToast({ title: error.message || "操作失败，请稍后再试", icon: "none" })).finally(() => { this._togglingId = ""; });
  },
});
