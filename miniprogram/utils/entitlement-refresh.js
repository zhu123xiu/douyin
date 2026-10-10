const ENTITLEMENT_REFRESH_KEY = "package_entitlement_refresh";
const ENTITLEMENT_REFRESH_WINDOW = 2 * 60 * 1000;

function markEntitlementRefresh() {
  try {
    wx.setStorageSync(ENTITLEMENT_REFRESH_KEY, Date.now());
  } catch (error) {}
}

function shouldRefreshEntitlement() {
  try {
    const storedValue = wx.getStorageSync(ENTITLEMENT_REFRESH_KEY);
    if (!storedValue) {
      return false;
    }

    // Keep compatibility with the previous one-time boolean marker. Converting
    // it to a timestamp lets every page opened right after payment bypass a
    // stale cloud-function instance instead of only refreshing the first page.
    if (storedValue === true) {
      markEntitlementRefresh();
      return true;
    }

    const markedAt = Number(storedValue);
    if (
      Number.isFinite(markedAt) &&
      markedAt > 0 &&
      Date.now() - markedAt <= ENTITLEMENT_REFRESH_WINDOW
    ) {
      return true;
    }

    wx.removeStorageSync(ENTITLEMENT_REFRESH_KEY);
    return false;
  } catch (error) {
    return false;
  }
}

module.exports = {
  markEntitlementRefresh,
  shouldRefreshEntitlement,
};
