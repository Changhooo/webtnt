/* Screenshot adapter. The animation engine never depends on Chrome APIs. */
'use strict';
let lastCaptureAt = 0;
let capturePending = false;

async function captureForSender(sender) {
  if (!sender.tab || sender.frameId !== 0) throw new Error('只能从当前网页发起爆炸。');
  if (capturePending || Date.now() - lastCaptureAt < 550) throw new Error('截取画面过于频繁，请稍后重试。');
  capturePending = true;
  try {
    const tab = await chrome.tabs.get(sender.tab.id);
    const win = await chrome.windows.get(tab.windowId);
    if (!tab.active || !win.focused) throw new Error('请回到放置 TNT 的标签页再引爆。');
    lastCaptureAt = Date.now();
    const dataURL = await chrome.tabs.captureVisibleTab(tab.windowId, {format:'png'});
    const [active] = await chrome.tabs.query({active:true, windowId:tab.windowId});
    const after = await chrome.windows.get(tab.windowId);
    if (active?.id !== tab.id || !after.focused) throw new Error('标签页已切换，本次爆炸已取消。');
    return {ok:true, dataURL};
  } finally { capturePending = false; }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'TNT_CAPTURE') return;
  captureForSender(sender).then(reply, error => reply({ok:false, error:error.message || '无法截取当前画面。'}));
  return true;
});
