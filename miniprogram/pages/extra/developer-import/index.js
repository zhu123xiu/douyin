const { callFunction } = require("../../../utils/cloud");

const FEEDBACK_CATEGORY_LABELS = {
  suggestion: "功能建议",
  content: "内容补充",
  bug: "使用问题",
  other: "其他",
};

function formatTime(value) {
  if (!value) {
    return "";
  }
  if (value && typeof value === "object" && value.$date) {
    value = value.$date;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function decorateFeedback(item) {
  return Object.assign({}, item, {
    categoryLabel: FEEDBACK_CATEGORY_LABELS[item.category] || "其他",
    statusLabel: item.status === "replied" ? "已回复" : "待回复",
    createdAtText: formatTime(item.createdAt),
    repliedAtText: formatTime(item.repliedAt),
    replyDraft: item.reply || "",
  });
}

Page({
  data: {
    datasets: [],
    authorized: false,
    openid: "",
    importingCollection: "",
    importProgress: "",
    scanError: "",
    feedbacks: [],
    feedbackStatus: "all",
    feedbackLoading: false,
    feedbackError: "",
    replyingFeedbackId: "",
    activationCodeCount: 10,
    activationCodes: [],
    activationCodeGenerating: false,
    activationCodeError: "",
  },

  onShow() {
    this.loadDatasets();
  },

  loadDatasets() {
    callFunction({
      name: "importData",
      data: { action: "scan" },
    })
      .then((response) => {
        const result = response.result || {};
        if (!result.success) {
          throw new Error(result.message || "scan failed");
        }
        this.setData({
          datasets: result.datasets || [],
          authorized: Boolean(result.authorized),
          openid: result.openid || "",
          scanError: "",
        });
        if (result.authorized) {
          this.loadFeedbacks();
          this.loadActivationCodes();
        } else {
          this.setData({
            feedbacks: [],
            feedbackError: "",
            activationCodes: [],
            activationCodeError: "",
          });
        }
      })
      .catch((error) => {
        this.setData({
          datasets: [],
          authorized: false,
          openid: "",
          scanError:
            error && error.message
              ? error.message
              : "未能连接 importData 云函数",
          feedbacks: [],
        });
      });
  },

  loadFeedbacks() {
    this.setData({ feedbackLoading: true, feedbackError: "" });
    return callFunction({
      name: "importData",
      data: {
        action: "feedbackList",
        status: this.data.feedbackStatus,
      },
    })
      .then((response) => {
        const result = response.result || {};
        if (!result.success) {
          throw new Error(result.message || "反馈读取失败");
        }
        this.setData({
          feedbacks: (result.feedbacks || []).map(decorateFeedback),
          feedbackLoading: false,
        });
      })
      .catch((error) => {
        this.setData({
          feedbacks: [],
          feedbackLoading: false,
          feedbackError: error.message || "反馈读取失败，请稍后再试。",
        });
      });
  },

  copyOpenid() {
    const openid = String(this.data.openid || "").trim();
    if (!openid) {
      wx.showToast({ title: "当前还没有获取到 OPENID", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: "OPENID 已复制", icon: "success" }),
    });
  },

  loadActivationCodes() {
    return callFunction({
      name: "importData",
      data: { action: "activationCodeList" },
    })
      .then((response) => {
        const result = response.result || {};
        if (!result.success) {
          throw new Error(result.message || "激活码读取失败");
        }
        this.setData({
          activationCodes: result.codes || [],
          activationCodeError: "",
        });
      })
      .catch((error) => {
        this.setData({
          activationCodes: [],
          activationCodeError: error.message || "激活码读取失败",
        });
      });
  },

  onActivationCodeCountInput(event) {
    this.setData({ activationCodeCount: event.detail.value || "" });
  },

  generateActivationCodes() {
    if (this.data.activationCodeGenerating || !this.data.authorized) {
      return;
    }
    const count = Math.min(
      Math.max(Math.floor(Number(this.data.activationCodeCount) || 1), 1),
      50
    );
    this.setData({ activationCodeGenerating: true, activationCodeError: "" });
    callFunction({
      name: "importData",
      data: { action: "activationCodeGenerate", count },
    })
      .then((response) => {
        const result = response.result || {};
        if (!result.success) {
          throw new Error(result.message || "激活码生成失败");
        }
        wx.showToast({
          title: `已生成 ${result.codes.length} 个`,
          icon: "success",
        });
        return this.loadActivationCodes();
      })
      .catch((error) => {
        this.setData({ activationCodeError: error.message || "激活码生成失败" });
        wx.showToast({
          title: error.message || "激活码生成失败",
          icon: "none",
        });
      })
      .finally(() => this.setData({ activationCodeGenerating: false }));
  },

  copyActivationCodes() {
    if (!this.data.activationCodes.length) {
      wx.showToast({ title: "暂无可复制的激活码", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: this.data.activationCodes.join("\n"),
      success: () => wx.showToast({ title: "已复制激活码", icon: "success" }),
    });
  },

  selectFeedbackStatus(event) {
    const status = event.currentTarget.dataset.status;
    if (!status || status === this.data.feedbackStatus) {
      return;
    }
    this.setData({ feedbackStatus: status }, () => this.loadFeedbacks());
  },

  onFeedbackInput(event) {
    const feedbackId = event.currentTarget.dataset.id;
    const replyDraft = event.detail.value || "";
    const feedbacks = this.data.feedbacks.map((item) =>
      item._id === feedbackId ? Object.assign({}, item, { replyDraft }) : item
    );
    this.setData({ feedbacks });
  },

  replyFeedback(event) {
    const feedbackId = event.currentTarget.dataset.id;
    const feedback = this.data.feedbacks.find((item) => item._id === feedbackId);
    const reply = String((feedback && feedback.replyDraft) || "").trim();
    if (!feedbackId || !reply || this.data.replyingFeedbackId) {
      if (!reply) {
        wx.showToast({ title: "请填写回复内容", icon: "none" });
      }
      return;
    }

    this.setData({ replyingFeedbackId: feedbackId });
    callFunction({
      name: "importData",
      data: {
        action: "feedbackReply",
        feedbackId,
        reply,
      },
    })
      .then((response) => {
        const result = response.result || {};
        if (!result.success) {
          throw new Error(result.message || "回复失败");
        }
        wx.showToast({ title: "回复已发送", icon: "success" });
        return this.loadFeedbacks();
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "回复失败，请稍后再试",
          icon: "none",
        });
      })
      .finally(() => this.setData({ replyingFeedbackId: "" }));
  },

  importDataset(event) {
    const collection = event.currentTarget.dataset.collection;
    if (!collection || this.data.importingCollection) {
      return;
    }

    if (!this.data.authorized) {
      wx.showToast({
        title: "当前账号不在白名单中",
        icon: "none",
      });
      return;
    }

    this.setData({
      importingCollection: collection,
      importProgress: "0%",
    });
    this.importChunk(collection, 0, 0);
  },

  importChunk(collection, offset, shardIndex) {
    callFunction({
      name: "importData",
      data: {
        action: "import",
        collection,
        offset,
        limit: 20,
        shardIndex: shardIndex || 0,
      },
    })
      .then((response) => {
        const result = response.result || {};
        if (!result.success) {
          throw new Error(result.message || "import failed");
        }

        const percent = result.total
          ? Math.min(100, Math.round((result.nextOffset / result.total) * 100))
          : 100;
        const shardLabel =
          result.shardFiles && result.shardFiles.length > 1
            ? ` · 分片 ${Number(result.shardIndex) + 1}/${result.shardFiles.length}`
            : "";
        this.setData({
          importProgress: `${percent}%${shardLabel}`,
        });

        if (result.done) {
          wx.showToast({
            title: "导入完成",
            icon: "success",
          });
          this.setData({
            importingCollection: "",
            importProgress: "",
          });
          this.loadDatasets();
          return;
        }

        this.importChunk(collection, result.nextOffset, result.shardIndex);
      })
      .catch((error) => {
        wx.showToast({
          title: error.message || "导入失败",
          icon: "none",
        });
        this.setData({
          importingCollection: "",
          importProgress: "",
        });
      });
  },
});
