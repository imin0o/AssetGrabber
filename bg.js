const EXT_RE = /\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)(\?|#|$)/i;

// 優先順位（低いほど優先度が高い）
const PRIORITY = {
  ".png": 1,
  ".jpg": 2,
  ".jpeg": 2,
  ".webp": 3,
  ".avif": 4,
  ".gif": 5,
  ".svg": 6
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SAVE_RESULT") {
    chrome.storage.local.set({ last: msg.payload }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "DOWNLOAD_SAVED") {
    (async () => {
      try {
        const { last } = await chrome.storage.local.get(["last"]);
        if (!last) {
          sendResponse({ status: "先にスキャンしてください" });
          return;
        }

        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const domain = safeName(new URL(last.pageUrl).hostname);
        const hostDir = `${domain}_${timestamp}`;

        // 1) HTML保存
        const base64Html = btoa(unescape(encodeURIComponent(last.html)));
        const htmlDataUrl = `data:text/html;base64,${base64Html}`;

        await chrome.downloads.download({
          url: htmlDataUrl,
          filename: `${hostDir}/page.html`,
          saveAs: false
        });

        // 2) アセットURLをフィルタしてDL
        const allTargets = uniq(last.urls).filter(u => EXT_RE.test(u));

        // 重複排除ロジック (ベース名が同じなら優先度の高い拡張子を採用)
        const dedupMap = new Map(); // key: baseNameWithoutExt, value: { url, ext, priority }

        for (const u of allTargets) {
          const { base, ext } = getPathInfo(u);
          const currentPriority = PRIORITY[ext.toLowerCase()] || 99;

          if (!dedupMap.has(base) || currentPriority < dedupMap.get(base).priority) {
            dedupMap.set(base, { url: u, ext, priority: currentPriority });
          }
        }

        const filteredTargets = Array.from(dedupMap.values()).map(v => v.url);

        for (const u of filteredTargets) {
          try {
            const filename = `${hostDir}/assets/${niceNameFromAssetUrl(u)}`;
            chrome.downloads.download({ url: u, filename, saveAs: false }).catch(() => { });
          } catch (e) { }
        }

        sendResponse({ status: `DL開始: ${filteredTargets.length}件 (重複除外: ${allTargets.length - filteredTargets.length}件)` });
      } catch (err) {
        sendResponse({ status: `Error: ${err.message}` });
      }
    })();
    return true;
  }
});

function getPathInfo(assetUrl) {
  try {
    const u = new URL(assetUrl);
    const pathname = u.pathname;
    const lastPart = pathname.split("/").pop() || "";
    const dotIndex = lastPart.lastIndexOf(".");

    if (dotIndex === -1) return { base: lastPart, ext: "" };
    return {
      base: lastPart.substring(0, dotIndex),
      ext: lastPart.substring(dotIndex).toLowerCase()
    };
  } catch {
    return { base: hash(assetUrl), ext: "" };
  }
}

function uniq(arr) {
  return [...new Set(arr)];
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, "_");
}

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
      last = `${namePart}${q}${extPart}`;
    } else {
      last = `${last}${q}`;
    }

    const parent = parts.at(-2);
    return safeName(parent ? `${parent}_${last}` : last);
  } catch {
    return `asset_${hash(assetUrl)}`;
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

