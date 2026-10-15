const { initCloud } = require("./utils/cloud");
const { reportError } = require("./utils/error-report");

App({
  onError(message) {
    reportError("app.onError", message);
  },

  onUnhandledRejection(result) {
    reportError(
      "unhandledRejection",
      result && result.reason ? result.reason : "unknown"
    );
  },

  onPageNotFound(result) {
    reportError("pageNotFound", result && result.path ? result.path : "");
    const api =
      typeof tt !== "undefined"
        ? tt
        : typeof wx !== "undefined"
          ? wx
          : null;
    if (api && typeof api.reLaunch === "function") {
      api.reLaunch({ url: "/pages/index/index" });
    }
  },

  globalData: {
    topicCollection: "communication_topics",
    packageCollection: "communication_packages",
    profileCollection: "communication_user_profiles",
    mockMode: false,
  },

  onLaunch() {
    if (typeof tt !== "undefined" && typeof wx === "undefined") globalThis.wx = tt;
    initCloud().catch((error) => {
      console.warn("cloud init skipped", error);
    });
  },
});
