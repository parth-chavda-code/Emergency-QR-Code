import QRCode from "qrcode";

export const stickerStyles = [
  { id: "red", name: "Red & white", background: "#c41230", foreground: "#ffffff", heading: "#ffffff", headingText: "#b61722" },
  { id: "white", name: "White & red", background: "#ffffff", foreground: "#0b1c30", heading: "#b61722", headingText: "#ffffff" },
  { id: "yellow", name: "Yellow & navy", background: "#facc15", foreground: "#0b1c30", heading: "#0b1c30", headingText: "#facc15" },
];

// Render QR modules at integer pixel sizes; never stretch or decorate the matrix.
export function drawSticker(canvas, qr, style) {
  canvas.width = 1800; canvas.height = 760;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image rendering unavailable");
  ctx.fillStyle = "#0b1c30"; ctx.fillRect(0, 0, 1800, 760);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(5, 5, 1790, 750);
  ctx.fillStyle = style.background; ctx.fillRect(12, 12, 1776, 736);
  const text = (value, x, y, size, color, weight = 700) => {
    ctx.fillStyle = color; ctx.font = `${weight} ${size}px Arial, sans-serif`; ctx.fillText(value, x, y);
  };
  text("Emergency QR", 48, 78, 42, style.foreground);
  ctx.fillStyle = style.heading; ctx.fillRect(40, 105, 990, 215);
  text("IN AN", 65, 185, 76, style.headingText);
  text("EMERGENCY", 65, 285, 104, style.headingText);
  text("Scan for my shared", 48, 400, 58, style.foreground);
  text("emergency information", 48, 475, 58, style.foreground);
  ctx.fillStyle = "#0b1c30"; ctx.fillRect(40, 520, 990, 130);
  text("SCAN HERE", 75, 615, 88, "#ffffff");
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(860, 568); ctx.lineTo(935, 568); ctx.lineTo(935, 543); ctx.lineTo(998, 585); ctx.lineTo(935, 627); ctx.lineTo(935, 602); ctx.lineTo(860, 602); ctx.closePath(); ctx.fill();
  text("No login required · Internet needed", 48, 712, 38, style.foreground, 600);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(1070, 30, 700, 700);
  const count = qr.modules.size;
  const scale = Math.floor(680 / (count + 8));
  if (scale < 4) throw new Error("QR link too large for sticker");
  const offsetX = 1070 + Math.floor((700 - count * scale) / 2);
  const offsetY = 30 + Math.floor((700 - count * scale) / 2);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
    if (qr.modules.get(row, col)) ctx.fillRect(offsetX + col * scale, offsetY + row * scale, scale, scale);
  }
}

export async function createStickerImages(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const images = {};
  for (const style of stickerStyles) {
    const canvas = document.createElement("canvas");
    drawSticker(canvas, qr, style);
    const image = canvas.toDataURL("image/png");
    if (!image.startsWith("data:image/png;base64,")) throw new Error("PNG export failed");
    images[style.id] = image;
  }
  return images;
}

// A selection change must not forget downloads of the same pending credential.
export function selectedDownloadsRequested(selected, requested) {
  return selected.length > 0 && selected.every(id => requested.includes(id));
}
