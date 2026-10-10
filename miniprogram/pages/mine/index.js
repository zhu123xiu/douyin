const {
  getFavoriteIds,
  getUserPurchases,
  redeemActivationCode,
} = require("../../services/app-service");

const PAGE_REFRESH_INTERVAL = 30 * 1000;

function buildPerks(isMember) {
  return [
    { icon: "话", tone: "coral", title: "全部话题", status: isMember ? "✓ 已解锁" : "🔒 未解锁" },
    { icon: "包", tone: "blue", title: "沟通专题", status: isMember ? "✓ 已解锁" : "🔒 未解锁" },
    { icon: "周", tone: "purple", title: "主题周", status: isMember ? "✓ 已解锁" : "🔒 未解锁" },
  ];
}

Page({
  data: {
    isMember: false,
    membershipName: "沟通话题会员",
    perks: buildPerks(false),
    purchasedPackages: [],
    favoriteCount: 0,
    showDeveloperImport: false,
    showRedeemDialog: false,
    redeemCode: "",
    redeeming: false,
  },

  onShow() {
    if (
      this._lastLoadedAt &&
      Date.now() - this._lastLoadedAt < PAGE_REFRESH_INTERVAL
    ) {
      return;
    }
    this.loadPage();
  },

  loadPage() {
    return Promise.allSettled([
      getUserPurchases(),
      getFavoriteIds(),
    ]).then((results) => {
      const valueAt = (index, fallback) =>
        results[index].status === "fulfilled" ? results[index].value : fallback;
      const purchaseInfo = valueAt(0, {
        isMember: false,
        membershipName: "沟通话题会员",
        unlockedTopicCount: 0,
        totalTopicCount: 0,
        purchasedPackages: [],
      });
      const favoriteIds = valueAt(1, []);

      this.setData({
        isMember: purchaseInfo.isMember,
        membershipName: purchaseInfo.membershipName,
        perks: buildPerks(purchaseInfo.isMember),
        purchasedPackages: purchaseInfo.purchasedPackages,
        favoriteCount: favoriteIds.length,
      });
      this._lastLoadedAt = Date.now();
    });
  },

  openActivation() {
    wx.navigateTo({
      url: "/pages/extra/activation/index",
    });
  },

  openRedeemDialog() {
    this.setData({ showRedeemDialog: true, redeemCode: "" });
  },

  closeRedeemDialog() {
    if (this.data.redeeming) {
      return;
    }
    this.setData({ showRedeemDialog: false, redeemCode: "" });
  },

  stopRedeemDialogTap() {},

  onRedeemCodeInput(event) {
    this.setData({ redeemCode: event.detail.value || "" });
  },

  redeemCode() {
    const code = String(this.data.redeemCode || "").trim();
    if (!code || this.data.redeeming) {
      if (!code) {
        wx.showToast({ title: "请输入激活码", icon: "none" });
      }
      return;
    }
    this.setData({ redeeming: true });
    redeemActivationCode(code)
      .then(() => {
        wx.showToast({ title: "兑换成功", icon: "success" });
        this.setData({ showRedeemDialog: false, redeemCode: "" });
        return this.loadPage();
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "兑换失败，请稍后重试",
          icon: "none",
        });
      })
      .finally(() => this.setData({ redeeming: false }));
  },

  openFavorites() {
    wx.navigateTo({
      url: "/pages/extra/favorites/index",
    });
  },

  openPackages() {
    wx.navigateTo({
      url: "/pages/package/package-list/index?tab=unlocked",
    });
  },

  openFeedback() {
    wx.navigateTo({
      url: "/pages/extra/feedback/index",
    });
  },

  openAbout() {
    wx.navigateTo({
      url: "/pages/extra/about/index",
    });
  },

  openDeveloperImport() {
    if (!this.data.showDeveloperImport) {
      return;
    }
    wx.navigateTo({
      url: "/pages/extra/developer-import/index",
    });
  },

  showToast(event) {
    const title = event.currentTarget.dataset.title;
    wx.showToast({
      title,
      icon: "none",
    });
  },
});
