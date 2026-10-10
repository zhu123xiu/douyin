const {
  listFavorites,
  toggleFavorite,
} = require("../../../services/app-service");

function getFavoriteCategory(topic) {
  const category =
    topic && topic.contentType === "proactive" ? topic.level1 : topic && topic.level2;
  return category || "其他";
}

Page({
  data: {
    favorites: [],
    visibleFavorites: [],
    total: 0,
    tabs: [{ label: "全部", count: 0 }],
    activeTab: "全部",
    loading: true,
  },

  onShow() {
    this.loadFavorites();
  },

  onPullDownRefresh() {
    this.loadFavorites().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  loadFavorites() {
    this.setData({ loading: true });
    return listFavorites().then((result) => {
      const favorites = result.favorites.map((item) =>
        Object.assign({}, item, {
          favoriteCategory: getFavoriteCategory(item),
        })
      );
      const stats = favorites.reduce((counts, item) => {
        counts[item.favoriteCategory] = (counts[item.favoriteCategory] || 0) + 1;
        return counts;
      }, {});
      const tabs = [{ label: "全部", count: result.total }].concat(
        Object.keys(stats).map((label) => ({
          label,
          count: stats[label],
        }))
      );
      const activeTab = tabs.some((item) => item.label === this.data.activeTab)
        ? this.data.activeTab
        : "全部";
      this.setData({
        favorites,
        visibleFavorites:
          activeTab === "全部"
            ? favorites
            : favorites.filter((item) => item.favoriteCategory === activeTab),
        total: result.total,
        tabs,
        activeTab,
        loading: false,
      });
    });
  },

  selectTab(event) {
    const label = event.currentTarget.dataset.label;
    const visibleFavorites =
      label === "全部"
        ? this.data.favorites
        : this.data.favorites.filter((item) => item.favoriteCategory === label);
    this.setData({
      activeTab: label,
      visibleFavorites,
    });
  },

  openTopic(event) {
    const topicId = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/topic-detail/index?id=${encodeURIComponent(topicId)}`,
    });
  },

  removeFavorite(event) {
    const topicId = event.currentTarget.dataset.id;
    toggleFavorite(topicId).then(() => {
      wx.showToast({
        title: "已取消",
        icon: "none",
      });
      this.loadFavorites();
    });
  },
});
