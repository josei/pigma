/**
 * Browser-side image input: turning a picked/dropped/pasted file into an inline
 * data URL plus its natural size, which is what the document model stores.
 */

export interface DecodedImage {
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

export function imageFromDataUrl(dataUrl: string): Promise<{ width: number; height: number }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ width: number; height: number }>();
  const image = new Image();
  image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
  image.onerror = () => reject(new Error('Could not decode that image'));
  image.src = dataUrl;
  return promise;
}

function readAsDataUrl(file: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Could not read that file'));
  reader.readAsDataURL(file);
  return promise;
}

/** Decode a picked/dropped/pasted image file into a data URL with its size. */
export async function decodeImageFile(file: File | Blob, name = 'Image'): Promise<DecodedImage> {
  const dataUrl = await readAsDataUrl(file);
  const size = await imageFromDataUrl(dataUrl);
  return { dataUrl, width: size.width, height: size.height, name };
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** First image in a drag payload, if any. */
export function imageFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) if (isImageFile(file)) return file;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
