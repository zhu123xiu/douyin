const { initCloud } = require("./utils/cloud");

App({
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
