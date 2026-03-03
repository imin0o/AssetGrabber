const EXT_RE = /\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)(\?|#|$)/i;

const PRIORITY = {
  ".png": 1, ".jpg": 2, ".jpeg": 2, ".webp": 3, ".avif": 4, ".gif": 5, ".svg": 6
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SAVE_RESULT") {
    chrome.storage.local.set({
      last: {
        urls: msg.payload.urls,
        pageUrl: msg.payload.pageUrl
      }
    }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "DOWNLOAD_SAVED") {
    (async () => {
      try {
        const { last } = await chrome.storage.local.get(["last"]);
        if (!last || !last.urls) {
          sendResponse({ status: "データがありません" });
          return;
        }

        const now = new Date();
        const domain = last.pageUrl ? safeName(new URL(last.pageUrl).hostname.replace(/\./g, "_")) : "download";
        const hostDir = domain;

        const allTargets = uniq(last.urls).filter(u => EXT_RE.test(u));
        const dedupMap = new Map();
        for (const u of allTargets) {
          const { base, ext } = getPathInfo(u);
          const currentPriority = PRIORITY[ext.toLowerCase()] || 99;
          if (!dedupMap.has(base) || currentPriority < dedupMap.get(base).priority) {
            dedupMap.set(base, { url: u, ext, priority: currentPriority });
          }
        }
        const filteredTargets = Array.from(dedupMap.values()).map(v => v.url);

        // ダウンロード実行
        for (const u of filteredTargets) {
          try {
            const fileName = niceNameFromAssetUrl(u);
            const finalPath = `${hostDir}/${fileName}`;

            chrome.downloads.download({
              url: u,
              filename: finalPath,
              conflictAction: "uniquify",
              saveAs: false
            }, function (downloadId) {
              if (chrome.runtime.lastError) {
                console.error("Download Error:", chrome.runtime.lastError.message);
              }
            });
          } catch (e) { }
        }

        sendResponse({ status: `フォルダ 「${hostDir}」 へ保存中` });
      } catch (err) {
        sendResponse({ status: `Error: ${err.message}` });
      }
    })();
    return true;
  }
});

// 安全な名前（記号を排除）
function safeName(s) {
  return s.replace(/[\\/:*?"<>|.]/g, "_").trim();
}

// 以下、getPathInfo, uniq, niceNameFromAssetUrl, hash は前回のコードと同じです。
function getPathInfo(assetUrl) {
  try {
    const u = new URL(assetUrl);
    const pathname = u.pathname;
    const lastPart = pathname.split("/").pop() || "";
    const dotIndex = lastPart.lastIndexOf(".");
    if (dotIndex === -1) return { base: lastPart, ext: "" };
    return { base: lastPart.substring(0, dotIndex), ext: lastPart.substring(dotIndex).toLowerCase() };
  } catch { return { base: hash(assetUrl), ext: "" }; }
}

function uniq(arr) { return [...new Set(arr)]; }

function niceNameFromAssetUrl(assetUrl) {
  try {
    const u = new URL(assetUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    let last = parts.at(-1) || "file.bin";
    const q = u.search ? "_" + hash(u.search) : "";
    const dotIndex = last.lastIndexOf(".");
    if (dotIndex !== -1) {
      const namePart = last.substring(0, dotIndex);
      const extPart = last.substring(dotIndex);
      last = `${namePart.substring(0, 50)}${q}${extPart}`;
    } else {
      last = `${last.substring(0, 50)}${q}`;
    }
    const parent = parts.at(-2) || "";
    const prefix = parent ? `${parent.substring(0, 20)}_` : "";
    return safeName(`${prefix}${last}`);
  } catch { return `asset_${hash(assetUrl)}`; }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}