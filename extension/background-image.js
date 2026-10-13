/* Local-only image preparation shared by the popup and the content host. */
(() => {
  'use strict';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_DATA_CHARACTERS = 3 * 1024 * 1024;
  const MAX_EDGE = 1600;
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const LOCAL_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  function cleanName(value) {
    const text = typeof value === 'string' ? value : '';
    return text.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 100).replace(/[\uD800-\uDBFF]$/, '') || '自定义背景';
  }
  function sanitize(value) {
    if (!value || typeof value !== 'object') return null;
    const { dataURL, width, height } = value;
    if (typeof dataURL !== 'string' || dataURL.length > MAX_DATA_CHARACTERS || !LOCAL_IMAGE.test(dataURL)) return null;
    if (!dataURL.slice(dataURL.indexOf(',') + 1).length) return null;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE) return null;
    return { dataURL, width, height, name: cleanName(value.name) };
  }
  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片处理失败，请更换一张图片。')), 'image/jpeg', 0.85);
    });
  }
  function toDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片处理失败，请更换一张图片。'));
      reader.onerror = () => reject(new Error('图片处理失败，请更换一张图片。'));
      reader.readAsDataURL(blob);
    });
  }
  async function prepareFile(file) {
    if (!file || !IMAGE_TYPES.has(file.type)) throw new Error('请选择 JPEG、PNG 或 WEBP 图片。');
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('图片文件为空或无法读取。');
    if (file.size > MAX_FILE_BYTES) throw new Error('图片不能超过 20 MB，请选择较小的图片。');
    let bitmap;
    let canvas;
    try {
      try { bitmap = await createImageBitmap(file); }
      catch (_) { throw new Error('图片无法读取，请选择未损坏的 JPEG、PNG 或 WEBP 图片。'); }
      if (!bitmap || !Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) {
        throw new Error('图片无法读取，请选择未损坏的 JPEG、PNG 或 WEBP 图片。');
      }
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      let width = Math.max(1, Math.round(bitmap.width * scale));
      let height = Math.max(1, Math.round(bitmap.height * scale));
      canvas = document.createElement('canvas');
      for (let attempt = 0; attempt < 10; attempt++) {
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('当前浏览器无法处理背景图片。');
        context.fillStyle = '#11151e';
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        const dataURL = await toDataURL(await toBlob(canvas));
        const prepared = sanitize({ dataURL, width, height, name: file.name });
        if (prepared) return prepared;
        if (dataURL.length <= MAX_DATA_CHARACTERS) throw new Error('图片处理失败，请更换一张图片。');
        width = Math.max(1, Math.floor(width * 0.8));
        height = Math.max(1, Math.floor(height * 0.8));
      }
      throw new Error('图片处理后仍然过大，请选择较小的图片。');
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
  }
  globalThis.TNTBackground = Object.freeze({ sanitize, prepareFile });
})();
