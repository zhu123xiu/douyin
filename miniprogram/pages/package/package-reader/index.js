const {
  getPackageChapter,
  getPackageDetail,
  updatePackageProgress,
} = require("../../../services/app-service");
const {
  shouldRefreshEntitlement,
} = require("../../../utils/entitlement-refresh");

Page({
  data: {
    loading: true,
    errorMessage: "",
    packageData: null,
    chapter: null,
    activeChapterIndex: 0,
  },

  onLoad(options) {
    this._packageId = decodeURIComponent(options.packageId || "");
    this._chapterId = decodeURIComponent(options.chapterId || options.id || "");
    if (!this._packageId || !this._chapterId) {
      this.setData({
        loading: false,
        errorMessage: "缺少章节信息",
      });
      return;
    }
    this.loadChapter({ skipCache: shouldRefreshEntitlement() });
  },

  onShow() {
    // The first onShow follows onLoad; later shows mean returning from payment
    // or another page and must refresh the entitlement state.
    if (!this._hasShown) {
      this._hasShown = true;
      return;
    }
    if (this._packageId && this._chapterId) {
      this.loadChapter({ skipCache: shouldRefreshEntitlement() });
    }
  },

  loadChapter(options) {
    this.setData({
      loading: true,
      errorMessage: "",
    });
    Promise.all([
      getPackageDetail(this._packageId, options),
      getPackageChapter(this._chapterId, options),
    ])
      .then(([packageResult, chapterResult]) => {
        if (!packageResult || !packageResult.package) {
          throw new Error("专题包不存在");
        }
        if (!chapterResult || !chapterResult.chapter) {
          throw new Error("章节内容不存在");
        }
        const packageData = packageResult.package;
        const catalog = packageData.catalog || [];
        const activeChapterIndex = Math.max(
          catalog.findIndex((item) => item._id === this._chapterId),
          0
        );
        const chapter = chapterResult.chapter;
        if (!chapter.locked) {
          updatePackageProgress(this._packageId, chapter.chapterIndex).catch(() => {});
        }
        this.setData({
          loading: false,
          packageData,
          chapter,
          activeChapterIndex,
        });
      })
      .catch((error) => {
        this.setData({
          loading: false,
          errorMessage: error.message || "章节加载失败，请稍后再试",
        });
      });
  },

  openChapterAt(index) {
    const catalog = (this.data.packageData || {}).catalog || [];
    const chapter = catalog[index];
    if (!chapter) {
      return;
    }
    wx.redirectTo({
      url: `/pages/package/package-reader/index?packageId=${encodeURIComponent(
        this._packageId
      )}&chapterId=${encodeURIComponent(chapter._id)}`,
    });
  },

  openPrev() {
    if (this.data.activeChapterIndex > 0) {
      this.openChapterAt(this.data.activeChapterIndex - 1);
    }
  },

  openNext() {
    const catalog = (this.data.packageData || {}).catalog || [];
    if (this.data.activeChapterIndex < catalog.length - 1) {
      this.openChapterAt(this.data.activeChapterIndex + 1);
    }
  },

  goPurchase() {
    wx.navigateTo({
      url: `/pages/extra/activation/index?mode=package&packageId=${encodeURIComponent(
        this._packageId
      )}`,
    });
  },
});
