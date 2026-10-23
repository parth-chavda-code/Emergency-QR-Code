import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {drawSticker, createStickerImages, stickerStyles, selectedDownloadsRequested} from '../src/qrStickers.js';

function sampleCanvas() {
 const rectangles=[]; const text=[];
 const ctx={fillStyle:'',fillRect(x,y,w,h){rectangles.push({color:this.fillStyle,x,y,w,h});},fillText(value){text.push(value);},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){}};
 return {rectangles,text,getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,c2FtcGxl'};
}

test('all sticker styles preserve the exact matrix with an integer scale and a four-module quiet zone',()=>{
 const qr=QRCode.create('https://example.test/e/'+'a'.repeat(43),{errorCorrectionLevel:'M'});
 let original;
 for(const style of stickerStyles){
  const canvas=sampleCanvas(); drawSticker(canvas,qr,style);
  assert.equal(canvas.width,1800); assert.equal(canvas.height,760);
  const pixels=canvas.rectangles.filter(r=>r.color==='#000000');
  if(original)assert.deepEqual(pixels,original); original=pixels;
  const scale=pixels[0].w;
  assert.ok(Number.isInteger(scale)&&scale>=4);
  assert.equal(pixels.length,Array.from(qr.modules.data).filter(Boolean).length);
  assert.ok(pixels.every(r=>r.w===scale&&r.h===scale&&r.x>=1070+4*scale&&r.y>=30+4*scale&&r.x+r.w<=1770-4*scale&&r.y+r.h<=730-4*scale));
  assert.ok(canvas.text.includes('EMERGENCY'));
  assert.ok(canvas.text.every(t=>!t.includes('https:')));
 }
});

test('PNG generation is all-or-nothing and rendering failures reject safely',async t=>{
 const previous=globalThis.document;
 t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 globalThis.document={createElement:()=>sampleCanvas()};
 assert.deepEqual(Object.keys(await createStickerImages('https://example.test/e/'+'a'.repeat(43))),['red','white','yellow']);
 globalThis.document={createElement:()=>({getContext:()=>null})};
 await assert.rejects(createStickerImages('https://example.test'),/rendering unavailable/);
 globalThis.document={createElement:()=>({...sampleCanvas(),toDataURL:()=> 'data:,'})};
 await assert.rejects(createStickerImages('https://example.test'),/PNG export failed/);
});

test('changing selection preserves existing downloads but blocks new or empty selections', () => {
 const requested = ['yellow'];
 assert.equal(selectedDownloadsRequested(['red', 'yellow'], requested), false);
 // Download yellow, then deselect the default red: no second download is needed.
 assert.equal(selectedDownloadsRequested(['yellow'], requested), true);
 assert.equal(selectedDownloadsRequested(['yellow', 'white'], requested), false);
 assert.equal(selectedDownloadsRequested(['yellow', 'white'], [...requested, 'white']), true);
 assert.equal(selectedDownloadsRequested([], requested), false);
 assert.equal(selectedDownloadsRequested(['yellow'], []), false);
});
