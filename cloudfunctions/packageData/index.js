const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const command = db.command;
const PACKAGE_COLLECTION = "communication_packages";
const CHAPTER_COLLECTION = "communication_chapters";
const PROFILE_COLLECTION = "communication_user_profiles";
const ORDER_COLLECTION = "communication_membership_orders";
const ENTITLEMENT_TTL = 60 * 1000;
const PACKAGE_PRICE_FEN = 990;

let entitlementCache = new Map();

function getRequesterOpenid() {
  const ctx = cloud.getWXContext() || {};
  return ctx.FROM_OPENID || ctx.OPENID || "";
}

function buildChapterId(packageId, chapterIndex) {
  return `${packageId}_ch${String(chapterIndex).padStart(2, "0")}`;
}

function normalizePackageProgress(progress) {
  if (!progress || typeof progress !== "object") {
    return {};
  }
  return progress;
}

async function getProfile(openid) {
  if (!openid) {
    return {};
  }
  try {
    const response = await db.collection(PROFILE_COLLECTION).doc(openid).get();
    return response.data || {};
  } catch (error) {
    return {};
  }
}

async function getOrderEntitlement(openid) {
  try {
    const response = await db
      .collection(ORDER_COLLECTION)
      .where({
        openid,
        status: command.in(["paid", "delivered"]),
      })
      .limit(100)
      .get();
    const unlockedPackages = [];
    let isMember = false;
    (response.data || []).forEach((order) => {
      if (order.item_type === "membership") {
        isMember = true;
      }
      if (order.item_type === "package" && order.item_id) {
        if (unlockedPackages.indexOf(order.item_id) < 0) {
          unlockedPackages.push(order.item_id);
        }
      }
    });
    return { isMember, unlockedPackages };
  } catch (error) {
    return { isMember: false, unlockedPackages: [] };
  }
}

async function getEntitlement(openid, skipCache) {
  if (!openid) {
    return {
      isMember: false,
      unlockedPackages: [],
      progress: {},
    };
  }
  const cached = entitlementCache.get(openid);
  if (!skipCache && cached && Date.now() - cached.time < ENTITLEMENT_TTL) {
    return cached.value;
  }

  const [profile, orderEntitlement] = await Promise.all([
    getProfile(openid),
    getOrderEntitlement(openid),
  ]);
  const profileUnlockedPackages = Array.isArray(profile.unlockedPackages)
    ? profile.unlockedPackages
    : [];
  const unlockedPackages = profileUnlockedPackages.slice();
  orderEntitlement.unlockedPackages.forEach((packageId) => {
    if (unlockedPackages.indexOf(packageId) < 0) {
      unlockedPackages.push(packageId);
    }
  });
  const value = {
    isMember: Boolean(
      profile.membershipActive || profile.activated || orderEntitlement.isMember
    ),
    unlockedPackages,
    progress: normalizePackageProgress(profile.packageProgress),
  };
  entitlementCache.set(openid, {
    time: Date.now(),
    value,
  });
  return value;
}

function clearEntitlementCache(openid) {
  if (openid) {
    entitlementCache.delete(openid);
  }
}

function canReadPackage(pkg, entitlement) {
  return Boolean(
    pkg &&
      (pkg.isFree ||
        entitlement.isMember ||
        entitlement.unlockedPackages.indexOf(pkg._id) >= 0)
  );
}

function getPackageProgress(entitlement, packageId) {
  const progress = entitlement.progress || {};
  const current = progress[packageId];
  if (!current) {
    return {
      lastChapterIndex: -1,
      readChapters: [],
      updatedAt: "",
    };
  }
  return {
    lastChapterIndex: Number(current.lastChapterIndex) || -1,
    readChapters: Array.isArray(current.readChapters) ? current.readChapters : [],
    updatedAt: current.updatedAt || "",
  };
}

function decoratePackage(pkg, entitlement) {
  const progress = getPackageProgress(entitlement, pkg._id);
  const chapterCount = Number(pkg.chapterCount) || (pkg.chapters || []).length || 0;
  const freeCount = (pkg.chapters || []).filter((chapter) => chapter.isFree).length;
  const unlocked = canReadPackage(pkg, entitlement);
  return Object.assign({}, pkg, {
    chapterCount,
    freeCount,
    unlocked,
    readCount: progress.readChapters.length,
    chapterCountText: `${chapterCount}章`,
    priceText: `¥${(PACKAGE_PRICE_FEN / 100).toFixed(2)}`,
    progressText: unlocked
      ? progress.readChapters.length
        ? `已读 ${progress.readChapters.length}/${chapterCount}`
        : "开始阅读"
      : "解锁阅读",
    lastChapterId:
      progress.lastChapterIndex > 0
        ? buildChapterId(pkg._id, progress.lastChapterIndex)
        : "",
  });
}

function buildCatalog(pkg, chapters, entitlement) {
  const unlocked = canReadPackage(pkg, entitlement);
  return chapters.map((chapter) => ({
    _id: chapter._id,
    chapterIndex: chapter.chapterIndex,
    title: chapter.title,
    isFree: Boolean(chapter.isFree),
    locked: !chapter.isFree && !unlocked,
  }));
}

async function getPublishedPackages() {
  const response = await db
    .collection(PACKAGE_COLLECTION)
    .where({ status: "published" })
    .orderBy("sortOrder", "asc")
    .get();
  return response.data || [];
}

async function getPackageById(packageId) {
  const response = await db.collection(PACKAGE_COLLECTION).doc(packageId).get();
  return response.data && response.data.status === "published"
    ? response.data
    : null;
}

async function getChaptersByPackageId(packageId) {
  const response = await db
    .collection(CHAPTER_COLLECTION)
    .where({
      packageId,
      status: "published",
    })
    .orderBy("chapterIndex", "asc")
    .get();
  return response.data || [];
}

async function getChapterCatalog(packageId) {
  const response = await db.collection(CHAPTER_COLLECTION).where({ packageId, status: "published" }).orderBy("chapterIndex", "asc").field({ _id: true, chapterIndex: true, title: true, isFree: true }).get();
  return response.data || [];
}

async function getChapterById(chapterId) {
  const response = await db.collection(CHAPTER_COLLECTION).doc(chapterId).get();
  return response.data && response.data.status === "published"
    ? response.data
    : null;
}

async function handleList(openid, event) {
  const entitlement = await getEntitlement(openid, Boolean(event.skipCache));
  const packages = await getPublishedPackages();
  return {
    success: true,
    packages: packages.map((pkg) => decoratePackage(pkg, entitlement)),
  };
}

async function handleDetail(openid, event) {
  const packageId = event.packageId || event.id || "";
  if (!packageId) {
    throw new Error("缺少专题包 id");
  }
  const entitlement = await getEntitlement(openid, Boolean(event.skipCache));
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new Error("专题包不存在");
  }
  const chapters = await getChapterCatalog(packageId);
  return {
    success: true,
    package: Object.assign({}, decoratePackage(pkg, entitlement), {
      catalog: buildCatalog(pkg, chapters, entitlement),
    }),
  };
}

async function handleChapter(openid, event) {
  const chapterId = event.chapterId || event.id || "";
  if (!chapterId) {
    throw new Error("缺少 chapterId");
  }
  const entitlement = await getEntitlement(openid, Boolean(event.skipCache));
  const chapter = await getChapterById(chapterId);
  if (!chapter) {
    throw new Error("章节不存在");
  }
  const pkg = await getPackageById(chapter.packageId);
  if (!pkg) {
    throw new Error("专题包不存在");
  }
  const unlocked = canReadPackage(pkg, entitlement) || chapter.isFree;
  return {
    success: true,
    package: decoratePackage(pkg, entitlement),
    chapter: unlocked
      ? Object.assign({}, chapter, { locked: false })
      : Object.assign({}, chapter, {
          sections: (chapter.sections || []).slice(0, 1),
          locked: true,
        }),
  };
}

async function handleProgress(openid, event) {
  if (!openid) {
    throw new Error("缺少 openid");
  }
  const packageId = event.packageId || event.id || "";
  if (!packageId) {
    throw new Error("缺少专题包 id");
  }
  const chapterIndex = Number(event.chapterIndex || event.index);
  if (Number.isNaN(chapterIndex) || chapterIndex <= 0) {
    throw new Error("缺少有效章节序号");
  }

  const profile = await getProfile(openid);
  const packageProgress = Object.assign({}, normalizePackageProgress(profile.packageProgress));
  const current = Object.assign(
    {
      lastChapterIndex: -1,
      readChapters: [],
      updatedAt: "",
    },
    packageProgress[packageId] || {}
  );

  current.lastChapterIndex = Math.max(current.lastChapterIndex, chapterIndex);
  if (current.readChapters.indexOf(chapterIndex) < 0) {
    current.readChapters.push(chapterIndex);
    current.readChapters.sort((a, b) => a - b);
  }
  current.updatedAt = new Date().toISOString();
  packageProgress[packageId] = current;

  const profileData = Object.assign({}, profile, {
    packageProgress,
    updatedAt: db.serverDate(),
    createdAt: profile.createdAt || db.serverDate(),
  });
  delete profileData._id;
  delete profileData._openid;

  await db.collection(PROFILE_COLLECTION).doc(openid).set({
    data: profileData,
  });
  clearEntitlementCache(openid);

  return {
    success: true,
    progress: current,
  };
}

async function handleValidIds() {
  const packages = await getPublishedPackages();
  return {
    success: true,
    ids: packages.map((item) => item._id),
  };
}

exports.main = async (event) => {
  try {
    const openid = getRequesterOpenid();
    switch (event.action) {
      case "list":
        return await handleList(openid, event);
      case "detail":
        return await handleDetail(openid, event);
      case "chapter":
        return await handleChapter(openid, event);
      case "progress":
        return await handleProgress(openid, event);
      case "validIds":
        return await handleValidIds();
      default:
        throw new Error(`未知 action: ${event.action || ""}`);
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || "packageData 执行失败",
    };
  }
};
