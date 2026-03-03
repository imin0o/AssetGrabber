var statusEl = document.getElementById("status");
var downloadBtn = document.getElementById("download");
var scanBtn = document.getElementById("scan");

function setStatus(msg, isHTML) {
  if (!statusEl) return;
  if (isHTML) {
    statusEl.innerHTML = msg;
  } else {
    statusEl.textContent = msg;
  }
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    return tabs[0];
  });
}

function scanPage() {
  getActiveTab().then(function (tab) {
    if (!tab || !tab.id) {
      setStatus("No tab found", false);
      return;
    }

    setStatus("Scanning...", false);
    scanBtn.disabled = true;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function () {
        var base = location.href;
        var set = new Set();

        function add(u) {
          try {
            if (!u || u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return;
            var abs = new URL(u, base).href;
            set.add(abs);
          } catch (e) { }
        }

        var i, bg, m;
        // 画像
        var imgs = document.querySelectorAll("img");
        for (i = 0; i < imgs.length; i++) {
          add(imgs[i].src);
          add(imgs[i].currentSrc);
        }

        // ビデオ
        var vids = document.querySelectorAll("video, source");
        for (i = 0; i < vids.length; i++) {
          add(vids[i].src);
        }

        // リンク(メディアファイルのみ)
        var as = document.querySelectorAll("a");
        var reAsset = new RegExp('\\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)(\\?|#|$)', 'i');
        for (i = 0; i < as.length; i++) {
          if (as[i].href && reAsset.test(as[i].href)) {
            add(as[i].href);
          }
        }

        // srcset
        var ss = document.querySelectorAll("[srcset]");
        for (i = 0; i < ss.length; i++) {
          var val = ss[i].getAttribute("srcset");
          if (val) {
            var parts = val.split(",");
            for (var j = 0; j < parts.length; j++) {
              var u = parts[j].trim().split(/\s+/)[0];
              if (u) add(u);
            }
          }
        }

        // 背景画像
        var all = document.querySelectorAll("*");
        for (i = 0; i < all.length; i++) {
          bg = getComputedStyle(all[i]).backgroundImage;
          if (bg && bg !== "none") {
            m = bg.match(/url\(["']?(.*?)["']?\)/);
            if (m && m[1]) add(m[1]);
          }
        }

        // HTML内のテキストURL
        var html = document.documentElement.outerHTML;
        var reRaw = new RegExp('https?://[^\\s"\'<>)]+\\.(?:png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)', 'gi');
        var found = html.match(reRaw);
        if (found) {
          for (i = 0; i < found.length; i++) {
            add(found[i]);
          }
        }

        // pageUrlを返り値に含めることで、bg.js側でフォルダ名にドメインが使えるようになります
        return { pageUrl: base, urls: Array.from(set) };
      }
    }).then(function (results) {
      scanBtn.disabled = false;
      var res = results && results[0] && results[0].result;
      if (!res) {
        setStatus("Scan failed", false);
        return;
      }

      // bg.jsに「URLリスト」と「元のページURL」をセットで送信
      chrome.runtime.sendMessage({
        type: "SAVE_RESULT",
        payload: {
          urls: res.urls,
          pageUrl: res.pageUrl
        }
      }).then(function () {
        var assetRe = new RegExp('\\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)(\\?|#|$)', 'i');
        var previewList = document.getElementById("preview-list");
        if (previewList) previewList.innerHTML = "";

        // 重複排除ロジック (PNG > JPG > WEBP > AVIF)
        var priorityMap = { ".png": 1, ".jpg": 2, ".jpeg": 2, ".webp": 3, ".avif": 4, ".gif": 5, ".svg": 6 };
        var dedupMap = new Map();

        for (var k = 0; k < res.urls.length; k++) {
          var url = res.urls[k];
          if (assetRe.test(url)) {
            var path = url.split(/[?#]/)[0];
            var lastPart = path.split("/").pop();
            var dotIndex = lastPart.lastIndexOf(".");
            var base = (dotIndex !== -1) ? lastPart.substring(0, dotIndex) : lastPart;
            var ext = (dotIndex !== -1) ? lastPart.substring(dotIndex).toLowerCase() : "";
            var priority = priorityMap[ext] || 99;

            if (!dedupMap.has(base) || priority < dedupMap.get(base).priority) {
              dedupMap.set(base, { url: url, priority: priority, ext: ext });
            }
          }
        }

        var sortedItems = Array.from(dedupMap.values());
        var count = 0;

        for (var i = 0; i < sortedItems.length; i++) {
          var itemData = sortedItems[i];
          count++;
          if (previewList && count <= 100) { // リスト表示数を100件に増加
            var item = document.createElement("div");
            item.className = "preview-item";
            item.dataset.url = itemData.url;

            // チェックボックス追加
            var cbContainer = document.createElement("div");
            cbContainer.className = "checkbox-container";
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = true;
            cb.className = "asset-checkbox";
            cb.addEventListener("change", function (e) {
              var parent = e.target.closest(".preview-item");
              if (e.target.checked) {
                parent.classList.remove("unselected");
              } else {
                parent.classList.add("unselected");
              }
            });
            cbContainer.appendChild(cb);
            item.appendChild(cbContainer);

            var isVideo = [".mp4", ".webm", ".mov", ".m4v", ".mkv"].indexOf(itemData.ext) !== -1;
            var media;
            if (isVideo) {
              media = document.createElement("video");
              media.muted = true;
              media.src = itemData.url;
            } else {
              media = document.createElement("img");
              media.src = itemData.url;
            }
            media.loading = "lazy";

            var badge = document.createElement("span");
            badge.className = "type-badge";
            badge.textContent = itemData.ext.replace(".", "");

            item.appendChild(media);
            item.appendChild(badge);
            previewList.appendChild(item);
          }
        }
        setStatus("<b>" + count + "</b> 件を検出しました (個別に選択可能)", true);
        downloadBtn.disabled = false;
        downloadBtn.classList.add("primary-active");
        scanBtn.classList.add("secondary");
      });
    }).catch(function (err) {
      console.error(err);
      setStatus("Error: " + err.message, false);
      scanBtn.disabled = false;
    });
  });
}

function startDownload() {
  var selectedUrls = [];
  var items = document.querySelectorAll(".preview-item");
  for (var i = 0; i < items.length; i++) {
    var cb = items[i].querySelector(".asset-checkbox");
    if (cb && cb.checked) {
      selectedUrls.push(items[i].dataset.url);
    }
  }

  if (selectedUrls.length === 0) {
    setStatus("ダウンロードする項目を選択してください", false);
    return;
  }

  downloadBtn.disabled = true;
  setStatus("準備中...", false);

  // 選択されたリストで一時的にstorageを更新（bg.jsがstorageを読むため）
  chrome.storage.local.get(["last"]).then(function (data) {
    var last = data.last || {};
    last.urls = selectedUrls;
    return chrome.storage.local.set({ last: last });
  }).then(function () {
    return chrome.runtime.sendMessage({ type: "DOWNLOAD_SAVED" });
  }).then(function (res) {
    setStatus(res && res.status ? res.status : "開始しました", false);
  }).catch(function (err) {
    console.error(err);
    setStatus("エラー: " + err.message, false);
    downloadBtn.disabled = false;
  });
}

scanBtn.addEventListener("click", scanPage);
downloadBtn.addEventListener("click", startDownload);