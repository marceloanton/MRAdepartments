import type { EvidenceItem } from "./domain";

export async function compressImage(file: File, maxWidth = 1400, quality = 0.76) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context is not available.");

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Image compression failed."))), "image/jpeg", quality);
  });

  return {
    blob,
    dataUrl: canvas.toDataURL("image/jpeg", quality),
    sizeKb: Math.round(blob.size / 1024),
  };
}

export function buildLocalEvidence(input: {
  unitId: string;
  ticketId?: string;
  url: string;
  note?: string;
  sizeKb?: number;
}): EvidenceItem {
  return {
    id: `ev-${Date.now()}`,
    unitId: input.unitId,
    ticketId: input.ticketId,
    kind: "photo",
    url: input.url,
    note: input.note,
    sizeKb: input.sizeKb,
    createdAt: new Date().toISOString(),
  };
}
