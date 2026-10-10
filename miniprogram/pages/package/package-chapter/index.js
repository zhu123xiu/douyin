const { getPackageDetail } = require("../../../services/app-service");

Page({
  data: {
    loading: true,
    errorMessage: "",
    packageData: null,
  },

  onLoad(options) {
    this._packageId = decodeURIComponent(options.packageId || options.id || "");
    if (!this._packageId) {
      this.setData({
        loading: false,
        errorMessage: "缺少专题包 ID",
      });
      return;
    }
    this.loadPackage();
  },

  onShow() {
    if (!this._packageId) return;
    if (!this._hasShown) {
      this._hasShown = true;
      return;
    }
    // Refresh whenever returning from a reader or purchase page so read
    // progress and entitlement state are reflected immediately.
    this.loadPackage({ skipCache: true, silent: true });
  },

  loadPackage(options) {
    const silent = options && options.silent;
    if (!silent) this.setData({ loading: true, errorMessage: "" });
    getPackageDetail(this._packageId, options)
      .then((result) => {
        if (!result || !result.package) {
          this.setData({
            loading: false,
            errorMessage: "暂无专题内容",
          });
          return;
        }
        this.setData({
          packageData: result.package,
          loading: false,
        });
      })
      .catch(() => {
        if (!this.data.packageData) this.setData({ loading: false, errorMessage: "专题包加载失败，请稍后再试" });
      });
  },

  openChapter(event) {
    const chapterId = event.currentTarget.dataset.id;
    if (!chapterId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/package/package-reader/index?packageId=${encodeURIComponent(
        this._packageId
      )}&chapterId=${encodeURIComponent(chapterId)}`,
    });
  },

  goPurchase() {
    if (!this.data.packageData || this.data.packageData.unlocked) {
      return;
    }
    wx.navigateTo({
      url: `/pages/extra/activation/index?mode=package&packageId=${this._packageId}`,
    });
  },
});
