const {
  getPackageDetail,
  getUserPurchases,
  purchaseMembership,
  purchasePackage,
  startThemeWeek,
} = require("../../../services/app-service");
const {
  markEntitlementRefresh,
} = require("../../../utils/entitlement-refresh");

function formatPriceFen(priceFen) {
  return (Number(priceFen || 9900) / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

Page({
  data: {
    sourceTitle: "",
    sourcePlanId: "",
    mode: "membership",
    packageId: "",
    selectedSku: "membership",
    packageMeta: null,
    isMember: false,
    membershipPriceText: "99",
    orders: [],
    paying: false,
    showPurchaseConfirm: false,
    perks: [
      "解锁全部已上线话题内容",
      "解锁全部沟通专题与主题周",
      "一次购买，长期可用",
    ],
  },

  onLoad(options) {
    const mode = options.mode === "package" ? "package" : "membership";
    const packageId = decodeURIComponent(options.packageId || "");
    this.setData({
      sourceTitle: decodeURIComponent(options.sourceTitle || ""),
      sourcePlanId: decodeURIComponent(options.sourcePlanId || ""),
      mode,
      packageId,
      selectedSku: mode === "package" ? "package" : "membership",
    });
    this.loadPage();
  },

  onPullDownRefresh() {
    this.loadPage();
    wx.stopPullDownRefresh();
  },

  loadPage() {
    const tasks = [getUserPurchases()];
    if (this.data.packageId) {
      tasks.push(getPackageDetail(this.data.packageId));
    }

    return Promise.allSettled(tasks).then((results) => {
      const purchaseInfo =
        results[0].status === "fulfilled"
          ? results[0].value
          : { isMember: false, purchasedItems: [] };
      const packageDetail =
        results[1] && results[1].status === "fulfilled"
          ? results[1].value
          : null;
      this.setData({
        isMember: purchaseInfo.isMember,
        membershipPriceText: formatPriceFen(
          purchaseInfo.membershipPriceFen
        ),
        orders: purchaseInfo.purchasedItems,
        packageMeta: packageDetail ? packageDetail.package : null,
      });
    });
  },

  selectSku(event) {
    const sku = event.currentTarget.dataset.sku;
    this.setData({ selectedSku: sku });
  },

  startPurchase() {
    if (this.data.paying) {
      return;
    }

    if (this.data.isMember && this.data.selectedSku === "membership") {
      this.finishFlow();
      return;
    }

    this.setData({ showPurchaseConfirm: true });
  },

  closePurchaseConfirm() {
    if (!this.data.paying) {
      this.setData({ showPurchaseConfirm: false });
    }
  },

  stopPurchaseConfirmTap() {},

  openPurchaseTerms() {
    wx.navigateTo({
      url: "/pages/extra/purchase-terms/index",
    });
  },

  confirmPurchase() {
    if (this.data.paying) {
      return;
    }

    this.setData({ paying: true, showPurchaseConfirm: false });
    const action =
      this.data.selectedSku === "package" && this.data.packageId
        ? purchasePackage(this.data.packageId)
        : purchaseMembership(this.data.sourceTitle);

    action
      .then((result) => {
        markEntitlementRefresh();
        wx.showToast({
          title: "开通成功",
          icon: "success",
        });
        return this.finishFlow();
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "支付未完成",
          icon: "none",
        });
      })
      .finally(() => {
        this.setData({ paying: false });
      });
  },

  startSourcePlan() {
    const planId = this.data.sourcePlanId;
    if (!planId || this.data.selectedSku !== "membership") {
      return Promise.resolve(true);
    }
    return startThemeWeek(planId).then((result) => {
      if (result && result.needMembership) {
        throw new Error("会员权益尚未同步，请稍后重试");
      }
      if (result && result.code === "ACTIVE_PLAN_EXISTS") {
        wx.showModal({
          title: "已有进行中的主题周",
          content: "完成当前主题周后，再开始新的连续练习。",
          showCancel: false,
        });
        return false;
      }
      return true;
    });
  },

  finishFlow() {
    if (this._finishingFlow) {
      return Promise.resolve();
    }
    this._finishingFlow = true;
    return this.startSourcePlan()
      .then((canReturn) => {
        if (!canReturn) {
          this._finishingFlow = false;
          return;
        }
        wx.navigateBack({
          delta: 1,
          fail: () => {
            wx.switchTab({
              url: "/pages/index/index",
            });
          },
        });
      })
      .catch((error) => {
        this._finishingFlow = false;
        wx.showToast({
          title: error.message || "主题周启动失败，请稍后重试",
          icon: "none",
        });
      });
  },
});
