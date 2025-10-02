/* istanbul ignore file */

export async function normalizeImageFile(file) {
  if (!(file instanceof Blob)) {
    throw new TypeError('Expected a File or Blob instance');
  }

  const blob = file.slice(0, file.size, file.type || 'image/jpeg');
  const bitmap = await createImageBitmapWithOrientation(blob);
  const original = await drawBitmapToBlob(bitmap, blob.type);
  const thumb = await createThumbnail(bitmap, blob.type);

  return {
    original,
    thumb,
    width: bitmap.width,
    height: bitmap.height,
  };
}

async function createThumbnail(bitmap, mime) {
  const size = getBitmapSize(bitmap);
  const longest = Math.max(size.width, size.height);
  const scale = longest > 512 ? 512 / longest : 1;
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  return drawBitmapToBlob(bitmap, mime, width, height, 0.9);
}

async function drawBitmapToBlob(bitmap, mime, width, height, quality = 0.92) {
  const size = getBitmapSize(bitmap);
  const targetWidth = width ?? size.width;
  const targetHeight = height ?? size.height;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (!result) {
        reject(new Error('Unable to create blob from canvas'));
        return;
      }
      resolve(result);
    }, mime, quality);
  });
  return blob;
}

async function createImageBitmapWithOrientation(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
  }

  // Fallback for browsers without createImageBitmap.
  const img = document.createElement('img');
  img.src = await blobToDataUrl(blob);
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });
  return img;
}

function getBitmapSize(bitmap) {
  if ('width' in bitmap && 'height' in bitmap) {
    return { width: bitmap.width, height: bitmap.height };
  }
  if ('naturalWidth' in bitmap && 'naturalHeight' in bitmap) {
    return { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
  }
  throw new Error('Unsupported bitmap type');
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob) {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl.split(',')[1];
}

export function base64ToBlob(base64, mimeType = 'application/octet-stream') {
  if (typeof base64 !== 'string') {
    throw new TypeError('Expected base64 string');
  }
  if (base64.length === 0) {
    return new Blob([], { type: mimeType });
  }

  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
