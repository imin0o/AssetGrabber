const statusEl = document.getElementById("status");
const downloadBtn = document.getElementById("download");
const scanBtn = document.getElementById("scan");

function setStatus(msg, isHTML = false) {
  if (statusEl) {
    if (isHTML) {
      statusEl.innerHTML = msg;
    } else {
      statusEl.textContent = msg;
    }
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

scanBtn.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setStatus("タブが見つかりません");
      return;
    }

    setStatus("スキャン中...");
    scanBtn.disabled = true;

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const urls = new Set();
        const base = location.href;

        const add = (u) => {
          try {
            if (!u || u.startsWith('data:') || u.startsWith('blob:')) return;
            const abs = new URL(u, base).href;
            urls.add(abs);
          } catch (e) { }
        };

        document.querySelectorAll("img").forEach((el) => {
          add(el.src);
          add(el.currentSrc);
        });
        document.querySelectorAll("video").forEach((el) => add(el.src));
        document.querySelectorAll("source").forEach((el) => add(el.src));
        document.querySelectorAll("a").forEach((el) => {
          if (el.href.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov)(\?|#|$)/i)) {
            add(el.href);
          }
        });

        document.querySelectorAll("[srcset]").forEach((el) => {
          const srcset = el.getAttribute("srcset");
          if (!srcset) return;
          const parts = srcset.split(/,(?=\s+)/);
          parts.forEach((part) => {
            const u = part.trim().split(/\s+/)[0];
            add(u);
          });
        });

        for (const el of document.querySelectorAll("*")) {
          const bg = getComputedStyle(el).backgroundImage;
          const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
          if (m && m[1]) add(m[1]);
        }

        const html = document.documentElement.outerHTML;
        const re = /https?:\/\/[^\s"'<>)]+\.(?:png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)/gi;
        const matches = html.matchAll(re);
        for (const m of matches) {
          add(m[0]);
        }

        return { pageUrl: base, html, urls: [...urls] };
      }
    });

    const result = injected?.[0]?.result;
    if (!result) {
      setStatus("抽出に失敗しました");
      scanBtn.disabled = false;
      return;
    }

    await chrome.runtime.sendMessage({ type: "SAVE_RESULT", payload: result });
    const count = result.urls.filter(u => /\.(png|jpe?g|webp|gif|avif|bmp|svg|mp4|webm|mov|m4v|mkv)(\?|#|$)/i.test(u)).length;
    setStatus(`<b>${count}</b> 件を検出しました`, true);
    downloadBtn.disabled = false;
    scanBtn.disabled = false;
  } catch (e) {
    console.error(e);
    setStatus(`エラー: ${e.message}`);
    scanBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", async () => {
  try {
    downloadBtn.disabled = true;
    setStatus("準備中...");
    const res = await chrome.runtime.sendMessage({ type: "DOWNLOAD_SAVED" });
    setStatus(res?.status ?? "ダウンロード開始");
  } catch (e) {
    console.error(e);
    setStatus(`エラー: ${e.message}`);
    downloadBtn.disabled = false;
  }
});
