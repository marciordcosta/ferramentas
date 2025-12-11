// ------------------------------------------------------------
// conciliacao.organizado.js
// Versão reorganizada e com duplicidades consolidadas (sem alterar lógica)
// ------------------------------------------------------------

// Estado global
let banco = [];
let sistema = [];
let selectedBanco = new Set();
let selectedSistema = new Set();
// arquivos importados (acumulam, não substituem)
let arquivosOFX = [];
let arquivosSYS = [];

// ------------------------------------------------------------
// CONSTS / MAPS
// ------------------------------------------------------------
const paymentColor = {
  PIX: '#1E90FF',
  CARTAO: '#28a745',
  BOLETO: '#dc3545',
  TRANSFER: '#6f42c1',
  OUTRO: '#999999'
};

// ------------------------------------------------------------
// UTILITÁRIOS
// ------------------------------------------------------------
function formatMoney(n) {
  if (n == null || n === "") return "R$ 0.00";
  return "R$ " + Number(n).toFixed(2);
}

function safeIdForHtml(s) {
  return String(s || "").replace(/"/g, '&quot;').replace(/'/g, "\\'");
}

function gerarChave() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'k' + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36);
}

function normalizeFileName(n) {
  return String(n || "").trim().toLowerCase();
}

function removerAcentos(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "");
}

// ------------------------------------------------------------
// RENDER: arquivos importados (OFX / SYS)
// ------------------------------------------------------------
function renderArquivosImportados() {
  const boxOFX = document.getElementById("arquivosOFX");
  const boxSYS = document.getElementById("arquivosSYS");
  if (!boxOFX || !boxSYS) return;

  const ofxHTML = arquivosOFX.map(nome => `
        <span class="arquivo-tag">
            ${nome}
            <span onclick="removerArquivoOFX('${nome}')">×</span>
        </span>
    `).join(" | ");

  const sysHTML = arquivosSYS.map(nome => `
        <span class="arquivo-tag">
            ${nome}
            <span onclick="removerArquivoSYS('${nome}')">×</span>
        </span>
    `).join(" | ");

  boxOFX.innerHTML = ofxHTML;
  boxSYS.innerHTML = sysHTML;
}

// ------------------------------------------------------------
// REMOVER ARQUIVOS (implementações centrais)
// ------------------------------------------------------------
function removerArquivoOFX(nome) {
  const nomeNorm = normalizeFileName(nome);

  // remove registros do banco vinculados ao arquivo original
  banco = banco.filter(x => normalizeFileName(x.ofxFileName) !== nomeNorm);

  // remove do array de arquivos importados
  arquivosOFX = arquivosOFX.filter(f => f !== nomeNorm);

  renderArquivosImportados();
  renderList();
  atualizarTotais();
}

function removerArquivoSYS(nome) {
  const nomeNorm = normalizeFileName(nome);

  sistema = sistema.filter(x => normalizeFileName(x.systemFileName) !== nomeNorm);

  arquivosSYS = arquivosSYS.filter(f => f !== nomeNorm);

  renderArquivosImportados();
  renderList();
  atualizarTotais();
}

// Funções expostas alternativas (mantém API antiga) — delegam às funções acima para evitar duplicidade
function deleteOfxFile(filename) {
  if (!filename) return;
  // delega, preservando comportamento público
  removerArquivoOFX(filename);
}

function deleteSystemFile(filename) {
  if (!filename) return;
  removerArquivoSYS(filename);
}

// ------------------------------------------------------------
// CLASSIFICAÇÕES (OFX / SISTEMA)
// ------------------------------------------------------------
function getCategoriaOfx(desc) {
  const t = removerAcentos(String(desc || "").toLowerCase());

  if (t.includes("pix") ||
      t.includes("dep") || t.includes("deposit") || t.includes("dinheiro") ||
      t.includes("transf") || t.includes("transfer") || t.includes("ted") || t.includes("doc"))
    return "PIX";

  if (t.includes("cartao") || t.includes("cred") || t.includes("visa") || t.includes("master"))
    return "CARTAO";

  if (t.includes("boleto"))
    return "BOLETO";

  return "OUTRO";
}

function getBolaOfx(desc) {
  const s = String(desc || "").toLowerCase();
  const t = removerAcentos(s).replace(/\s+/g,' ').trim();

  if (t.includes('pix') ||
      t.includes('dep ') || t.startsWith('dep.') || t.includes('deposito') || t.includes('deposit') ||
      t.includes('dinheiro') ||
      t.includes('transf') || t.includes('transferencia') || t.includes('ted') || t.includes('doc')) {
    return paymentColor.PIX;
  }

  if (t.includes('cartao') || t.includes('cartão') || t.includes('carto') || t.includes('carte') ||
      t.includes('crd') || t.includes('cred') || t.includes('credito') ||
      t.includes('visa') || t.includes('master') || t.includes('elo') || t.includes('tef')) {
    return paymentColor.CARTAO;
  }

  if (t.includes('boleto')) return paymentColor.BOLETO;

  return paymentColor.OUTRO;
}

function getCategoriaSistema(tipo) {
  const s = removerAcentos(String(tipo || "").toLowerCase());

  if (s.includes("pix") || s.includes("dep") || s.includes("transfer") || s.includes("ted") || s.includes("doc"))
    return "PIX";
  if (s.includes("cartao") || s.includes("cred") || s.includes("debito"))
    return "CARTAO";
  if (s.includes("boleto"))
    return "BOLETO";

  return "OUTRO";
}

function getBolaSistema(tipo) {
  const s = String(tipo || "").toLowerCase();
  const t = removerAcentos(s).replace(/\s+/g,' ').trim();

  if (t.includes('pix') ||
      t.includes('dep') || t.includes('deposito') || t.includes('deposit') ||
      t.includes('transf') || t.includes('transferencia') || t.includes('ted') || t.includes('doc'))
    return paymentColor.PIX;

  if (t.includes('cartao') || t.includes('cartão') || t.includes('carto') ||
      t.includes('crd') || t.includes('cred') || t.includes('credito') ||
      t.includes('debito') || t.includes('deb'))
    return paymentColor.CARTAO;

  if (t.includes('boleto')) return paymentColor.BOLETO;

  if (t.includes('dinheiro') || t.includes('carteira')) return paymentColor.OUTRO;

  return paymentColor.OUTRO;
}

// detectPaymentTypeFromOfx mantém comportamento semelhante a getCategoriaOfx, mas retorna string de tipo para item OFX
function detectPaymentTypeFromOfx(desc) {
  if (!desc) return 'OUTRO';
  const t = removerAcentos(String(desc).toLowerCase());

  if (t.includes('pix')) return 'PIX';
  if (t.includes('cartao') || t.includes('cred') || t.includes('tef') || t.includes('master') || t.includes('visa')) return 'CARTAO';
  if (t.includes('boleto')) return 'BOLETO';
  if (t.includes('transfer') || t.includes('deposit') || t.includes('dep.')) return 'TRANSFER';

  return 'OUTRO';
}

// ------------------------------------------------------------
// PARSER OFX
// ------------------------------------------------------------
function parseOFX(text, filename) {
  const items = [];
  const bankInfo = detectBankFromOfx(text, filename);
  text = text.replace(/\r/g, "\n");
  const parts = text.split(/<STMTTRN>/i);

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].split(/<\/STMTTRN>/i)[0];
    const get = (t) => {
      const m = p.match(new RegExp(`<${t}>([^<]*)`, "i"));
      return m ? m[1].trim() : null;
    };

    const amt = parseFloat(get("TRNAMT") || "0");
    const dt = get("DTPOSTED") || "";
    let date = null;
    const mm = dt && dt.match(/(\d{4})(\d{2})(\d{2})/);
    if (mm) date = `${mm[1]}-${mm[2]}-${mm[3]}`;

    let rawDesc = get("NAME") || get("MEMO") || "";
    let desc = removerAcentos(rawDesc);

    const payment_type = detectPaymentTypeFromOfx(desc);

    items.push({
      id: filename + "_" + i,
      ofxFileName: filename,
      bank: bankInfo.code,
      bankName: bankInfo.name,
      date,
      amount: amt,
      desc,
      payment_type,
      conciliado: false
    });
  }

  return items;
}

function detectBankFromOfx(text, filename) {
  if (!text) text = "";
  if (!filename) filename = "";

  const clean = removerAcentos(text.toLowerCase());
  const fname = removerAcentos(filename.toLowerCase());

  if (clean.includes("banco do brasil") || clean.includes("<org>bb") || clean.includes("<bankid>001"))
    return { code: "001", name: "Banco do Brasil" };

  if (clean.includes("stone") || clean.includes("stone pagamentos") || clean.includes("<org>stone"))
    return { code: "197", name: "Stone" };

  if (fname.includes("bb") || fname.includes("brasil"))
    return { code: "001", name: "Banco do Brasil" };

  if (fname.includes("stone"))
    return { code: "197", name: "Stone" };

  return { code: "999", name: "Banco Desconhecido" };
}

// ------------------------------------------------------------
// PARSER HTML MATRICIAL (SISTEMA)
// ------------------------------------------------------------
function parseMatricial(html, filename) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const divs = [...doc.querySelectorAll("div[style]")].filter(d =>
    /top\s*:\s*\d+/i.test(d.getAttribute("style"))
  );

  const itens = divs.map(d => {
    const st = d.getAttribute("style");
    const top = Math.round(parseFloat((st.match(/top\s*:\s*([\d\.]+)/i) || [])[1] || 0));
    const left = Math.round(parseFloat((st.match(/left\s*:\s*([\d\.]+)/i) || [])[1] || 0));
    return { top, left, text: d.textContent.trim() };
  });

  const linhas = {};
  itens.forEach(it => {
    if (!linhas[it.top]) linhas[it.top] = [];
    linhas[it.top].push(it);
  });

  const resultado = [];

  const COL_CLIENTE  = [70, 140];
  const COL_DOC      = [140, 200];
  const COL_VALOR    = [200, 260];
  const COL_PAGTO    = [480, 530];
  const COL_TIPO     = [530, 600];
  const COL_VENDEDOR = [600, 700];
  const COL_NF       = [700, 800];

  function inside(x, r) { return x >= r[0] && x <= r[1]; }

  const fname = String(filename || "").toLowerCase();

  // normaliza
  const normalizedHTML = removerAcentos(html.toLowerCase());
  const normalizedFile = removerAcentos(fname.toLowerCase());

  function match(k) {
      return normalizedHTML.includes(k) || normalizedFile.includes(k);
  }

  // qualquer variação de saída
  const isPagar =
      match("paga") ||   // pagamento, pagar, pagas, pagto, pagando, pagou
      match("saida") ||  // saida, saídas, saidas
      match("desp") ||   // despesa, despesas
      match("deb")  ||   // debito, débito, debitado
      match("retir");    // retirada, retirar, retirado

  // rótulo correto
  const fileKindLabel = isPagar ? 'Saída' : 'Entrada';


  // testa arquivo pelo nome OU conteúdo HTML
  const isPagar =
    saidaKeywords.some(k => lowerFile.includes(k)) ||
    saidaKeywords.some(k => html.toLowerCase().includes(k));


  Object.keys(linhas).sort((a,b)=>a-b).forEach((top, idx) => {
    const cols = linhas[top];
    let cliente=null, doc=null, valor=null, pagto=null, nf=null, vendedor=null, tipo=null;

    cols.forEach(c => {
      const txt = c.text;

      if (inside(c.left, COL_CLIENTE)) cliente = removerAcentos(txt);
      else if (inside(c.left, COL_DOC)) doc = txt;
      else if (inside(c.left, COL_VALOR) && /\d+[\.,]\d{2}/.test(txt)) {
        valor = parseFloat(txt.replace(/\./g,"").replace(/,/g,"."));
      }
      else if (inside(c.left, COL_PAGTO) && /^\d{2}\/\d{2}\/\d{4}$/.test(txt)) {
        const [d,m,y] = txt.split("/");
        pagto = `${y}-${m}-${d}`;
      }
      else if (inside(c.left, COL_TIPO)) tipo = removerAcentos(txt);
      else if (inside(c.left, COL_VENDEDOR)) vendedor = removerAcentos(txt);
      else if (inside(c.left, COL_NF) && /^\d+$/.test(txt)) nf = txt;
    });

    if (valor !== null) {
      resultado.push({
        id: `${filename || 'SIST'}_${idx}`,
        systemFileName: filename || '',
        fileKind: fileKindLabel,
        cliente,
        doc,
        valor: isPagar ? (valor * -1) : valor,
        data: pagto,
        nf,
        vendedor,
        tipo,
        conciliado: false
      });
    }
  });

  return resultado;
}

// ------------------------------------------------------------
// FILTROS
// ------------------------------------------------------------
function getFilterValues() {
  return {
    bank: document.getElementById('filterBanco')?.value || '',
    start: document.getElementById('filterDataInicio')?.value || '',
    end: document.getElementById('filterDataFim')?.value || '',
    tipo: document.getElementById('filterTipo')?.value || '',
    kind: document.getElementById('filterKind')?.value || ''
  };
}

function applyFilters() {
  const f = getFilterValues();

  const bancoFiltered = banco.filter(b => {
    if (f.bank && b.bank !== f.bank) return false;

    if (f.tipo) {
      const cat = getCategoriaOfx(b.desc);
      if (cat !== f.tipo.toUpperCase()) return false;
    }

    if (f.start && b.date && b.date < f.start) return false;
    if (f.end && b.date && b.date > f.end) return false;

    if (f.kind === "receber") {
      if (Number(b.amount) < 0) return false;
    }
    if (f.kind === "pagar") {
      if (Number(b.amount) >= 0) return false;
    }

    return true;
  });

  const sistemaFiltered = sistema.filter(s => {
    if (f.kind === "receber") {
      if (Number(s.valor) < 0) return false;
    }
    if (f.kind === "pagar") {
      if (Number(s.valor) >= 0) return false;
    }

    if (f.tipo) {
      const cat = getCategoriaSistema(s.tipo);
      if (cat !== f.tipo.toUpperCase()) return false;
    }

    if (f.start && s.data && s.data < f.start) return false;
    if (f.end && s.data && s.data > f.end) return false;

    return true;
  });

  return { bancoFiltered, sistemaFiltered };
}

// limpar filtros (liga ao elemento somente quando presente)
document.getElementById("limparFiltros")?.addEventListener("click", () => {
  document.getElementById("filterBanco").value = "";
  document.getElementById("filterTipo").value = "";
  document.getElementById("filterKind").value = "";
  document.getElementById("filterDataInicio").value = "";
  document.getElementById("filterDataFim").value = "";

  renderList();
  atualizarTotais();
});

// ------------------------------------------------------------
// TOTALIZADORES
// ------------------------------------------------------------
function calcTotals(list, isSistema = false) {
  const totals = { count: 0, entradas: 0, saidas: 0 };

  list.forEach(it => {
    totals.count++;
    const v = Number(isSistema ? (it.valor || 0) : (it.amount || 0));
    if (v >= 0) totals.entradas += v;
    else totals.saidas += v;
  });

  return totals;
}

function atualizarTotais() {
  const { bancoFiltered, sistemaFiltered } = applyFilters();

  const tOfx = calcTotals(bancoFiltered, false);
  const tSys = calcTotals(sistemaFiltered, true);

  document.getElementById('t_ofx_regs').textContent = tOfx.count;
  document.getElementById('t_ofx_in').textContent = tOfx.entradas.toFixed(2);
  document.getElementById('t_ofx_out').textContent = tOfx.saidas.toFixed(2);

  document.getElementById('t_sys_regs').textContent = tSys.count;
  document.getElementById('t_sys_in').textContent = tSys.entradas.toFixed(2);
  document.getElementById('t_sys_out').textContent = tSys.saidas.toFixed(2);
}

// ------------------------------------------------------------
// CONCILIAÇÃO / CANCELAR
// ------------------------------------------------------------
function cancelarConciliacao(chave) {
  if (!chave) return;

  banco.forEach(b => {
    if (b.parChave === chave) {
      b.conciliado = false;
      delete b.parChave;
      delete b.nf;
      delete b.cliente;
      delete b.doc;
      delete b.tipo;
      delete b.dataSistema;
    }
  });

  sistema.forEach(s => {
    if (s.parChave === chave) {
      s.conciliado = false;
      delete s.parChave;
    }
  });

  renderList();
}
window.cancelarConciliacao = cancelarConciliacao;

// ------------------------------------------------------------
// PAINEL DIFERENÇA (flutuante)
// ------------------------------------------------------------
function ensurePainelDiferenca() {
  let p = document.getElementById("painelDiferenca");
  if (!p) {
    p = document.createElement("div");
    p.id = "painelDiferenca";
    p.textContent = "Diferença: R$ 0.00";
    document.body.appendChild(p);
  }
  return p;
}

function atualizarPainelDiferenca() {
  const p = ensurePainelDiferenca();

  const somaBanco = banco
    .filter(x => selectedBanco.has(x.id))
    .reduce((t,x)=>t + (Number(x.amount)||0), 0);

  const somaSistema = sistema
    .filter(x => selectedSistema.has(x.id))
    .reduce((t,x)=>t + (Number(x.valor)||0), 0);

  const dif = somaBanco - somaSistema;

  p.innerHTML = `
    <div style="font-size:18px; font-weight:bold; margin-bottom:6px;">
      Diferença:
      <span style="color:${Math.abs(dif) < 0.01 ? 'green' : 'red'};">
        R$ ${dif.toFixed(2)}
      </span>
    </div>

    <div style="font-size:14px; font-weight:normal; margin-top:4px;">
      <b>Banco:</b> R$ ${somaBanco.toFixed(2)}
    </div>

    <div style="font-size:14px; font-weight:normal; margin-bottom:15px;">
      <b>Sistema:</b> R$ ${somaSistema.toFixed(2)}
    </div>

    <button id="btnConciliarFloat"
      style="
        width: 100%;
        padding: 6px 10px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        background: #4aa3ff;
        color: #fff;
        font-size: 14px;
        font-weight: bold;
      ">
      Conciliar
    </button>
  `;

  p.style.background = (Math.abs(dif) < 0.01) ? "#c7f7c7" : "#f7c7c7";

  const btnFloat = document.getElementById("btnConciliarFloat");
  if (btnFloat) {
    btnFloat.onclick = () => {
      if (typeof conciliar === 'function') return conciliar();
      const orig = document.getElementById("btnConciliar");
      if (orig) return orig.click();
      console.error("Ação de conciliar não encontrada.");
    };
  }
}

// ------------------------------------------------------------
// RENDERIZAÇÃO PRINCIPAL (BANCO / SISTEMA)
// ------------------------------------------------------------
function renderList() {
  const lb = document.getElementById("listaBanco");
  const ls = document.getElementById("listaSistema");

  const { bancoFiltered, sistemaFiltered } = applyFilters();

  const textoBanco = (document.getElementById("searchBanco")?.value || "").toLowerCase();
  const textoSistema = (document.getElementById("searchSistema")?.value || "").toLowerCase();

  const bancoFinal = bancoFiltered.filter(item => {
    if (!textoBanco) return true;
    return (
      String(Math.abs(item.amount)).includes(textoBanco)||
      String(item.desc || "").toLowerCase().includes(textoBanco) ||
      String(item.nf || "").toLowerCase().includes(textoBanco) ||
      String(item.doc || "").toLowerCase().includes(textoBanco) ||
      String(item.cliente || "").toLowerCase().includes(textoBanco)
    );
  });

  const sistemaFinal = sistemaFiltered.filter(item => {
    if (!textoSistema) return true;
    return (
      String(Math.abs(item.valor)).includes(textoSistema)||
      String(item.cliente || "").toLowerCase().includes(textoSistema) ||
      String(item.tipo || "").toLowerCase().includes(textoSistema) ||
      String(item.nf || "").toLowerCase().includes(textoSistema) ||
      String(item.doc || "").toLowerCase().includes(textoSistema)
    );
  });

  if (lb) lb.innerHTML = "";
  if (ls) ls.innerHTML = "";

  bancoFinal.forEach(item => {
    const div = document.createElement("div");
    div.className = "item";

    if (item.conciliado) div.classList.add("conciliated");
    if (selectedBanco.has(item.id)) div.classList.add("selected");

    const xBtn = item.conciliado 
      ? `<span style="position:absolute; top:6px; right:6px; cursor:pointer;color:red;font-weight:bold;"
           onclick="window.cancelarConciliacao('${safeIdForHtml(item.parChave||"")}')">×</span>`
      : "";

    div.innerHTML = `
      ${xBtn}

      <div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">

          <b style="color:${item.amount < 0 ? 'red' : '#000'};">
            ${formatMoney(item.amount)}
          </b>

          — ${item.date || '---'}

          <!-- BADGE DA FORMA DE PAGAMENTO -->
          <span style="
              padding:2px 6px;
              font-size:11px;
              border-radius:4px;
              background:${paymentColor[item.payment_type || "OUTRO"]};
              color:#fff;
          ">
            ${(item.payment_type || "OUTRO").toUpperCase()}
          </span>

          <!-- BADGE DO BANCO (AGORA NA MESMA LINHA) -->
          <span style="
              padding:2px 6px;
              font-size:11px;
              border-radius:6px;
              background:#f0f3f8;
              color:#024;
          ">
            ${(item.bankName || item.ofxFileName || '---').toUpperCase()}
          </span>

        </div>

        <div style="font-size:12px;color:#333;">
          ${item.desc || ''}
        </div>

        <div style="font-weight:600;margin-top:4px;">
          NF: ${item.nf || '---'}
        </div>

      </div>
    `;

    div.addEventListener("click", ev => {
      if (ev.target.tagName === "SPAN") return;
      if (item.conciliado) return;

      if (selectedBanco.has(item.id)) selectedBanco.delete(item.id);
      else selectedBanco.add(item.id);

      atualizarPainelDiferenca();
      renderList();
    });

    lb?.appendChild(div);
  });

  sistemaFinal.forEach(item => {
    const div = document.createElement("div");
    div.className = "item";

    if (item.conciliado) div.classList.add("conciliated");
    if (selectedSistema.has(item.id)) div.classList.add("selected");

    const xBtn = item.conciliado 
      ? `<span style="position:absolute; top:6px; right:6px; cursor:pointer;color:red;font-weight:bold;"
           onclick="window.cancelarConciliacao('${safeIdForHtml(item.parChave||"")}')">×</span>`
      : "";

    const semNF = !item.nf;
    const semStyle = semNF ? 'border-left:4px solid #dc3545; background:#fff5f5;' : '';

    div.innerHTML = `
      ${xBtn}

      <div style="${semStyle}">

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">

          <b style="color:${item.valor < 0 ? 'red' : '#000'};">
            R$ ${(item.valor < 0 ? '-' : '') + Math.abs(Number(item.valor || 0)).toFixed(2)}
          </b>

          — ${item.data || '---'}

          <!-- BADGE DA FORMA DE PAGAMENTO -->
          <span style="
              padding:2px 6px;
              font-size:11px;
              border-radius:4px;
              background:${paymentColor[getCategoriaSistema(item.tipo)]};
              color:#fff;
          ">
            ${(getCategoriaSistema(item.tipo) || 'OUTRO').toUpperCase()}
          </span>

          <!-- BADGE DO TIPO DO RELATÓRIO -->
          <span style="
              padding:2px 6px;
              font-size:11px;
              border-radius:6px;
              background:#f0f3f8;
              color:#024;
          ">
            ${(item.fileKind || '---').toUpperCase()}
          </span>

        </div>

        <div style="font-size:13px;margin-top:2px;color:#444;">
          ${item.cliente || '---'} — 
          ${item.tipo || '---'} — 
          ${item.doc || '---'}
        </div>

        <div style="
            font-size:14px;margin-top:2px;
            color:${item.nf ? '#444' : 'red'};
            font-weight:${item.nf ? 'normal' : 'bold'};
        ">
          NF ${item.nf || 'Inexistente'}
        </div>

      </div>
    `;

    div.addEventListener("click", ev => {
      if (ev.target.tagName === "SPAN") return;
      if (item.conciliado) return;

      if (selectedSistema.has(item.id)) selectedSistema.delete(item.id);
      else selectedSistema.add(item.id);

      atualizarPainelDiferenca();
      renderList();
    });

    ls?.appendChild(div);
  });

  atualizarPainelDiferenca();
  atualizarTotais();
}

// ------------------------------------------------------------
// CONCILIAR MANUAL
// ------------------------------------------------------------
function conciliar() {
  if (selectedBanco.size === 0 || selectedSistema.size === 0) {
    alert("Selecione pelo menos 1 item do banco e 1 do sistema.");
    return;
  }

  const chave = gerarChave();

  selectedBanco.forEach(idBanco => {
    const b = banco.find(x => x.id === idBanco);

    selectedSistema.forEach(idSistema => {
      const s = sistema.find(x => x.id === idSistema);
      if (b && s) {
        b.nf = s.nf;
        b.cliente = s.cliente;
        b.tipo = s.tipo || s.payment_type;
        b.doc = s.doc;
        b.dataSistema = s.data;

        b.conciliado = true;
        s.conciliado = true;

        b.parChave = chave;
        s.parChave = chave;
      }
    });
  });

  selectedBanco.clear();
  selectedSistema.clear();

  renderList();
  alert("Itens conciliados!");
}

// ------------------------------------------------------------
// EXPORTAR CSV
// ------------------------------------------------------------
function exportarCSV() {
  let csv = "DATA;CONCILIADO;VALOR;NF;DOC;CLIENTE;DESCRICAO;ARQUIVO\n";

  banco.forEach(b => {
    const linha = [
      b.date || "",
      b.conciliado ? "S" : "N",
      (b.amount != null) ? Number(b.amount).toFixed(2) : "",
      b.nf || "",
      b.doc || "",
      (b.cliente || "").replace(/;/g, ","),
      (b.desc || "").replace(/;/g, ","),
      b.ofxFileName || ""
    ];
    csv += linha.join(";") + "\n";
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `conciliado_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ------------------------------------------------------------
// SALVAR NO SERVIDOR (placeholder)
// ------------------------------------------------------------
async function saveStateToServer() {
  const state = {
    banco,
    sistema,
    arquivosOFX,
    arquivosSYS
  };

  localStorage.setItem("conciliacao_state", JSON.stringify(state));

  alert("Conciliação salva com sucesso.");
}

// ------------------------------------------------------------
// EVENTOS (DOMContentLoaded)
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const processBtn = document.getElementById("processBtn");
  const conciliarBtn = document.getElementById("btnConciliar");
  const aplicarFiltrosBtn = document.getElementById("aplicarFiltros");
  const btnExportarTopo = document.getElementById("btnExportarTopo");
  const btnSalvarTopo = document.getElementById("btnSalvarTopo");

  if (processBtn) {
    processBtn.addEventListener("click", async () => {
      selectedBanco.clear();
      selectedSistema.clear();

      const ofxInput = document.getElementById("ofxFiles");
      const ofxFiles = ofxInput ? Array.from(ofxInput.files) : [];
      for (const f of ofxFiles) {
        try {
          if (arquivosOFX.includes(normalizeFileName(f.name))) {
            alert("arquivo já importado");
            continue;
          }

          const txt = await f.text();
          const parsed = parseOFX(txt, f.name);
          banco.push(...parsed);

          arquivosOFX.push(normalizeFileName(f.name));

        } catch (e) {
          console.error("Erro NO OFX", f.name, e);
        }
      }

      const htmlInput = document.getElementById("htmlFile");
      const htmlFiles = htmlInput ? Array.from(htmlInput.files) : [];
      for (const hf of htmlFiles) {
        try {
          const nomeNormSys = normalizeFileName(hf.name);
          if (arquivosSYS.includes(nomeNormSys)) {
            alert("arquivo já importado");
            continue;
          }

          const htmlTxt = await hf.text();
          const parsedSys = parseMatricial(htmlTxt, hf.name);
          sistema.push(...parsedSys);

          arquivosSYS.push(nomeNormSys);

        } catch (e) {
          console.error("Erro no HTML", hf.name, e);
        }
      }

      banco.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      sistema.sort((a, b) => (a.data || "").localeCompare(b.data || ""));

      document.getElementById("ofxFiles").value = "";
      document.getElementById("htmlFile").value = "";

      renderArquivosImportados();
      renderList();
      atualizarTotais();
    });
  }

  if (conciliarBtn) conciliarBtn.addEventListener("click", conciliar);
  if (aplicarFiltrosBtn) aplicarFiltrosBtn.addEventListener("click", renderList);

  if (btnExportarTopo) {
    btnExportarTopo.addEventListener("click", () => {
      try { exportarCSV(); } catch (e) { console.error(e); }
    });
  } else {
    const fallback = document.getElementById("btnExportar");
    if (fallback) fallback.addEventListener("click", exportarCSV);
  }

  if (btnSalvarTopo) {
    btnSalvarTopo.addEventListener("click", () => {
      try { saveStateToServer(); } catch (e) { console.error(e); }
    });
  } else {
    const fallbackS = document.getElementById("btnSaveState");
    if (fallbackS) fallbackS.addEventListener("click", saveStateToServer);
  }

  const btnLimparTopo = document.getElementById("btnLimparTopo");
  if (btnLimparTopo) {
    btnLimparTopo.addEventListener("click", () => {
      if (!confirm("Deseja remover TODOS os dados salvos? Esta ação é irreversível.")) return;

      localStorage.removeItem("conciliacao_state");

      banco = [];
      sistema = [];
      arquivosOFX = [];
      arquivosSYS = [];
      selectedBanco.clear();
      selectedSistema.clear();

      const ofxInput = document.getElementById("ofxFiles");
      const htmlInput = document.getElementById("htmlFile");
      if (ofxInput) ofxInput.value = "";
      if (htmlInput) htmlInput.value = "";

      renderArquivosImportados();
      renderList();
      atualizarTotais();

      alert("Dados apagados.");
    });
  }

  // pesquisa dinâmica
  document.getElementById("searchBanco")?.addEventListener("input", renderList);
  document.getElementById("searchSistema")?.addEventListener("input", renderList);

  // Restaurar estado salvo, se existir
  const saved = localStorage.getItem("conciliacao_state");
  if (saved) {
    try {
      const data = JSON.parse(saved);

      banco = Array.isArray(data.banco) ? data.banco : [];
      sistema = Array.isArray(data.sistema) ? data.sistema : [];
      arquivosOFX = Array.isArray(data.arquivosOFX) ? data.arquivosOFX : [];
      arquivosSYS = Array.isArray(data.arquivosSYS) ? data.arquivosSYS : [];

      renderArquivosImportados();
      renderList();
      atualizarTotais();
    } catch(e) {
      console.error("Erro ao restaurar dados salvos", e);
    }
  }

  ensurePainelDiferenca();
});

