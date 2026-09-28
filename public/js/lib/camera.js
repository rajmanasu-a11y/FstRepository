import { html } from './dom.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { modal, toast } from './ui.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

/** Downscale on the client so uploads stay small; the server re-encodes again. */
export async function shrinkImage(blob, maxSide = 1024) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

export async function uploadPhoto(blob, name = 'photo.jpg') {
  const form = new FormData();
  form.append('photo', blob, name);
  return api('/photos', { method: 'POST', form });
}

/** Validate and upload a file chosen by the operator. */
export async function uploadFromFile(file) {
  if (!ACCEPTED.includes(file.type)) {
    toast('Only JPEG, PNG or WebP images are accepted. Please choose a valid photograph.', 'error');
    return null;
  }
  if (file.size > MAX_BYTES * 4) {
    toast('The selected image is too large (maximum 20 MB before compression). Please choose a smaller file.', 'error');
    return null;
  }
  let blob = file;
  try { blob = await shrinkImage(file); } catch { /* fall back to the original; the server validates */ }
  if (blob.size > MAX_BYTES) {
    toast('The photograph is too large. Please choose a smaller image.', 'error');
    return null;
  }
  return uploadPhoto(blob, file.name.replace(/\.[^.]+$/, '.jpg'));
}

/**
 * Camera capture dialog. Resolves to the uploaded photo ({ fileId, url }) or null.
 * The frame is cropped to a 3:4 portrait around the on-screen guide.
 */
export function captureFromCamera() {
  return new Promise((resolve) => {
    let stream = null;
    let captured = null;
    const m = modal({
      title: 'Capture Visitor Photograph',
      size: 'wide',
      body: html`
        <div class="camera-view">
          <video playsinline muted autoplay data-video></video>
          <img data-still alt="Captured photograph preview" hidden>
          <div class="camera-guide" aria-hidden="true"></div>
        </div>
        <div class="muted mt-1" data-cam-status role="status">Starting camera…</div>`,
      footer: html`
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="button" class="btn" data-retake hidden>${icon('refresh')}Retake</button>
        <button type="button" class="btn primary" data-capture disabled>${icon('camera')}Capture</button>
        <button type="button" class="btn success" data-use hidden>${icon('check')}Use Photograph</button>`,
      initialFocus: '[data-capture]',
      onClose: (result) => {
        stream?.getTracks().forEach((t) => t.stop());
        resolve(result ?? null);
      },
    });
    const el = m.el;
    const video = el.querySelector('[data-video]');
    const still = el.querySelector('[data-still]');
    const status = el.querySelector('[data-cam-status]');
    const btnCapture = el.querySelector('[data-capture]');
    const btnRetake = el.querySelector('[data-retake]');
    const btnUse = el.querySelector('[data-use]');

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        status.textContent = 'Camera access is not available in this browser. Please use Upload Photo instead.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'user' }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        status.textContent = 'Position the visitor within the frame and press Capture (or Enter).';
        btnCapture.disabled = false;
        btnCapture.focus();
      } catch (err) {
        status.textContent = err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in the browser, or use Upload Photo instead.'
          : 'No camera could be started. Please connect a camera or use Upload Photo instead.';
      }
    })();

    btnCapture.addEventListener('click', () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      // Crop the centred 3:4 region shown by the guide.
      const cropH = vh * 0.88;
      const cropW = cropH * 3 / 4;
      const sx = (vw - cropW) / 2;
      const sy = (vh - cropH) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 640;
      canvas.getContext('2d').drawImage(video, sx, sy, cropW, cropH, 0, 0, 480, 640);
      canvas.toBlob((blob) => {
        captured = blob;
        still.src = URL.createObjectURL(blob);
        still.hidden = false;
        video.hidden = true;
        btnCapture.hidden = true;
        btnRetake.hidden = false;
        btnUse.hidden = false;
        status.textContent = 'Review the photograph. Choose Use Photograph to continue, or Retake.';
        btnUse.focus();
      }, 'image/jpeg', 0.9);
    });
    btnRetake.addEventListener('click', () => {
      captured = null;
      still.hidden = true;
      video.hidden = false;
      btnCapture.hidden = false;
      btnRetake.hidden = true;
      btnUse.hidden = true;
      status.textContent = 'Position the visitor within the frame and press Capture.';
      btnCapture.focus();
    });
    btnUse.addEventListener('click', async () => {
      if (!captured) return;
      btnUse.disabled = true;
      status.textContent = 'Saving photograph…';
      try {
        const uploaded = await uploadPhoto(captured, 'camera.jpg');
        m.close(uploaded);
      } catch (err) {
        btnUse.disabled = false;
        status.textContent = err.message;
      }
    });
    el.querySelector('[data-cancel]').addEventListener('click', () => m.close(null));
  });
}
