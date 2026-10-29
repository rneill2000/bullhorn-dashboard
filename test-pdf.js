"use strict";
/** Test helper: a tiny valid PDF with real text, so the résumé contact check can read it. */
function textPdf(text) {
  const lines = String(text == null ? "Consultant résumé" : text).split("\n");
  const ops = ["BT", "/F1 11 Tf", "50 750 Td", "14 TL"];
  lines.forEach(function (l) { ops.push("(" + l.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "") + ") Tj T*"); });
  ops.push("ET");
  const stream = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach(function (o, i) { offsets.push(Buffer.byteLength(out)); out += (i + 1) + " 0 obj\n" + o + "\nendobj\n"; });
  const xref = Buffer.byteLength(out);
  out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n";
  offsets.forEach(function (o) { out += String(o).padStart(10, "0") + " 00000 n \n"; });
  out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}
module.exports = { textPdf: textPdf };
