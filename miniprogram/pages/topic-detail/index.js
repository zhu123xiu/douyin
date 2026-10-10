const {
  completeDailyPractice,
  getRelatedTopics,
  getTopicDetail,
  recordVisit,
  toggleFavorite,
} = require("../../services/app-service");

Page({
  data: {
    loading: true,
    errorMessage: "",
    topic: null,
    locked: false,
    relatedTopics: [],
    wrongExpanded: false,
    visibleWrongScripts: [],
    packageTip: null,
    isProactive: false,
    freeToRead: false,
    todayFree: false,
    fromDaily: false,
    fromTraining: "",
    trainingDay: 0,
  },

  onLoad(options) {
    const topicId = decodeURIComponent(options.id || "");
    if (!topicId) {
      this.setData({
        loading: false,
        errorMessage: "缺少话题 ID",
      });
      return;
    }

    this._topicId = topicId;
    this._fromDaily = options.fromDaily === "1";
    this.setData({
      fromTraining: decodeURIComponent(options.fromTraining || ""),
      trainingDay: parseInt(options.day || "0", 10),
      fromDaily: this._fromDaily,
    });
    this.loadTopic();
  },

  onShow() {
    if (this._topicId && this.data.locked) {
      this.loadTopic();
    }

  },

  loadTopic() {
    this.setData({
      loading: true,
      errorMessage: "",
    });

    getTopicDetail(this._topicId, { fromDaily: this._fromDaily })
      .then((result) => {
        if (!result || !result.topic) {
          this.setData({
            loading: false,
            errorMessage: "没有找到该话题",
          });
          return;
        }

        const visibleWrongScripts = (result.topic.wrongScripts || []).slice(0, 1);
        this.setData({
          topic: result.topic,
          locked: result.locked,
          packageTip: result.packageTip,
          isProactive: result.topic.contentType === "proactive",
          freeToRead: Boolean(result.freeToRead),
          todayFree: Boolean(result.todayFree),
          visibleWrongScripts,
          wrongExpanded: false,
          loading: false,
        });
        this.loadRelatedTopics(result.topic);
        recordVisit(this._topicId);
        if (this.data.fromDaily && !this._dailyMarked) {
          this._dailyMarked = true;
          completeDailyPractice(this._topicId).catch(() => {});
        }
      })
      .catch(() => {
        this.setData({
          loading: false,
          errorMessage: "话题数据读取失败，请稍后再试。",
        });
      });
  },

  loadRelatedTopics(topic) {
    getRelatedTopics(
      this._topicId,
      this._fromDaily ? { dailyTopic: topic } : null
    )
      .then((relatedTopics) => {
        this.setData({ relatedTopics });
      })
      .catch(() => {});
  },

  expandWrong() {
    const topic = this.data.topic;
    this.setData({
      wrongExpanded: true,
      visibleWrongScripts: topic ? topic.wrongScripts : [],
    });
  },

  toggleFavorite() {
    if (!this.data.topic || this._togglingFavorite) {
      return;
    }
    this._togglingFavorite = true;
    toggleFavorite(this.data.topic._id).then((result) => {
      this.setData({
        "topic.favorited": result.favorited,
      });
      wx.showToast({ title: result.favorited ? "已收藏" : "已取消", icon: "none" });
    }).catch((error) => wx.showToast({ title: error.message || "操作失败，请稍后再试", icon: "none" })).finally(() => { this._togglingFavorite = false; });
  },

  goActivate() {
    const url = `/pages/extra/activation/index?sourceKey=${encodeURIComponent(
      this._topicId
    )}&sourceTitle=${encodeURIComponent(
      (this.data.topic || {}).displayTitle || (this.data.topic || {}).scenario || ""
    )}`;
    wx.navigateTo({ url });
  },

  openPackage() {
    if (!this.data.packageTip) {
      return;
    }
    wx.navigateTo({
      url: `/pages/package/package-chapter/index?packageId=${this.data.packageTip.packageId}`,
    });
  },

  openRelatedTopic(event) {
    const topicId = event.currentTarget.dataset.id;
    const fromDaily = this._fromDaily ? "&fromDaily=1" : "";
    wx.navigateTo({
      url: `/pages/topic-detail/index?id=${encodeURIComponent(topicId)}${fromDaily}`,
    });
  },
});
