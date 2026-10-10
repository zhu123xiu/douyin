const { listPackages } = require("../../../services/app-service");

Page({
  data: {
    packages: [],
    filteredPackages: [],
    activeTab: "unlocked",
    unlockedCount: 0,
    loading: true,
  },

  onLoad(options) {
    const activeTab = options.tab === "locked" ? "locked" : "unlocked";
    this.setData({ activeTab });
  },

  filterPackages(packages, activeTab) {
    return packages.filter((item) =>
      activeTab === "unlocked" ? item.unlocked : !item.unlocked
    );
  },

  onShow() {
    this.setData({ loading: true });
    listPackages({ skipCache: true }).then((packages) => {
      const hasLockedPackages = packages.some((item) => !item.unlocked);
      const activeTab =
        this.data.activeTab === "locked" && !hasLockedPackages
          ? "unlocked"
          : this.data.activeTab;
      this.setData({
        packages,
        activeTab,
        filteredPackages: this.filterPackages(packages, activeTab),
        unlockedCount: packages.filter((item) => item.unlocked).length,
        loading: false,
      });
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  selectTab(event) {
    const activeTab = event.currentTarget.dataset.tab;
    if (activeTab === this.data.activeTab) {
      return;
    }
    this.setData({
      activeTab,
      filteredPackages: this.filterPackages(this.data.packages, activeTab),
    });
  },

  openPackage(event) {
    const packageId = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/package/package-chapter/index?packageId=${packageId}`,
    });
  },
});
