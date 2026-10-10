const {
  listFeedback,
  submitFeedback,
} = require("../../../services/app-service");

const FEEDBACK_CATEGORIES = [
  { value: "suggestion", label: "功能建议" },
  { value: "content", label: "内容补充" },
  { value: "bug", label: "使用问题" },
  { value: "other", label: "其他" },
];

const CATEGORY_LABELS = FEEDBACK_CATEGORIES.reduce((result, item) => {
  result[item.value] = item.label;
  return result;
}, {});

function formatTime(value) {
  if (!value) {
    return "";
  }
  if (value && typeof value === "object" && value.$date) {
    value = value.$date;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decorateFeedback(item) {
  return Object.assign({}, item, {
    categoryLabel: CATEGORY_LABELS[item.category] || "其他",
    statusLabel: item.status === "replied" ? "已回复" : "处理中",
    createdAtText: formatTime(item.createdAt),
    repliedAtText: formatTime(item.repliedAt),
  });
}

Page({
  data: {
    categories: FEEDBACK_CATEGORIES,
    selectedCategory: "suggestion",
    content: "",
    contact: "",
    feedbacks: [],
    loading: true,
    submitting: false,
    errorMessage: "",
  },

  onShow() {
    this.loadFeedbacks();
  },

  onPullDownRefresh() {
    this.loadFeedbacks().finally(() => wx.stopPullDownRefresh());
  },

  loadFeedbacks() {
    this.setData({ loading: true, errorMessage: "" });
    return listFeedback()
      .then((feedbacks) => {
        this.setData({
          feedbacks: (feedbacks || []).map(decorateFeedback),
          loading: false,
        });
      })
      .catch((error) => {
        this.setData({
          loading: false,
          errorMessage: error.message || "反馈记录加载失败，请稍后再试。",
        });
      });
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category;
    if (!category) {
      return;
    }
    this.setData({ selectedCategory: category });
  },

  onContentInput(event) {
    this.setData({ content: event.detail.value || "" });
  },

  onContactInput(event) {
    this.setData({ contact: event.detail.value || "" });
  },

  submit() {
    const content = String(this.data.content || "").trim();
    if (!content) {
      wx.showToast({ title: "请先填写反馈内容", icon: "none" });
      return;
    }
    if (this.data.submitting) {
      return;
    }

    this.setData({ submitting: true });
    submitFeedback({
      category: this.data.selectedCategory,
      content,
      contact: String(this.data.contact || "").trim(),
    })
      .then(() => {
        this.setData({ content: "", contact: "" });
        wx.showToast({ title: "反馈已提交", icon: "success" });
        return this.loadFeedbacks();
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "提交失败，请稍后再试",
          icon: "none",
        });
      })
      .finally(() => this.setData({ submitting: false }));
  },
});
