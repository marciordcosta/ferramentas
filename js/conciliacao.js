// ------------------------------------------------------------
// conciliacao.organizado.js
// ------------------------------------------------------------

// Estado global
let banco = [];
let sistema = [];
let selectedBanco = new Set();
let selectedSistema = new Set();
let registroManualEmEdicao = null;
let modoSelecaoAtivo = false;

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
  CHEQUE: '#ffa322ff',
  RENDIMENTO: '#ff7ccdff',
  OUTRO: '#999999'
};

// ------------------------------------------------------------
// UTILITÁRIOS
// ------------------------------------------------------------
function formatMoney(n) {
  if (n == null || n === "") return "R$ 0.00";
  return "R$ " + Number(n).toFixed(2);
}

function formatarContabil(n) {
  if (n == null || isNaN(n)) return "0,00";

  const v = Number(n).toFixed(2);     // 1234.56
  const partes = v.split(".");        // ["1234","56"]
  const inteiro = partes[0];
  const decimal = partes[1];

  const inteiroFormatado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return inteiroFormatado + "," + decimal;
}

function formatDateBR(iso) {
  if (!iso) return '---';
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;

  const [yyyy, mm, dd] = parts;
  return `${dd}/${mm}/${yyyy}`;
}

function safeIdForHtml(s) {
  return String(s || "").replace(/"/g, '&quot;').replace(/'/g, "\\'");
}

function gerarChave() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
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

function diffDiasUteis(dataSistema, dataOfx) {
  let d1 = new Date(dataSistema);
  let d2 = new Date(dataOfx);

  let sinal = 1;
  if (d1 > d2) {
    sinal = -1; // sistema depois do OFX
    [d1, d2] = [d2, d1];
  }

  let dias = 0;
  const cur = new Date(d1);

  while (cur < d2) {
    cur.setDate(cur.getDate() + 1);
    const dia = cur.getDay();
    if (dia !== 0 && dia !== 6) dias++;
  }

  return dias * sinal;
}


function normalizarNomeClienteOfx(str) {
  if (!str) return null;

  return removerAcentos(str)
    .toLowerCase()
    .replace(/\b(pix|transfer|transf|dinheiro|pagamento|compra|debito|credito|cartao|boleto|cobranca|ref|id)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nomesSemelhantesFortes(nomeOfx, nomeSys) {
  if (!nomeOfx || !nomeSys) return false;

  const a = nomeOfx.trim();
  const b = nomeSys.trim();

  // REGRA 1 — um contém o outro (nome quase completo)
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;

  const pa = a.split(" ");
  const pb = b.split(" ");

  if (pa.length === 0 || pb.length < 2) return false;

  const primeiroA = pa[0];
  const primeiroB = pb[0];

  // primeiro nome deve bater
  if (primeiroA !== primeiroB) return false;

  // OFX: "francisco l"
  if (pa.length === 2 && pa[1].length === 1) {
    const inicial = pa[1];
    const sobrenomeSys = pb[1];

    if (
      sobrenomeSys &&
      sobrenomeSys.length >= 5 &&
      sobrenomeSys.startsWith(inicial)
    ) {
      return true;
    }
  }

  // fallback: últimas 2 palavras com prefixo forte
  if (pa.length >= 2 && pb.length >= 2) {
    const caudaA = pa.slice(-2).join(" ");
    const caudaB = pb.slice(-2).join(" ");

    if (
      caudaA.length >= 6 &&
      caudaB.startsWith(caudaA.slice(0, 6))
    ) return true;

    if (
      caudaB.length >= 6 &&
      caudaA.startsWith(caudaB.slice(0, 6))
    ) return true;
  }

  return false;
}


//Filtro no POPUP
function filtrarPorDocumento(doc) {
  if (!doc) return;

  const input = document.getElementById("searchSistema");
  if (!input) return;

  input.value = doc;
  renderList();
}


function buscarSugestoes(itemBanco) {
  const nomeNormalizadoBase = normalizarNomeClienteOfx(itemBanco.desc);

  // FILTRO POR TIPO
  const tipoBanco = (itemBanco.payment_type || "").toUpperCase();

  const sistemaFiltradoPorTipo = sistema.filter(s => {
    const tipoSys = getCategoriaSistema(s.tipo || "").toUpperCase();
    if (tipoSys !== tipoBanco) return false;

    // ===== FILTRO DE ENTRADA / SAÍDA (PASSO ÚNICO) =====
    const vOfx = Number(itemBanco.amount || 0);
    const vSys = Number(s.valor || 0);

    if (vOfx < 0 && vSys >= 0) return false; // OFX saída → só saída
    if (vOfx > 0 && vSys <= 0) return false; // OFX entrada → só entrada
    // ==================================================

    return true;
  });


  const tipoOfx = (itemBanco.payment_type || "").toUpperCase();
  const valorOfxAbs = Math.abs(Number(itemBanco.amount || 0));
  const dataOfx = itemBanco.date || null;

  const resp = {
    mesmoValor: [],
    mesmaData: [],
    mesmoNome: [],
    combinacaoCartao: [],
    mesmoRemetente: []
  };

  // =====================================================
  // MESMA DESCRIÇÃO OFX (remetente igual)
  // =====================================================
  const nomeBase = normalizarNomeClienteOfx(itemBanco.desc);

  if (nomeBase && tipoOfx === "PIX") {
    const iguais = banco.filter(b => {
      if (b.id === itemBanco.id) return false;
      if ((b.payment_type || "").toUpperCase() !== "PIX") return false;

      const nomeB = normalizarNomeClienteOfx(b.desc);
      if (!nomeB) return false;

      // REGRA EXATA: nome normalizado tem que ser IGUAL
      return nomeB === nomeBase;
    });

    if (iguais.length > 0) {
      resp.mesmoRemetente = [itemBanco, ...iguais];
    }
  }


  //PIX — MESMO NOME NORMALIZADO NO SISTEMA (prioritário)
  if (tipoOfx === "PIX") {
    const nomeOfx = normalizarNomeClienteOfx(itemBanco.desc);

    if (nomeOfx) {
      resp.mesmoNome = sistemaFiltradoPorTipo.filter(s => {
        const nomeSys = removerAcentos(String(s.cliente || "").toLowerCase());
        if (!nomeSys) return false;

        return nomesSemelhantesFortes(nomeOfx, nomeSys);
      });
    }
  }

  // ------------------------------
  // CASO: NÃO É CARTÃO
  // ------------------------------
  if (tipoOfx !== "CARTAO") {

    // 1) MESMO VALOR
    const mesmoValorTodos = sistemaFiltradoPorTipo.filter(s => {
      const v = Math.abs(Number(s.valor || 0));
      return v === valorOfxAbs;
    });

    resp.mesmoValorMesmaData = mesmoValorTodos.filter(s =>
      dataOfx && s.data === dataOfx
    );

    resp.mesmoValorOutraData = mesmoValorTodos.filter(s =>
      !dataOfx || s.data !== dataOfx
    );

    //COMPARA NOME OFX COM SISTEMA
    resp.mesmoNome = sistemaFiltradoPorTipo.filter(s => {

      // ===== FILTRO POR SINAL (PASSO ÚNICO) =====
      const vSys = Number(s.valor || 0);
      const vOfx = Number(itemBanco.amount || 0);
      if (vOfx < 0 && vSys >= 0) return false; // OFX saída → só saída
      if (vOfx > 0 && vSys <= 0) return false; // OFX entrada → só entrada
      // =========================================

      const nomeOfx = normalizarNomeClienteOfx(itemBanco.desc);
      const nomeSys = removerAcentos(String(s.cliente || "").toLowerCase());

      if (!nomeOfx || !nomeSys) return false;

      const partesOfx = nomeOfx
        .split(" ")
        .filter(p => p.length >= 4);

      if (partesOfx.length < 2) return false;

      let comuns = 0;
      for (const p of partesOfx) {
        if (nomeSys.includes(p)) comuns++;
        if (comuns >= 2) return true;
      }

      return false;
    });

    return resp;
  }

  // ------------------------------
  // CASO: É BOLETO
  // ------------------------------
  if (tipoOfx === "BOLETO") {
    if (!dataOfx) return resp;

    const vOfx = Number(itemBanco.amount || 0);

    const itensDia = sistema.filter(s => {
      if (!s.data) return false;
      if (getCategoriaSistema(s.tipo) !== "BOLETO") return false;

      const vSys = Number(s.valor || 0);

      // ✔ respeita sinal (entrada / saída)
      if (vOfx > 0 && vSys <= 0) return false;
      if (vOfx < 0 && vSys >= 0) return false;

      if (s.data > dataOfx) return false;

      let dSys = new Date(s.data);
      let dOfx = new Date(dataOfx);

      let diasUteis = 0;
      const cur = new Date(dSys);

      while (cur < dOfx) {
        cur.setDate(cur.getDate() + 1);
        const dia = cur.getDay();
        if (dia !== 0 && dia !== 6) diasUteis++;
        if (diasUteis > 3) return false;
      }

      return true;
    });

    // ------------------------------
    // 1) VALOR EXATO (PRIORIDADE)
    // ------------------------------
    const valorExato = itensDia.filter(s =>
      Math.abs(Number(s.valor || 0)) === valorOfxAbs
    );

    if (valorExato.length > 0) {
      resp.mesmoValorMesmaData = valorExato;
      return resp;
    }

    // ------------------------------
    // 2) SOMA DE VALORES (MESMA DATA)
    // ------------------------------
    const porData = {};

    itensDia.forEach(s => {
      if (!porData[s.data]) porData[s.data] = [];
      porData[s.data].push(s);
    });

    for (const data in porData) {
      const lista = porData[data]
        .map(s => ({
          ref: s,
          valorAbs: Math.abs(Number(s.valor || 0))
        }))
        .sort((a, b) => b.valorAbs - a.valorAbs);

      function backtrack(i, soma, caminho) {
        if (soma === valorOfxAbs) return caminho;
        if (i >= lista.length || soma > valorOfxAbs) return null;

        const com = backtrack(
          i + 1,
          soma + lista[i].valorAbs,
          [...caminho, lista[i].ref]
        );
        if (com) return com;

        return backtrack(i + 1, soma, caminho);
      }

      const resultado = backtrack(0, 0, []);

      if (resultado) {
        resp.combinacaoCartao = resultado;
        return resp;
      }
    }

    return resp;
  }

  // ------------------------------
  // CASO: É CARTÃO
  // ------------------------------
  if (tipoOfx === "CARTAO") {
    if (!dataOfx) return resp;

    const subtipoOfx = getSubtipoCartaoOfx(itemBanco.desc);
    if (!subtipoOfx) return resp;

    let minPerc = 0;
    let maxPerc = 0;

    if (subtipoOfx === "DEBITO") {
      minPerc = 0.009; // 0,9%
      maxPerc = 0.03;  // 3,0%
    } else if (subtipoOfx === "CREDITO") {
      minPerc = 0.019; // 1,9%
      maxPerc = 0.05;  // 5,0%
    }

    const candidatos = sistemaFiltradoPorTipo.filter(s => {
      if (!s.data) return false;

      const subtipoSys = getSubtipoCartaoSistema(s.tipo);
      if (subtipoSys !== subtipoOfx) return false;

      // ❌ nunca depois do OFX
      if (s.data > dataOfx) return false;

      // até 2 dias úteis antes
      const diff = diffDiasUteis(s.data, dataOfx);
      if (diff > 2) return false;

      const vSys = Math.abs(Number(s.valor || 0));
      if (vSys < valorOfxAbs) return false;

      const perc = (vSys - valorOfxAbs) / vSys;
      if (perc < minPerc) return false;
      if (perc > maxPerc) return false;

      return true;
    });

    // mesma data primeiro
    resp.mesmoValorMesmaData = candidatos.filter(s =>
      s.data === dataOfx
    );

    if (resp.mesmoValorMesmaData.length > 0) {
      return resp;
    }

    // outras datas válidas
    resp.mesmoValorOutraData = candidatos.filter(s =>
      s.data !== dataOfx
    );

    return resp;
  }
}

function buscarSugestoesMultiplosBanco(itensBanco) {

  if (!itensBanco || itensBanco.length < 2) {
    return {
      mesmoValor: [],
      mesmaData: [],
      mesmoNome: [],
      combinacaoCartao: []
    };
  }

  // regra válida somente para PIX
  const tipo = (itensBanco[0].payment_type || "").toUpperCase();
  if (tipo !== "PIX") {
    return {
      mesmoValor: [],
      mesmaData: [],
      mesmoNome: [],
      combinacaoCartao: []
    };
  }

  // soma absoluta dos OFX
  const somaTotal = itensBanco.reduce(
    (t, b) => t + Math.abs(Number(b.amount || 0)),
    0
  );

  // sinal (entrada / saída)
  const sinalOfx = Math.sign(Number(itensBanco[0].amount || 0));

  // data base (primeiro OFX)
  const dataBase = itensBanco[0].date;

  // candidatos no sistema
  const candidatos = sistema.filter(s => {

    // tipo PIX
    if (getCategoriaSistema(s.tipo) !== "PIX") return false;

    // sinal compatível
    if (Math.sign(Number(s.valor || 0)) !== sinalOfx) return false;

    // valor exato (soma)
    const v = Math.abs(Number(s.valor || 0));
    if (v !== somaTotal) return false;

    return true;
  });

  // mesma data primeiro
  const mesmaData = candidatos.filter(s => s.data === dataBase);

  if (mesmaData.length > 0) {
    return {
      mesmoValorMesmaData: mesmaData,
      mesmoValorOutraData: [],
      mesmoNome: [],
      combinacaoCartao: []
    };
  }

  // fallback: outras datas
  return {
    mesmoValorMesmaData: [],
    mesmoValorOutraData: candidatos,
    mesmoNome: [],
    combinacaoCartao: []
  };
}


function mostrarPopupSugestoes(res) {
  const popup = document.getElementById("popupSugestoes");
  const body = document.getElementById("popupSugestoesBody");

  function bloco(titulo, lista) {
    if (!lista || lista.length === 0) return "";

    return `
      <div style="margin-top:8px;">
        <b>${titulo} (${lista.length})</b>
        <ul style="margin:6px 0 0 16px; padding:0;">
          ${lista.map(s => `
            <li style="
              margin-bottom:6px;
              padding:6px;
              border-radius:4px;
              background:${s.conciliado ? 'transparent' : 'transparent'};
              color:${s.conciliado ? '#5dff82' : '#ffffffff'};
            "
              onclick="filtrarPorDocumento('${safeIdForHtml(s.doc || "")}')"
            >
              <b>Data:</b> ${formatDateBR(s.data)}<br>
              <b>Valor:</b> R$ ${Math.abs(Number(s.valor || 0)).toFixed(2)}
              ${s.taxa_percentual ? ` (${getSubtipoCartaoSistema(s.tipo)} ${s.taxa_percentual.toFixed(2)}%)` : ``}<br>
              <b>Cliente:</b> ${s.cliente || "---"}<br>
              <b>DOC:</b> ${s.doc || "---"} — <b>NF:</b> ${s.nf || "---"}
            </li>
          `).join("")}
        </ul>
      </div>
    `;
  }

  let html = "";

  if (res.mesmoRemetente && res.mesmoRemetente.length > 1) {
    html += `
    <div style="margin-top:8px;">
      <b>${res.mesmoRemetente.length} registros do mesmo remetente (OFX)</b>
      <ul style="margin:6px 0 0 16px; padding:0;">
        ${res.mesmoRemetente.map(b => `
          <li style="
            margin-bottom:6px;
            padding:6px;
            border-radius:4px;
            background:${b.conciliado ? 'transparent' : 'transparent'};
            color:${b.conciliado ? '#5dff82' : '#ffffffff'};
          ">

            <b>Data:</b> ${formatDateBR(b.date)}<br>
            <b>Valor:</b> R$ ${Math.abs(Number(b.amount || 0)).toFixed(2)}
          </li>
        `).join("")}
      </ul>
    </div>
  `;
  }


  html += bloco("Mesmo valor e mesma data", res.mesmoValorMesmaData);
  html += bloco("Mesmo valor em outra data", res.mesmoValorOutraData);
  html += bloco("Nome Semelhante", res.mesmoNome);

  if (res.combinacaoCartao && res.combinacaoCartao.length > 0) {
    html += bloco("Combinação Cartão", res.combinacaoCartao);
  }

  if (!html.trim()) {
    html = `<i>Nenhuma sugestão encontrada.</i>`;
  }

  body.innerHTML = html;
  popup.style.display = "block";
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

function renderFiltroArquivosOFX() {
  const sel = document.getElementById("filterBanco");
  if (!sel) return;

  sel.innerHTML = `<option value="">Todos os arquivos</option>`;

  arquivosOFX.forEach(nome => {
    const opt = document.createElement("option");
    opt.value = nome;
    opt.textContent = nome;
    opt.style.color = "#777";

    sel.appendChild(opt);
  });
}

// ------------------------------------------------------------
// REMOVER ARQUIVOS (implementações centrais)
// ------------------------------------------------------------
function removerArquivoOFX(nome) {
  const nomeNorm = normalizeFileName(nome);

  // remove registros do banco vinculados ao arquivo
  banco = banco.filter(
    x => normalizeFileName(x.ofxFileName) !== nomeNorm
  );

  // remove do array de arquivos importados (nome REAL)
  arquivosOFX = arquivosOFX.filter(
    f => normalizeFileName(f) !== nomeNorm
  );

  // 🔑 RESETAR FILTRO SE APONTAR PARA O ARQUIVO REMOVIDO
  const sel = document.getElementById("filterBanco");
  if (sel && normalizeFileName(sel.value) === nomeNorm) {
    sel.value = "";
  }

  renderArquivosImportados();
  renderFiltroArquivosOFX();
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

// =====================
// TAG OFX — AUXILIAR (fallback / filtros antigos)
// =====================
function getCategoriaOfx(desc) {
  return detectPaymentTypeFromOfx(desc);
}

// =====================
// SUBTIPO CARTÃO (OFX)
// =====================
function getSubtipoCartaoOfx(desc) {
  if (!desc) return null;

  const t = removerAcentos(String(desc).toLowerCase());

  if (t.includes("debito")) return "DEBITO";
  if (t.includes("credito")) return "CREDITO";

  return null;
}


// =====================
// COR TAG OFX
// =====================
function getBolaOfx(desc) {
  const cat = detectPaymentTypeFromOfx(desc);
  return paymentColor[cat] || paymentColor.OUTRO;
}

// =====================
// TAG SISTEMA
// =====================
function getCategoriaSistema(tipo) {
  const s = removerAcentos(String(tipo || "").toLowerCase());

  // mantém compatibilidade com dados antigos do sistema
  if (
    s.includes("pix") ||
    s.includes("transf") ||
    s.includes("doc") ||
    s.includes("ted")
  ) return "PIX";

  if (s.includes("cheque")) return "CHEQUE";

  if (
    s.includes("cartao") ||
    s.includes("carto") ||
    s.includes("credito") ||
    s.includes("debito")
  ) return "CARTAO";

  if (s.includes("boleto") || s.includes("cobrana")) return "BOLETO";

  if (s.includes("rendimento") || s.includes("rende")) return "RENDIMENTO";

  return "OUTRO";
}

// =====================
// SUBTIPO CARTÃO (SISTEMA)
// =====================
function getSubtipoCartaoSistema(tipo) {
  if (!tipo) return null;

  const t = removerAcentos(String(tipo).toLowerCase());

  if (t.includes("dbi")) return "DEBITO";
  if (t.includes("crd")) return "CREDITO";

  return null;
}

// =====================
// COR TAG SISTEMA
// =====================
function getBolaSistema(tipo) {
  const cat = getCategoriaSistema(tipo);
  return paymentColor[cat] || paymentColor.OUTRO;
}

// =====================
// TAG OFX
// =====================
function detectPaymentTypeFromOfx(desc) {
  if (!desc) return 'OUTRO';
  const t = removerAcentos(String(desc).toLowerCase());

  // CARTÃO — mais específico primeiro
  if (
    t.includes("cartao") ||
    t.includes("carto") ||
    t.includes("credito") ||
    t.includes("debito")
  ) return "CARTAO";

  // BOLETO
  if (t.includes("boleto") || t.includes("cobrana"))
    return "BOLETO";

  // RENDIMENTO
  if (t.includes("rendimento") || t.includes("rende"))
    return "RENDIMENTO";

  // PIX (inclui transf / dinheiro)
  if (
    t.includes("pix") ||
    t.includes("dinheiro") ||
    t.includes("transf") ||
    t.includes("doc") ||
    t.includes("ted")
  ) return "PIX";

  // CHEQUE
  if (t.includes("cheque"))
    return "CHEQUE";

  return "OUTRO";
}


// ------------------------------------------------------------
// PARSER OFX
// ------------------------------------------------------------
function parseOFX(text, filename) {
  const items = [];
  const bankInfo = detectBankFromOfx(text, filename);
  text = text.replace(/\u0000/g, "")
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
      conciliado: false,
      desativado: false,
      marcado: false
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
  let paginaAtual = 0;

  let atual = null;
  const resultado = [];

  itens.forEach(it => {

    // DETECTA TEXTO "Página: X de Y"
    if (/^pagina:\s*\d+/i.test(it.text)) {
      paginaAtual++;
      // >>> FECHA QUALQUER REGISTRO ABERTO AO VIRAR A PÁGINA <<<
      if (atual && atual.valor !== null) {
        resultado.push(atual);
        atual = null;
      }
      return;
    }


    const key = paginaAtual + "_" + it.top;

    if (!linhas[key]) linhas[key] = [];
    linhas[key].push(it);
  });

  const COL_CLIENTE = [70, 140];
  const COL_DOC = [140, 200];
  const COL_VALOR = [200, 260];
  const COL_PAGTO = [480, 530];
  const COL_TIPO = [530, 600];
  const COL_VENDEDOR = [600, 700];
  const COL_NF = [720, 760];

  function inside(x, r) { return x >= r[0] && x <= r[1]; }

  const fname = String(filename || "").toLowerCase();

  // normaliza texto do arquivo e do HTML
  const normalizedHTML = removerAcentos(html.toLowerCase());
  const normalizedFile = removerAcentos(fname);

  // função de busca parcial
  function match(k) {
    return normalizedHTML.includes(k) || normalizedFile.includes(k);
  }

  // DETECÇÃO AUTOMÁTICA DE SAÍDA
  const isPagar =
    match("paga") ||      // pagamento, pagar, pagas, pagou, pagto
    match("saida") ||     // saida, saídas, saidas
    match("desp") ||      // despesa, despesas
    match("deb") ||      // debito, débito, debitado
    match("retir");       // retirada, retirar, retirado

  // rótulo final
  const fileKindLabel = isPagar ? "Saída" : "Entrada";

  let idx = 0;

  Object.keys(linhas).forEach(key => {
    let clienteLinha = null;
    let docLinha = null;

    const cols = linhas[key];

    cols.forEach(c => {
      const txt = c.text;

      // NOVO LANÇAMENTO: detectado pelo VALOR
      if (inside(c.left, COL_VALOR) && /\d+[\.,]\d{2}/.test(txt)) {

        // fecha o anterior
        if (atual && atual.valor !== null) {
          resultado.push(atual);
        }

        // inicia novo lançamento
        atual = {
          id: `${filename || 'SIST'}_${idx++}`,
          systemFileName: filename || '',
          fileKind: fileKindLabel,
          cliente: clienteLinha,
          doc: docLinha,
          valor: (isPagar ? -1 : 1) * parseFloat(txt.replace(/\./g, "").replace(/,/g, ".")),
          data: null,
          nf: null,
          vendedor: null,
          tipo: null,
          conciliado: false,
          desativado: false
        };

        return;
      }

      if (!atual) return;

      if (inside(c.left, COL_CLIENTE)) clienteLinha = removerAcentos(txt);
      else if (inside(c.left, COL_DOC)) docLinha = txt.trim();
      else if (inside(c.left, COL_PAGTO) && /^\d{2}\/\d{2}\/\d{4}$/.test(txt)) {
        const [d, m, y] = txt.split("/");
        atual.data = `${y}-${m}-${d}`;
      }
      else if (inside(c.left, COL_TIPO)) atual.tipo = removerAcentos(txt);
      else if (inside(c.left, COL_VENDEDOR)) atual.vendedor = removerAcentos(txt);
      else if (inside(c.left, COL_NF) && atual.nf === null) {
        const nfLimpa = txt.replace(/\D/g, "");
        if (nfLimpa) {
          atual.nf = nfLimpa;
        }
      }
    });
  });

  // fecha o último lançamento
  if (atual && atual.valor !== null) {
    resultado.push(atual);
  }

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
    kind: document.getElementById('filterKind')?.value || '',
    conciliado: document.getElementById('filterConciliado')?.value || ''
  };
}

function applyFilters() {
  const f = getFilterValues();

  const bancoFiltered = banco.filter(b => {
    if (f.bank && normalizeFileName(b.ofxFileName) !== normalizeFileName(f.bank)) {
      return false;
    }

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

    if (f.conciliado === "sim" && !b.conciliado) return false;
    if (f.conciliado === "nao" && b.conciliado) return false;
    if (f.conciliado === "marcados" && !b.marcado) return false;

    return true;
  });

  const sistemaFiltered = sistema.filter(s => {
    if (f.kind === "receber") {
      if (Number(s.valor) < 0) return false;
    }
    if (f.kind === "pagar") {
      if (Number(s.valor) >= 0) return false;
    }

    if (f.conciliado === "sim" && !s.conciliado) return false;
    if (f.conciliado === "nao" && s.conciliado) return false;

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
  document.getElementById("filterConciliado").value = "";

  renderList();
  atualizarTotais();
});

// ------------------------------------------------------------
// TOTALIZADORES
// ------------------------------------------------------------
function calcTotals(list, isSistema = false) {
  const totals = { count: 0, entradas: 0, saidas: 0 };

  list.forEach(it => {
    if (it.desativado) return;

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
  document.getElementById('t_ofx_in').textContent = formatarContabil(tOfx.entradas);
  document.getElementById('t_ofx_out').textContent = formatarContabil(Math.abs(tOfx.saidas));

  const saldoOfx = tOfx.entradas + tOfx.saidas;
  document.getElementById('t_ofx_saldo').textContent = formatarContabil(saldoOfx);
  const elOfxSaldo = document.getElementById("t_ofx_saldo");
  elOfxSaldo.style.color = saldoOfx > 0 ? "green" :
    saldoOfx < 0 ? "red" : "#333";


  // SISTEMA
  document.getElementById('t_sys_regs').textContent = tSys.count;
  document.getElementById('t_sys_in').textContent = formatarContabil(tSys.entradas);
  document.getElementById('t_sys_out').textContent = formatarContabil(Math.abs(tSys.saidas));

  const saldoSys = tSys.entradas + tSys.saidas;
  document.getElementById('t_sys_saldo').textContent = formatarContabil(saldoSys);
  const elSysSaldo = document.getElementById("t_sys_saldo");
  elSysSaldo.style.color = saldoSys > 0 ? "green" :
    saldoSys < 0 ? "red" : "#333";

}

// ------------------------------------------------------------
// CONCILIAÇÃO / CANCELAR
// ------------------------------------------------------------
function cancelarConciliacao(chave) {
  if (!chave) return;

  // remover conciliação dos itens de banco e coletar FAKEs para excluir
  let idsFakeParaRemover = [];

  banco.forEach(b => {
    if (b.parChave === chave) {

      // se for item manual FAKE_, marcar para exclusão
      if (String(b.id).startsWith("FAKE_")) {
        idsFakeParaRemover.push(b.id);
      }

      b.conciliado = false;
      delete b.parChave;
      delete b.nfs;
      delete b.nf;
      delete b.cliente;
      delete b.doc;
      delete b.tipo;
      delete b.dataSistema;
    }
  });

  // remover os FAKEs do array banco
  if (idsFakeParaRemover.length > 0) {
    banco = banco.filter(b => !idsFakeParaRemover.includes(b.id));
  }

  // remover conciliação do sistema
  let taxaParaReverter = 0;

  sistema.forEach(s => {
    if (s.parChave === chave) {
      if (s.taxa_valor > 0) {
        taxaParaReverter += s.taxa_valor;
      }

      s.conciliado = false;
      delete s.parChave;
    }
  });

  // ===== REVERTER TAXA CARTÃO =====
  if (taxaParaReverter > 0) {
    const regTaxa = sistema.find(x => x.id === "AUTO_TAXA_CARTAO");
    if (regTaxa) {
      regTaxa.valor = +(Number(regTaxa.valor || 0) + taxaParaReverter).toFixed(2);
    }
  }

  renderList();
  atualizarTotais();
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

function contarOfxNaoConciliados() {
  let total = 0;

  banco.forEach(b => {
    if (b.desativado) return;
    if (b.conciliado) return;
    total++;
  });

  return total;
}


function atualizarPainelDiferenca() {
  const p = ensurePainelDiferenca();
  const totalOfxNaoConciliados = contarOfxNaoConciliados();

  const somaBanco = banco
    .filter(x => selectedBanco.has(x.id) && !x.desativado)
    .reduce((t, x) => t + (Number(x.amount) || 0), 0);

  const somaSistema = sistema
    .filter(x => selectedSistema.has(x.id) && !x.desativado)
    .reduce((t, x) => t + (Number(x.valor) || 0), 0);

  const dif = somaBanco - somaSistema;

  // calcular percentual SOMENTE quando o tipo do banco for CARTAO
  let percStr = "";
  const itemBanco = banco.find(x => selectedBanco.has(x.id));

  if (itemBanco && (itemBanco.payment_type || "").toUpperCase() === "CARTAO") {

    if (somaSistema === 0) {
      // evita Infinity – mostra apenas "(%)"
      percStr = ` <span style="font-size:12px; color:#555;">(%)</span>`;
    } else {
      const perc = (dif / somaSistema) * 100;
      percStr = ` <span style="font-size:12px; color:#555;">(${perc.toFixed(2)}%)</span>`;
    }
  }

  p.innerHTML = `
  <div style="font-size:18px; font-weight:bold; margin-bottom:6px;">
    Diferença:
    <span style="color:${Math.abs(dif) < 0.01 ? 'green' : 'red'};">
      R$ ${dif.toFixed(2)}
    </span> ${percStr}
  </div>

  <div style="font-size:14px; font-weight:normal; margin-top:4px;">
    <b>Banco (${selectedBanco.size}):</b> R$ ${somaBanco.toFixed(2)}
  </div>

  <div style="font-size:14px; font-weight:normal; margin-bottom:15px;">
    <b>Sistema (${selectedSistema.size}):</b> R$ ${somaSistema.toFixed(2)}
    <div style="font-size:11px; color:#666; margin-top:2px;">
      ${totalOfxNaoConciliados} Não conciliados
    </div>
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
// DESATIVAR / REATIVAR REGISTRO
// ------------------------------------------------------------
function toggleDesativado(item) {
  item.desativado = !item.desativado;   // alterna estado

  // remove seleções para evitar inconsistências
  selectedBanco.delete(item.id);
  selectedSistema.delete(item.id);

  renderList();
  atualizarTotais();
}

function toggleDesativadoSelecionadosOuUm(item) {
  let alvos = [];

  if (modoSelecaoAtivo) {
    if (banco.includes(item)) {
      alvos = banco.filter(b => selectedBanco.has(b.id));
    } else {
      alvos = sistema.filter(s => selectedSistema.has(s.id));
    }
  }

  // fallback: só o item clicado
  if (alvos.length === 0) {
    alvos = [item];
  }

  alvos.forEach(it => {
    it.desativado = !it.desativado;
    selectedBanco.delete(it.id);
    selectedSistema.delete(it.id);
  });

  renderList();
  atualizarTotais();
}


// ------------------------------------------------------------
// CONCILIAR MANUAL (apenas Sistema -> cria OFX falso)
// ------------------------------------------------------------
function conciliarManualSistema(itemSistema) {
  if (!itemSistema) return;

  // impedir duplicações múltiplas
  if (itemSistema.conciliado) {
    alert("Este item já está conciliado.");
    return;
  }

  // chave única igual às conciliações normais
  const chave = gerarChave();

  // cria OFX falso com os mesmos dados do sistema
  const fake = {
    id: "FAKE_" + gerarChave(),
    ofxFileName: "MANUAL",
    bank: "999",
    bankName: "Manual",
    date: itemSistema.data || "1900-01-01",
    amount: Number(itemSistema.valor || 0),

    // descrição combinada
    desc: `${itemSistema.cliente || ''} — ${itemSistema.tipo || ''} — ${itemSistema.doc || ''}`.trim(),

    // categoria usando lógica do OFX
    payment_type: getCategoriaOfx(itemSistema.tipo || itemSistema.cliente || ""),

    conciliado: true,
    desativado: false,
    parChave: chave,

    nf: itemSistema.nf || "",
    cliente: itemSistema.cliente || "",
    tipo: itemSistema.tipo || "",
    doc: itemSistema.doc || "",
    dataSistema: itemSistema.data || ""
  };


  // marcar o item do sistema como conciliado
  itemSistema.conciliado = true;
  itemSistema.parChave = chave;

  // joga o item manual no array de banco
  banco.push(fake);

  // re-renderizar
  renderList();
  atualizarTotais();
}

function editarRegistroManual(item) {
  if (!item) return;

  registroManualEmEdicao = item;

  document.getElementById("m_data").value = item.data || "";
  document.getElementById("m_valor").value = Math.abs(Number(item.valor || 0));
  document.getElementById("m_cliente").value = item.cliente || "";
  document.getElementById("m_nf").value = item.nf || "";

  document.getElementById("modalAddManual").style.display = "flex";
}


window.conciliarManualSistema = conciliarManualSistema;

// controle do menu de contexto
let ctxTarget = null;
const ctxMenu = document.getElementById("ctxMenu");

// fechar menu ao clicar fora
document.addEventListener("click", () => {
  ctxMenu.style.display = "none";
});

// ação do botão "Conciliar manual"
document.getElementById("ctxConcManual").addEventListener("click", () => {
  if (!ctxTarget) return;

  // só permite conciliar manual itens do sistema
  if (sistema.includes(ctxTarget)) {
    conciliarManualSistema(ctxTarget);
  } else {
    alert("Conciliação manual só pode ser usada em registros do Sistema.");
  }

  ctxMenu.style.display = "none";
});


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

    const termo = textoBanco;

    const valorExibido = Math.abs(Number(item.amount || 0)).toFixed(2);
    const dataExibida = formatDateBR(item.date);

    return (
      valorExibido.includes(termo) ||
      dataExibida.includes(termo) ||
      String(item.desc || "").toLowerCase().includes(termo) ||
      String(item.nf || "").toLowerCase().includes(termo) ||
      String(item.doc || "").toLowerCase().includes(termo) ||
      String(item.cliente || "").toLowerCase().includes(termo)
    );
  });

  const sistemaFinal = sistemaFiltered.filter(item => {

    if (!textoSistema) return true;

    const termo = textoSistema.toLowerCase();
    const valorExibido = Math.abs(Number(item.valor || 0)).toFixed(2);
    const dataExibida = formatDateBR(item.data);

    return (
      valorExibido.includes(termo) ||
      dataExibida.includes(termo) ||
      String(item.cliente || "").toLowerCase().includes(termo) ||
      String(item.tipo || "").toLowerCase().includes(termo) ||
      String(item.nf || "").toLowerCase().includes(termo) ||
      String(item.doc || "").toLowerCase().includes(termo)
    );
  });

  if (lb) lb.innerHTML = "";
  if (ls) ls.innerHTML = "";

  bancoFinal.forEach(item => {
    const div = document.createElement("div");
    div.className = "item";

    if (item.conciliado) div.classList.add("conciliated");
    if (selectedBanco.has(item.id)) div.classList.add("selected");
    if (item.desativado) div.classList.add("desativado");

    const xBtn = item.conciliado
      ? `<span style="position:absolute; top:6px; right:6px; cursor:pointer;color:red;font-weight:bold;"
           onclick="window.cancelarConciliacao('${safeIdForHtml(item.parChave || "")}')">×</span>`
      : "";

    div.innerHTML = `
      ${xBtn}

      <div>

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">

          <b style="color:${item.amount < 0 ? 'red' : '#000'};">
            R$ ${formatarContabil(item.amount)}
          </b>

          — ${formatDateBR(item.date)}

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

          ${String(item.id).startsWith("FAKE_") ? `
            <span style="
              padding:2px 6px;
              font-size:11px;
              border-radius:6px;
              background:#ffcc00;
              color:#000;
              font-weight:bold;
            ">
              MANUAL
            </span>` : ``}

          ${item.marcado ? `
            <span style="
              padding:2px 6px;
              font-size:11px;
              border-radius:6px;
              background:#ff9800;
              color:#000;
              font-weight:bold;
            ">
              MARCADO
            </span>
          ` : ``}

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
      // permite abrir popup mesmo conciliado (somente visualização)
      if (item.conciliado) {
        const res = buscarSugestoes(item);
        mostrarPopupSugestoes(res);
        return;
      }

      // =========================
      // RECLIQUE → DESSELECIONA
      // =========================
      if (selectedBanco.has(item.id)) {
        selectedBanco.delete(item.id);
        div.classList.remove("selected");

        const selecionados = banco.filter(b => selectedBanco.has(b.id));

        if (selecionados.length === 0) {
          // nenhuma seleção → fecha popup
          const popup = document.getElementById("popupSugestoes");
          if (popup) popup.style.display = "none";
        } else {
          // ainda há seleção → recalcula popup
          const res = selecionados.length === 1
            ? buscarSugestoes(selecionados[0])
            : buscarSugestoesMultiplosBanco(selecionados);

          mostrarPopupSugestoes(res);
        }

        atualizarPainelDiferenca();
        return;
      }

      // =========================
      // MODO SELEÇÃO ATIVO
      // =========================
      if (modoSelecaoAtivo) {
        selectedBanco.add(item.id);
        div.classList.add("selected");

        const selecionados = banco.filter(b => selectedBanco.has(b.id));

        if (selecionados.length > 0) {
          const res = selecionados.length === 1
            ? buscarSugestoes(selecionados[0])
            : buscarSugestoesMultiplosBanco(selecionados);

          mostrarPopupSugestoes(res);
        }

        atualizarPainelDiferenca();
        return;
      }

      // =========================
      // MODO NORMAL (troca)
      // =========================
      selectedBanco.clear();

      // limpa visual anterior
      document
        .querySelectorAll("#listaBanco .item.selected")
        .forEach(el => el.classList.remove("selected"));

      selectedBanco.add(item.id);
      div.classList.add("selected");

      const res = buscarSugestoes(item);
      mostrarPopupSugestoes(res);

      atualizarPainelDiferenca();
    });


    div.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      ev.stopPropagation();

      ctxTarget = item;


      // ===============================
      // MENU DE CONTEXTO — SELEÇÃO / DESATIVAR
      // ===============================

      ctxMenu.innerHTML = `
        ${!modoSelecaoAtivo ? `
          <div id="ctxSel" style="padding:8px 12px; cursor:pointer;">
            Abrir seleção
          </div>
        ` : `
          <div id="ctxClearSel" style="padding:8px 12px; cursor:pointer;">
            Limpar seleção
          </div>
        `}

        <div id="ctxMarcar" style="padding:8px 12px; cursor:pointer; border-top:1px solid #ddd;">
          ${item.marcado ? "Desmarcar" : "Marcar"}
        </div>

        <div id="ctxToggle" style="padding:8px 12px; cursor:pointer; border-top:1px solid #ddd;">
          ${item.desativado ? "Reativar" : "Desativar"}
        </div>
      `;

      ctxMenu.style.left = ev.pageX + "px";
      ctxMenu.style.top = ev.pageY + "px";
      ctxMenu.style.display = "block";

      // -------------------------------
      // DESMARCAR / MARCAR
      // -------------------------------
      document.getElementById("ctxMarcar").onclick = () => {
        item.marcado = !item.marcado;
        renderList();
        ctxMenu.style.display = "none";
      };

      // -------------------------------
      // DESATIVAR / REATIVAR
      // -------------------------------
      document.getElementById("ctxToggle").onclick = () => {
        toggleDesativadoSelecionadosOuUm(item);
        ctxMenu.style.display = "none";
      };

      // -------------------------------
      // ABRIR MODO SELEÇÃO
      // -------------------------------
      if (!modoSelecaoAtivo) {
        document.getElementById("ctxSel").onclick = () => {
          modoSelecaoAtivo = true;

          // inicia seleção com o item clicado
          if (banco.includes(item)) {
            selectedBanco.add(item.id);
          } else {
            selectedSistema.add(item.id);
          }

          renderList();
          atualizarPainelDiferenca();
          ctxMenu.style.display = "none";
        };
      }

      // -------------------------------
      // LIMPAR SELEÇÃO
      // -------------------------------
      if (modoSelecaoAtivo) {
        document.getElementById("ctxClearSel").onclick = () => {
          modoSelecaoAtivo = false;
          selectedBanco.clear();
          selectedSistema.clear();

          renderList();
          atualizarPainelDiferenca();
          ctxMenu.style.display = "none";
        };
      }

    });


    lb?.appendChild(div);
  });

  sistemaFinal.forEach(item => {
    const div = document.createElement("div");
    div.className = "item";

    if (item.conciliado) div.classList.add("conciliated");
    if (selectedSistema.has(item.id)) div.classList.add("selected");
    if (item.desativado) div.classList.add("desativado");

    const xBtn = item.conciliado
      ? `<span style="position:absolute; top:6px; right:6px; cursor:pointer;color:red;font-weight:bold;"
           onclick="window.cancelarConciliacao('${safeIdForHtml(item.parChave || "")}')">×</span>`
      : "";

    const semNF = !item.nf;
    const semStyle = semNF ? 'border-left:4px solid #dc3545; background:#fff5f5;' : '';

    let percTotalTaxa = "";

    if (item.id === "AUTO_TAXA_CARTAO") {
      const totalBrutoCartao = sistema
        .filter(s =>
          s.conciliado &&
          getCategoriaSistema(s.tipo) === "CARTAO" &&
          s.taxa_valor > 0
        )
        .reduce((t, s) => t + Math.abs(Number(s.valor || 0)), 0);

      if (totalBrutoCartao > 0) {
        const perc = (Math.abs(item.valor) / totalBrutoCartao) * 100;
        percTotalTaxa = ` (${perc.toFixed(2)}%)`;
      }
    }

    div.innerHTML = `
      ${xBtn}

      <div style="${semStyle}">

        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">

          <b style="color:${item.valor < 0 ? 'red' : '#000'};">
            R$ ${(item.valor < 0 ? '-' : '') + Math.abs(Number(item.valor || 0)).toFixed(2)}${percTotalTaxa}
            ${item.taxa_valor > 0 ? `
              <span style="font-size:11px; color:#666; margin-left:6px;">
                (−R$ ${item.taxa_valor.toFixed(2)} | ${item.taxa_percentual.toFixed(2)}%)
              </span>
        ` : ``}
          </b>

          — ${formatDateBR(item.data)}

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

      // =========================
      // RECLIQUE → DESSELECIONA
      // =========================
      if (selectedSistema.has(item.id)) {
        selectedSistema.delete(item.id);
        div.classList.remove("selected");
        atualizarPainelDiferenca();
        return;
      }

      // =========================
      // MODO SELEÇÃO ATIVO
      // =========================
      if (modoSelecaoAtivo) {
        selectedSistema.add(item.id);
        div.classList.add("selected");

        atualizarPainelDiferenca();
        return;
      }

      // =========================
      // MODO NORMAL (troca)
      // =========================
      selectedSistema.clear();

      document
        .querySelectorAll("#listaSistema .item.selected")
        .forEach(el => el.classList.remove("selected"));

      selectedSistema.add(item.id);
      div.classList.add("selected");

      atualizarPainelDiferenca();
    });


    div.addEventListener("contextmenu", ev => {
      ev.preventDefault();
      ev.stopPropagation();

      ctxTarget = item;

      const isManual = item.systemFileName === "manual";

      // ===============================
      // MENU DE CONTEXTO — SELEÇÃO / DESATIVAR
      // ===============================

      ctxMenu.innerHTML = `
      ${!modoSelecaoAtivo ? `
        <div id="ctxSel" style="padding:8px 12px; cursor:pointer;">
          Abrir seleção
        </div>
      ` : `
        <div id="ctxClearSel" style="padding:8px 12px; cursor:pointer;">
          Limpar seleção
        </div>
      `}

        <div id="ctxToggle" style="padding:8px 12px; cursor:pointer; border-top:1px solid #ddd;">
          ${item.desativado ? "Reativar" : "Desativar"}
        </div>

        <div
          id="ctxEditar"
            style="padding:8px 12px; cursor:pointer; border-top:1px solid #ddd;"
              onclick="editarRegistroManual(ctxTarget); document.getElementById('ctxMenu').style.display='none';"
            >
          Editar registro
        </div>

        ${item.systemFileName !== "manual" ? `
          <div id="ctxManual" style="padding:8px 12px; cursor:pointer; border-top:1px solid #ddd;">
            Conciliar manual (Sistema → OFX)
          </div>
        ` : `
          <div id="ctxExcluir" style="padding:8px 12px; cursor:pointer; border-top:1px solid #ddd;">
            Excluir registro
          </div>
        `}
      `;

      if (!modoSelecaoAtivo) {
        document.getElementById("ctxSel").onclick = () => {
          modoSelecaoAtivo = true;
          selectedSistema.add(item.id);

          // FEEDBACK VISUAL
          div.classList.add("selected");

          atualizarPainelDiferenca();
          ctxMenu.style.display = "none";
        };
      }

      // -------------------------------
      // LIMPAR SELEÇÃO
      // -------------------------------
      if (modoSelecaoAtivo) {
        document.getElementById("ctxClearSel").onclick = () => {
          modoSelecaoAtivo = false;

          selectedBanco.clear();
          selectedSistema.clear();

          // limpa visual imediatamente
          document
            .querySelectorAll(".item.selected")
            .forEach(el => el.classList.remove("selected"));

          atualizarPainelDiferenca();
          ctxMenu.style.display = "none";
        };
      }

      ctxMenu.style.left = ev.pageX + "px";
      ctxMenu.style.top = ev.pageY + "px";
      ctxMenu.style.display = "block";

      document.getElementById("ctxToggle").onclick = () => {
        toggleDesativadoSelecionadosOuUm(item);
        ctxMenu.style.display = "none";
      };

      if (!isManual) {
        document.getElementById("ctxManual").onclick = () => {
          conciliarManualSistema(item);
          ctxMenu.style.display = "none";
        };
      }

      if (isManual) {
        document.getElementById("ctxExcluir").onclick = () => {
          const idx = sistema.findIndex(s => s.id === item.id);
          if (idx > -1) {
            sistema.splice(idx, 1);
            renderList();
            atualizarTotais();
            alert("Registro manual excluído.");
          }
          ctxMenu.style.display = "none";
        };
      }
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

  // bloquear conciliação de itens desativados
  for (const id of selectedBanco) {
    const b = banco.find(x => x.id === id);
    if (b?.desativado) {
      alert("Há itens desativados selecionados no banco.");
      return;
    }
  }

  for (const id of selectedSistema) {
    const s = sistema.find(x => x.id === id);
    if (s?.desativado) {
      alert("Há itens desativados selecionados no sistema.");
      return;
    }
  }

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
        if (!b.nfs) b.nfs = [];

        if (s.nf && !b.nfs.includes(s.nf)) {
          b.nfs.push(s.nf);
        }

        b.nf = b.nfs.join(", ");
        b.cliente = s.cliente;
        b.tipo = s.tipo || s.payment_type;
        b.doc = s.doc;
        b.dataSistema = s.data;

        // ===== TAXA CARTÃO (SISTEMA) =====
        if ((b.payment_type || "").toUpperCase() === "CARTAO") {
          const valorOfx = Math.abs(Number(b.amount || 0));
          const valorSys = Math.abs(Number(s.valor || 0));

          if (valorSys > 0 && valorSys >= valorOfx) {
            s.taxa_valor = +(valorSys - valorOfx).toFixed(2);
            s.taxa_percentual = +((s.taxa_valor / valorSys) * 100).toFixed(2);
          } else {
            s.taxa_valor = 0;
            s.taxa_percentual = 0;
          }
        }

        // ===== ACUMULADOR AUTOMÁTICO DE TAXA DE CARTÃO =====
        if ((b.payment_type || "").toUpperCase() === "CARTAO" && s.taxa_valor > 0) {

          let regTaxa = sistema.find(x => x.id === "AUTO_TAXA_CARTAO");

          if (!regTaxa) {
            regTaxa = {
              id: "AUTO_TAXA_CARTAO",
              systemFileName: "automatico",
              fileKind: "Saída",
              tipo: "Taxa Cartão",
              cliente: "Administradora de Cartão",
              doc: "TAXA_CARTAO",
              nf: "",
              data: s.data || b.date || new Date().toISOString().slice(0, 10),
              valor: -s.taxa_valor,
              conciliado: true,
              desativado: false
            };
            sistema.push(regTaxa);
          } else {
            regTaxa.valor = +(Number(regTaxa.valor || 0) - s.taxa_valor).toFixed(2);
          }
        }

        b.conciliado = true;
        b.marcado = false;
        s.conciliado = true;

        b.parChave = chave;
        s.parChave = chave;
      }
    });
  });

  selectedBanco.clear();
  selectedSistema.clear();
  modoSelecaoAtivo = false;

  renderList();
  alert("Itens conciliados!");

  // fechar popup de sugestões após conciliar
  const popup = document.getElementById("popupSugestoes");
  if (popup) popup.style.display = "none";
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
  a.download = `conciliado_${new Date().toISOString().slice(0, 10)}.csv`;
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

  document.getElementById("popupSugestoesClose").onclick = () => {
    document.getElementById("popupSugestoes").style.display = "none";
  };

  // ------------------------------
  // BOTÃO + → ABRIR MODAL MANUAL
  // ------------------------------
  const modalAddManual = document.getElementById("modalAddManual");

  document.getElementById("btnAddManual")?.addEventListener("click", () => {
    modalAddManual.style.display = "flex";
  });

  document.getElementById("btnCancelarManual")?.addEventListener("click", () => {
    registroManualEmEdicao = null;
    modalAddManual.style.display = "none";
  });

  // ------------------------------------
  // MODAL ARRASTÁVEL (APENAS A CAIXA)
  // ------------------------------------
  (function () {
    const modal = document.getElementById("modalAddManual");
    const box = modal.querySelector(".modal-box");

    let dragging = false;
    let startX = 0, startY = 0;
    let origX = 0, origY = 0;

    box.addEventListener("mousedown", e => {
      dragging = true;

      const rect = box.getBoundingClientRect();

      origX = rect.left;
      origY = rect.top;

      startX = e.clientX;
      startY = e.clientY;

      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", e => {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      box.style.position = "fixed";
      box.style.left = (origX + dx) + "px";
      box.style.top = (origY + dy) + "px";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
      document.body.style.userSelect = "";
    });
  })();


  document.getElementById("btnSalvarManual")?.addEventListener("click", () => {

    const data = document.getElementById("m_data").value;
    const valor = parseFloat(document.getElementById("m_valor").value || "0");
    const cliente = document.getElementById("m_cliente").value.trim();
    const nf = document.getElementById("m_nf").value.trim();

    if (!data || !valor || !cliente) {
      alert("Preencha Data, Valor e Cliente.");
      return;
    }

    // ===== MODO EDIÇÃO =====
    if (registroManualEmEdicao) {
      registroManualEmEdicao.data = data;
      registroManualEmEdicao.valor = valor;
      registroManualEmEdicao.cliente = cliente;
      registroManualEmEdicao.nf = nf;

      registroManualEmEdicao = null;
    }
    // ===== MODO NOVO =====
    else {
      sistema.push({
        id: "manual_" + Date.now() + "_" + Math.floor(Math.random() * 99999),
        data,
        valor,
        cliente,
        nf,
        tipo: "Outros",
        conciliado: false,
        desativado: false,
        fileKind: "manual",
        systemFileName: "manual"
      });
    }

    document.getElementById("modalAddManual").style.display = "none";

    document.getElementById("m_data").value = "";
    document.getElementById("m_valor").value = "";
    document.getElementById("m_cliente").value = "";
    document.getElementById("m_nf").value = "";

    renderList();
    atualizarTotais();

    alert("Registro adicionado com sucesso.");
  });



  if (processBtn) {
    processBtn.addEventListener("click", async () => {
      selectedBanco.clear();
      selectedSistema.clear();

      const ofxInput = document.getElementById("ofxFiles");
      const ofxFiles = ofxInput ? Array.from(ofxInput.files) : [];

      // contador total adicionado nesta operação
      let totalAdicionadosNestaOperacao = 0;

      // --- OFX: processa e filtra duplicados (OFX vs OFX) ---
      for (const f of ofxFiles) {
        try {
          const nomeNorm = normalizeFileName(f.name);
          if (arquivosOFX.includes(nomeNorm)) {
            alert("arquivo já importado");
            continue;
          }

          const txt = await f.text();
          const parsed = parseOFX(txt, f.name);

          let adicionadosPorArquivo = 0;

          // Filtrar duplicados (comparação literal usando os campos normalizados existentes)
          for (const item of parsed) {
            const ehDuplicado = banco.some(b => {
              return (b.date || "") === (item.date || "") &&
                Number(b.amount || 0) === Number(item.amount || 0) &&
                (b.desc || "") === (item.desc || "") &&
                (b.payment_type || "") === (item.payment_type || "") &&
                (b.bank || "") === (item.bank || "") &&
                (b.bankName || "") === (item.bankName || "");
            });

            if (!ehDuplicado) {
              banco.push(item);
              adicionadosPorArquivo++;
            }
          }

          if (adicionadosPorArquivo > 0) {
            totalAdicionadosNestaOperacao += adicionadosPorArquivo;
            arquivosOFX.push(f.name);
          }

        } catch (e) {
          console.error("Erro NO OFX", f.name, e);
        }
      }

      const htmlInput = document.getElementById("htmlFile");
      const htmlFiles = htmlInput ? Array.from(htmlInput.files) : [];

      // --- HTML (Sistema): processa e filtra duplicados (HTML vs HTML) ---
      for (const hf of htmlFiles) {
        try {
          const nomeNormSys = normalizeFileName(hf.name);
          if (arquivosSYS.includes(nomeNormSys)) {
            alert("arquivo já importado");
            continue;
          }

          const htmlTxt = await hf.text();
          const parsedSys = parseMatricial(htmlTxt, hf.name);

          let adicionadosPorArquivoSys = 0;

          // Filtrar duplicados dentro do array `sistema`
          for (const item of parsedSys) {
            const ehDuplicadoSys = sistema.some(s => {
              return (s.data || "") === (item.data || "") &&
                Number(s.valor || 0) === Number(item.valor || 0) &&
                (s.cliente || "") === (item.cliente || "") &&
                (s.tipo || "") === (item.tipo || "") &&
                (s.doc || "") === (item.doc || "") &&
                (s.nf || "") === (item.nf || "");
            });

            if (!ehDuplicadoSys) {
              sistema.push(item);
              adicionadosPorArquivoSys++;
            }
          }

          if (adicionadosPorArquivoSys > 0) {
            totalAdicionadosNestaOperacao += adicionadosPorArquivoSys;
            arquivosSYS.push(nomeNormSys);
          }

        } catch (e) {
          console.error("Erro no HTML", hf.name, e);
        }
      }


      banco.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      sistema.sort((a, b) => (a.data || "").localeCompare(b.data || ""));

      document.getElementById("ofxFiles").value = "";
      document.getElementById("htmlFile").value = "";

      renderArquivosImportados();
      renderFiltroArquivosOFX();
      renderList();
      atualizarTotais();

      alert(`Importação concluída: ${totalAdicionadosNestaOperacao} registros novos adicionados.`);
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
      renderFiltroArquivosOFX();
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
      renderFiltroArquivosOFX();
      renderList();
      atualizarTotais();
    } catch (e) {
      console.error("Erro ao restaurar dados salvos", e);
    }
  }

  ensurePainelDiferenca();
});
