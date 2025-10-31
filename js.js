const RECEIVER_NAME = 'Ceara Sementes';
const RECEIVER_CITY = 'FORTALEZA';
const CURRENCY = '986';
const COUNTRY = 'BR';
let codigoGerado = "";

function tlv(tag, value) {
  const len = new TextEncoder().encode(value).length;
  return tag + String(len).padStart(2, '0') + value;
}

function crc16(payload) {
  const poly = 0x1021;
  let crc = 0xFFFF;
  const bytes = new TextEncoder().encode(payload);
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ poly) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload(valorStr, chave, txid) {
  const valorNum = Number(valorStr.replace(',', '.'));
  if (!valorNum || valorNum <= 0) throw new Error('Valor inválido');
  const valor = valorNum.toFixed(2);

  let safeTxid = txid ? txid.replace(/[^0-9A-Za-z\-_.]/g, '').substring(0, 25) : '';
  let payload = '';
  payload += tlv('00', '01');
  let mai = '';
  mai += tlv('00', 'BR.GOV.BCB.PIX');
  mai += tlv('01', chave);
  payload += tlv('26', mai);
  payload += tlv('52', '0000');
  payload += tlv('53', CURRENCY);
  payload += tlv('54', valor);
  payload += tlv('58', COUNTRY);
  payload += tlv('59', RECEIVER_NAME.substring(0, 25));
  payload += tlv('60', RECEIVER_CITY.substring(0, 15));
  if (safeTxid) payload += tlv('62', tlv('05', safeTxid));
  const payloadForCrc = payload + '6304';
  const crc = crc16(payloadForCrc);
  payload += tlv('63', crc);
  return payload;
}

function gerarTxid() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function gerarPix() {
  const valor = document.getElementById('valor').value.trim();
  const nf = document.getElementById('nf').value.trim();
  const chave = document.getElementById('banco').value;
  const txid = nf ? nf : gerarTxid();

  try {
    const payload = buildPixPayload(valor, chave, txid);
    codigoGerado = payload;
    document.getElementById('pixCode').style.display = 'block';
    document.getElementById('pixCode').innerText = payload;
    new QRious({ element: document.getElementById('qrCode'), value: payload, size: 200 });
  } catch (err) {
    alert(err.message);
  }
}

function copiarPix() {
  if (!codigoGerado) {
    alert('Gere o código PIX primeiro.');
    return;
  }
  navigator.clipboard.writeText(codigoGerado).then(() => alert('Código PIX copiado!'));
}

async function baixarPDF() {
  if (!codigoGerado) {
    alert('Gere o código PIX primeiro.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const canvas = document.getElementById('qrCode');
  const imgData = canvas.toDataURL('image/png');
  const nf = document.getElementById('nf').value.trim();
  const nfTexto = nf ? `NF/Pedido: ${nf}` : '';
  doc.setFontSize(16);
  doc.text('Pagamento via PIX', 20, 20);
  if (nfTexto) doc.setFontSize(12).text(nfTexto, 20, 28);
  doc.text('Escaneie o QR Code ou copie o código abaixo:', 20, 36);
  doc.addImage(imgData, 'PNG', 60, 45, 90, 90);
  doc.setFontSize(10);
  doc.text('Código PIX:', 20, 140);
  const linhas = doc.splitTextToSize(codigoGerado, 170);
  doc.text(linhas, 20, 146);
  doc.save('Pagamento_PIX.pdf');
}
