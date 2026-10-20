import { MAX_IMAGE_BYTES } from './model.js';
export async function compressImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('仅支持 JPG、PNG、WebP 图片');
  if (file.size > 15 * 1024 * 1024) throw new Error('原图不能超过 15 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.width * image.height > 40000000)
      throw new Error('图片像素过大，请先缩小至 4000 万像素以内');
    let scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.85 - attempt * 0.06),
      );
      if (blob && blob.size <= MAX_IMAGE_BYTES)
        return await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error('图片读取失败'));
          r.readAsDataURL(blob);
        });
      scale *= 0.8;
    }
    throw new Error('压缩后图片仍超过 1 MB，请换用较小图片');
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('图片已损坏或无法解码');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}
