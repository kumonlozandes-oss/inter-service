const express = require("express");
const fs = require("fs");
const https = require("https");
const querystring = require("querystring");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const financeiroRoutes = require("./routes/financeiro");
const interRoutes = require("./routes/inter");
const webhookRoutes = require("./routes/webhook");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const app = express();
const PORT = process.env.PORT || 3000;
const INTER_HOST = "cdpj.partners.bancointer.com.br";
const CERT_PATH = process.env.INTER_CERT_PATH || "/etc/secrets/inter-certificado.crt";
const KEY_PATH = process.env.INTER_KEY_PATH || "/etc/secrets/inter-chave.key";
const DATA_INICIAL_INTER = process.env.INTER_DATA_INICIAL || "2000-01-01";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/financeiro", financeiroRoutes);
app.use("/inter", interRoutes);
app.use("/webhook", webhookRoutes);

function log(evento, dados = {}) {
  console.log(`[INTER] ${evento}`, dados);
}

function certificadosInter() {
  return {
    cert: fs.readFileSync(CERT_PATH),
    key: fs.readFileSync(KEY_PATH)
  };
}

function requisicaoHttps(options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        resolve({ status: response.statusCode || 500, body: data });
      });
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function jsonSeguro(valor, contexto = "resposta") {
  if (!valor) return {};
  try {
    return JSON.parse(valor);
  } catch {
    throw new Error(`${contexto} do Banco Inter não é um JSON válido`);
  }
}

async function obterTokenInter() {
  const body = querystring.stringify({
    client_id: process.env.INTER_CLIENT_ID,
    client_secret: process.env.INTER_CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "boleto-cobranca.read boleto-cobranca.write"
  });
  const { cert, key } = certificadosInter();
  const resultado = await requisicaoHttps({
    hostname: INTER_HOST,
    port: 443,
    path: "/oauth/v2/token",
    method: "POST",
    cert,
    key,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    }
  }, body);
  const json = jsonSeguro(resultado.body, "OAuth");
  if (resultado.status < 200 || resultado.status >= 300 || !json.access_token) {
    throw new Error(`OAuth Inter falhou (${resultado.status}): ${resultado.body}`);
  }
  return { token: json.access_token, resultado };
}

async function requisicaoInter({ path, method = "GET", body, token }) {
  const acesso = token || (await obterTokenInter()).token;
  const { cert, key } = certificadosInter();
  const headers = { Authorization: `Bearer ${acesso}` };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(body);
  }
  const resultado = await requisicaoHttps({
    hostname: INTER_HOST,
    port: 443,
    path,
    method,
    cert,
    key,
    headers
  }, body);
  const json = jsonSeguro(resultado.body, `Inter ${method} ${path}`);
  if (resultado.status < 200 || resultado.status >= 300) {
    const erro = new Error(`Banco Inter respondeu ${resultado.status}`);
    erro.status = resultado.status;
    erro.respostaInter = json;
    throw erro;
  }
  return { json, resultado, token: acesso };
}

async function consultarCobranca(codigo, token) {
  return (await requisicaoInter({
    path: `/cobranca/v3/cobrancas/${encodeURIComponent(codigo)}`,
    token
  })).json;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function dataISOHa90Dias() {
    const data = new Date();
    data.setDate(data.getDate() - 90);
    return data.toISOString().slice(0, 10);
}

async function listarCobrancasInter({ dataInicial = DATA_INICIAL_INTER, dataFinal = hojeISO() } = {}) {
  const { token } = await obterTokenInter();
  const cobrancas = [];
  let pagina = 0;
  let totalPaginas = 1;

  while (pagina < totalPaginas) {
    const parametros = new URLSearchParams({
      dataInicial,
      dataFinal,
      itensPorPagina: "100",
      paginaAtual: String(pagina)
    });
    const { json } = await requisicaoInter({
      path: `/cobranca/v3/cobrancas?${parametros.toString()}`,
      token
    });
    cobrancas.push(...(json.cobrancas || []));
    totalPaginas = Number(json.totalPaginas || 1);
    log("Página de cobranças consultada", {
      pagina: pagina + 1,
      totalPaginas,
      registros: (json.cobrancas || []).length
    });
    pagina += 1;
  }
  return { cobrancas, token };
}

app.get("/importar-boletos", async (req, res) => {

    try {

        const { cobrancas } = await listarCobrancasInter({
            dataInicial: "2026-01-01",
            dataFinal: "2027-12-31"
        });

        let inseridos = 0;
        let atualizados = 0;

        for (const boleto of cobrancas) {

            const dados = dadosDoBoleto(boleto);

            const { data: existente } = await supabase
                .from("financeiro_titulos")
                .select("id")
                .eq("id_inter", dados.id_inter)
                .maybeSingle();

            if (existente) {

                const { data: registro } = await supabase
                    .from("financeiro_titulos")
                    .select("*")
                    .eq("id", existente.id)
                    .single();

                await atualizarRegistro(
                    "financeiro_titulos",
                    "id",
                    registro.id,
                    registro,
                    dadosTitulo(dados)
                );

                atualizados++;

            } else {

                const novo = dadosTitulo(dados);

// Não importa boletos que ainda não possuem mensalidade vinculada

const { error } = await supabase
    .from("financeiro_titulos")
    .insert(novo);

if (error) throw error;

if (error) {
    console.error(error);
    throw error;
}

                inseridos++;

            }

        }

        res.json({
            total: cobrancas.length,
            inseridos,
            atualizados
        });

    } catch (erro) {

        responderErro(res, erro);

    }

});

function normalizarSeuNumero(valor) {
  const texto = String(valor || "").trim();
  if (!texto || texto.includes("/") || texto.length < 7) return texto;
  return `${texto.slice(0, -2)}/${texto.slice(-2)}`;
}

function statusInterno(situacao) {
  return situacao === "RECEBIDO" ? "PAGO" : situacao || null;
}

function numero(valor) {
  if (valor === undefined || valor === null || valor === "") return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
}

function dataOuNulo(valor) {
  return valor || null;
}

function igual(valorAtual, novoValor) {
  if (valorAtual === novoValor) return true;
  if (valorAtual == null && novoValor == null) return true;
  if (typeof valorAtual === "number" || typeof novoValor === "number") {
    return numero(valorAtual) === numero(novoValor);
  }
  return String(valorAtual) === String(novoValor);
}

function camposAlterados(atual, desejado) {
  return Object.fromEntries(
    Object.entries(desejado).filter(([campo, valor]) => !igual(atual?.[campo], valor))
  );
}

function dadosDoBoleto(detalhe) {
  const cobranca = detalhe.cobranca || {};
  const boleto = detalhe.boleto || {};
  const pix = detalhe.pix || {};
  return {
    id_inter: cobranca.codigoSolicitacao || null,
    seu_numero: cobranca.seuNumero || null,
    status_inter: cobranca.situacao || null,
    status: statusInterno(cobranca.situacao),
    nosso_numero: boleto.nossoNumero || null,
    linha_digitavel: boleto.linhaDigitavel || null,
    codigo_barras: boleto.codigoBarras || null,
    pix_copia_cola: pix.pixCopiaECola || null,
    codigo_pix: pix.txid || null,
    qr_code_pix: pix.imagemQrcode || null,
    url_pdf_boleto: detalhe.pdf || null,
    data_vencimento: dataOuNulo(cobranca.dataVencimento),
    data_pagamento: dataOuNulo(cobranca.dataSituacao),
    DATA_PAGAMENTO: dataOuNulo(cobranca.dataSituacao),
    data_baixa: dataOuNulo(cobranca.dataSituacao),
    valor_recebido: numero(cobranca.valorTotalRecebido),
    valor_original: numero(cobranca.valorNominal)
  };
}

function dadosMensalidade(dados) {
  return {
    status: dados.status
  };
}

function dadosTitulo(dados) {
  return {
    id_inter: dados.id_inter,
    seu_numero: dados.seu_numero,
    status_inter: dados.status_inter,
    status: dados.status,
    nosso_numero: dados.nosso_numero,
    linha_digitavel: dados.linha_digitavel,
    codigo_barras: dados.codigo_barras,
    pix_copia_cola: dados.pix_copia_cola,
    codigo_pix: dados.codigo_pix,
    qr_code_pix: dados.qr_code_pix,
    url_pdf_boleto: dados.url_pdf_boleto,
    vencimento: dados.data_vencimento,
    data_pagamento: dados.data_pagamento,
    data_baixa: dados.data_baixa,
    valor_recebido: dados.valor_recebido,
    valor_original: dados.valor_original
  };
}


function tituloInicial(dados, mensalidade) {
  return {
    id_mensalidade: mensalidade?.ID_MENSALIDADE || null,
    forma_pagamento: mensalidade?.FORMA_PAGAMENTO || "BOLETO",
    ...dadosTitulo(dados),
  };
}

async function atualizarRegistro(tabela, chave, id, atual, desejado) {
  const alteracoes = camposAlterados(atual, desejado);
  if (!Object.keys(alteracoes).length) return false;



  const { error } = await supabase
    .from(tabela)
    .update(alteracoes)
    .eq(chave, id);

  if (error) throw error;
  return true;
}




function responderErro(res, erro) {
    console.error("ERRO COMPLETO:");
    console.error(erro);

    res.status(500).json({
        message: erro.message,
        stack: erro.stack,
        resposta_inter: erro.respostaInter,
        details: erro
    });
}

app.get("/teste-api", async (req, res) => {
  try {
    const { cobrancas } = await listarCobrancasInter({
      dataInicial: "2026-05-01",
      dataFinal: "2026-06-30"
    });
    res.json({ cobrancas });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.post("/gerar-boleto", async (req, res) => {
  console.log(req.body);
  try {
    const corpo = JSON.stringify({
      seuNumero: `MEN-${req.body.id_mensalidade}`,
      valorNominal: Number(req.body.valorNominal),
      dataVencimento: req.body.dataVencimento,
      numDiasAgenda: 30,
      multa: { codigo: "PERCENTUAL", taxa: 2 },
      mora: { codigo: "TAXAMENSAL", taxa: 1 },
      pagador: {
        cpfCnpj: req.body.cpfCnpj,
        tipoPessoa: "FISICA",
        nome: req.body.nome,
        endereco: req.body.endereco,
        cidade: req.body.cidade,
        uf: req.body.uf,
        cep: req.body.cep
      }
    });
    const emissao = await requisicaoInter({
      path: "/cobranca/v3/cobrancas",
      method: "POST",
      body: corpo
    });
    const codigo = emissao.json.codigoSolicitacao;
    if (!codigo) throw new Error("Banco Inter não retornou codigoSolicitacao");
    const detalhe = await consultarCobranca(codigo, emissao.token);
    const dados = dadosDoBoleto(detalhe);

    const { data: boletoExistente, error: erroDuplicidade } = await supabase
    .from("financeiro_titulos")
    .select("id,id_mensalidade")
    .eq("id_inter", dados.id_inter);

if (erroDuplicidade) throw erroDuplicidade;

if (
    boletoExistente.length > 0 &&
    (!req.body.id_titulo || boletoExistente[0].id !== req.body.id_titulo)
) {
    throw new Error(
        `O id_inter ${dados.id_inter} já está vinculado a outro título.`
    );
}

    if (req.body.id_titulo) {

    const { data: titulo, error } = await supabase
        .from("financeiro_titulos")
        .select("*")
        .eq("id", req.body.id_titulo)
        .single();

    if (error) throw error;

    const dadosAtualizados = dadosTitulo(dados);

    dadosAtualizados.id_mensalidade = req.body.id_mensalidade;

    await atualizarRegistro(
        "financeiro_titulos",
        "id",
        titulo.id,
        titulo,
        dadosAtualizados
    );

}
    if (req.body.id_mensalidade) {
      const { data: mensalidade, error } = await supabase
        .from("mensalidades").select("*")
        .eq("ID_MENSALIDADE", req.body.id_mensalidade).single();
      if (error) throw error;
      await atualizarRegistro(
        "mensalidades", "ID_MENSALIDADE", mensalidade.ID_MENSALIDADE,
        mensalidade, dadosMensalidade(dados)
      );
    }
    res.json({
      sucesso: true,
      status_http: emissao.resultado.status,
      id_mensalidade: req.body.id_mensalidade,
      guid_aluno: req.body.guid_aluno,
      guid_responsavel: req.body.guid_responsavel,
      id_inter: dados.id_inter,
      nosso_numero: dados.nosso_numero,
      seu_numero: dados.seu_numero,
      linha_digitavel: dados.linha_digitavel,
      codigo_barras: dados.codigo_barras,
      codigo_pix: dados.codigo_pix,
      qr_code_pix: dados.qr_code_pix,
      pix_copia_cola: dados.pix_copia_cola,
      url_pdf_boleto: dados.url_pdf_boleto,
      status: dados.status_inter,
      resposta_inter: detalhe
    });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/consultar/:codigo", async (req, res) => {
  try {
    res.json(await consultarCobranca(req.params.codigo));
  } catch (erro) {
    responderErro(res, erro);
  }
});

async function sincronizarCodigoInter(idInter, token) {

    const detalhe = await consultarCobranca(idInter, token);

    const dados = dadosDoBoleto(detalhe);

    let titulo = null;

    if (dados.id_inter) {

        const { data } = await supabase
            .from("financeiro_titulos")
            .select("*")
            .eq("id_inter", dados.id_inter)
            .maybeSingle();

        titulo = data;
    }

    if (!titulo && dados.seu_numero) {

        const { data } = await supabase
            .from("financeiro_titulos")
            .select("*")
            .eq("seu_numero", normalizarSeuNumero(dados.seu_numero))
            .maybeSingle();

        titulo = data;
    }

    if (!titulo) {

        return {
            sucesso: false,
            motivo: "Título não encontrado",
            seu_numero: dados.seu_numero,
            id_inter: dados.id_inter
        };

    }

    await atualizarRegistro(
        "financeiro_titulos",
        "id",
        titulo.id,
        titulo,
        dadosTitulo(dados)
    );

    const dadosAtualizados = dadosTitulo(dados);

// Mantém o vínculo com a mensalidade
dadosAtualizados.id_mensalidade = titulo.id_mensalidade;

await atualizarRegistro(
    "financeiro_titulos",
    "id",
    titulo.id,
    titulo,
    dadosAtualizados
);

if (titulo.id_mensalidade) {

    const { data: mensalidade } = await supabase
        .from("mensalidades")
        .select("*")
        .eq("id", titulo.id_mensalidade)
        .maybeSingle();

    if (mensalidade) {

        await atualizarRegistro(
            "mensalidades",
            "id",
            mensalidade.id,
            mensalidade,
            dadosMensalidade(dados)
        );

    }

}

    return {
        sucesso: true,
        id_inter: dados.id_inter,
        seu_numero: dados.seu_numero,
        status: dados.status
    };

}

app.get("/sincronizar/:idInter", async (req, res) => {
  try {
    const resultado = await sincronizarCodigoInter(req.params.idInter);
    res.json({ sucesso: true, situacao: resultado.pago ? "RECEBIDO" : undefined, ...resultado });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/sincronizar-todos", async (req, res) => {

    const resumo = {
        sucesso: true,
        total_titulos: 0,
        atualizados: 0,
        sem_id_inter: 0,
        erros: []
    };

    try {

        const { token } = await obterTokenInter();

       const { data: titulos, error } = await supabase
    .from("financeiro_titulos")
    .select("id,id_inter,seu_numero,id_mensalidade")
    .not("id_inter", "is", null);

        if (error) throw error;

        resumo.total_titulos = titulos.length;

      const idsProcessados = new Set();

        for (const titulo of titulos) {

          if (idsProcessados.has(titulo.id_inter)) {
    continue;
}

idsProcessados.add(titulo.id_inter);

            if (!titulo.id_inter) {

                resumo.sem_id_inter++;
                continue;

            }

            try {

                const resultado = await sincronizarCodigoInter(
                    titulo.id_inter,
                    token
                );

                if (resultado.sucesso) {

    resumo.atualizados++;

} else {

    resumo.erros.push({
        id_inter: titulo.id_inter,
        motivo: resultado.motivo,
        seu_numero: resultado.seu_numero
    });

}

            } catch (erro) {

                resumo.erros.push({
                    id_inter: titulo.id_inter,
                    erro: erro.message
                });

            }

        }

        res.json(resumo);

    } catch (erro) {

        responderErro(res, erro);

    }

});

app.get("/boletos", async (req, res) => {
  try {
    const { cobrancas } = await listarCobrancasInter();
    res.json({ cobrancas });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/cancelar/:codigo", async (req, res) => {
  try {
    const body = JSON.stringify({ situacao: "CANCELADA" });
    const resultado = await requisicaoInter({
      path: `/cobranca/v3/cobrancas/${encodeURIComponent(req.params.codigo)}`,
      method: "PATCH",
      body
    });
    res.json({ status: resultado.resultado.status, body: resultado.resultado.body });
  } catch (erro) {
    responderErro(res, erro);
  }
});

function resumoDesconto(item) {
  const cobranca = item.cobranca || {};
  return {
    cpf: cobranca.pagador?.cpfCnpj || "",
    nome: cobranca.pagador?.nome || "",
    vencimento: cobranca.dataVencimento || "",
    valor_nominal: Number(cobranca.valorNominal || 0),
    desconto: Number(cobranca.descontos?.[0]?.valor || 0),
    situacao: cobranca.situacao || "",
    seu_numero: cobranca.seuNumero || ""
  };
}

app.get("/descontos-reais", async (req, res) => {
  try {
    const { cobrancas } = await listarCobrancasInter({
      dataInicial: "2026-04-01", dataFinal: "2026-12-31"
    });
    res.json(cobrancas.map(resumoDesconto));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/historico-maio-junho", async (req, res) => {
  try {
    const { cobrancas } = await listarCobrancasInter({
      dataInicial: "2026-04-01", dataFinal: "2026-12-31"
    });
    res.json(cobrancas.filter((item) => item.cobranca?.situacao === "RECEBIDO"));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/descontos-confirmados", async (req, res) => {
  const lista = [];
  try {
    const { cobrancas, token } = await listarCobrancasInter({
      dataInicial: "2026-04-01", dataFinal: "2026-12-31"
    });
    for (const item of cobrancas.filter((registro) => registro.cobranca?.situacao === "RECEBIDO")) {
      const codigo = item.cobranca.codigoSolicitacao;
      try {
        const detalhe = await consultarCobranca(codigo, token);
        const cobranca = detalhe.cobranca;
        lista.push({
          cpf: cobranca?.pagador?.cpfCnpj || "",
          nome: cobranca?.pagador?.nome || "",
          valor_nominal: Number(cobranca?.valorNominal || 0),
          desconto: Number(cobranca?.descontos?.[0]?.valor || 0),
          vencimento: cobranca?.dataVencimento || "",
          seu_numero: cobranca?.seuNumero || "",
          codigo
        });
      } catch (erro) {
        lista.push({ erro: true, codigo, mensagem: String(erro) });
      }
    }
    res.json(lista);
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/sincronizar-boletos", async (req, res) => {
  let inseridos = 0;
  const erros = [];
  try {
    const { cobrancas, token } = await listarCobrancasInter();
    for (const item of cobrancas) {
      const codigo = item.cobranca?.codigoSolicitacao;
      if (!codigo) continue;
      try {
        const detalhe = await consultarCobranca(codigo, token);
        const dados = dadosDoBoleto(detalhe);
        const cpf = detalhe.cobranca?.pagador?.cpfCnpj;
        if (!cpf) continue;
        const { data: existente, error: erroBusca } = await supabase
          .from("financeiro_responsaveis").select("id").eq("id_inter", dados.id_inter).limit(1);
        if (erroBusca) throw erroBusca;
        if (existente?.length) continue;
        const { error } = await supabase.from("financeiro_responsaveis").insert({
          cpf_responsavel: cpf,
          responsavel: detalhe.cobranca?.pagador?.nome || null,
          valor_original: dados.valor_original || 0,
          valor_desconto: Number(detalhe.cobranca?.descontos?.[0]?.valor || 0),
          valor_final: (dados.valor_original || 0) - Number(detalhe.cobranca?.descontos?.[0]?.valor || 0),
          valor_recebido: dados.valor_recebido || 0,
          id_inter: dados.id_inter,
          seu_numero: dados.seu_numero,
          competencia: dados.seu_numero,
          nosso_numero: dados.nosso_numero,
          data_vencimento: dados.data_vencimento,
          status_inter: dados.status_inter,
          linha_digitavel: dados.linha_digitavel,
          codigo_barras: dados.codigo_barras,
          pix_copia_cola: dados.pix_copia_cola,
          codigo_pix: dados.codigo_pix,
          qr_code_pix: dados.qr_code_pix,
          url_pdf_boleto: dados.url_pdf_boleto,
          origem: "INTER",
          ultima_sincronizacao: new Date().toISOString()
        });
        if (error) throw error;
        inseridos += 1;
      } catch (erro) {
        erros.push({ codigo, erro: String(erro) });
      }
    }
    res.json({ sucesso: erros.length === 0, inseridos, erros });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/vincular-responsaveis", async (req, res) => {
  try {
    const [{ data: financeiros, error: erroFinanceiros }, { data: responsaveis, error: erroResponsaveis }] = await Promise.all([
      supabase.from("financeiro_responsaveis").select("*"),
      supabase.from("ksis_responsaveis").select("*")
    ]);
    if (erroFinanceiros) throw erroFinanceiros;
    if (erroResponsaveis) throw erroResponsaveis;
    const porCpf = new Map((responsaveis || []).map((item) => [
      String(item.cpf || "").replace(/\D/g, ""), item
    ]));
    let atualizados = 0;
    for (const financeiro of financeiros || []) {
      const responsavel = porCpf.get(String(financeiro.cpf_responsavel || "").replace(/\D/g, ""));
      if (!responsavel) continue;
      const { error } = await supabase.from("financeiro_responsaveis").update({
        guid_responsavel: responsavel.guid_responsavel,
        guid_aluno: responsavel.guid_aluno,
        email_responsavel: responsavel.email,
        telefone_responsavel: responsavel.celular
      }).eq("id", financeiro.id);
      if (error) throw error;
      atualizados += 1;
    }
    res.json({ sucesso: true, atualizados });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/padronizar-financeiro", async (req, res) => {
  try {
    const { data: boletos, error } = await supabase.from("financeiro_responsaveis").select("*");
    if (error) throw error;
    if (!boletos?.length) return res.json({ sucesso: false, mensagem: "Nenhum boleto encontrado." });
    const grupos = new Map();
    for (const boleto of boletos) {
      const chave = boleto.guid_responsavel || boleto.cpf_responsavel;
      if (!chave) continue;
      grupos.set(chave, [...(grupos.get(chave) || []), boleto]);
    }
    let processados = 0;
    for (const lista of grupos.values()) {
      lista.sort((a, b) => String(a.seu_numero || "").localeCompare(String(b.seu_numero || "")));
      const primeiro = lista[0];
      if (!primeiro.guid_aluno || !primeiro.guid_responsavel) continue;
      const recebido = lista.find((item) => item.status_inter === "RECEBIDO") || primeiro;
      const { error: erroUpsert } = await supabase.from("financeiro_padrao").upsert({
        guid_aluno: recebido.guid_aluno,
        guid_responsavel: recebido.guid_responsavel,
        aluno: "",
        responsavel: recebido.responsavel,
        cpf_responsavel: recebido.cpf_responsavel,
        email_responsavel: recebido.email_responsavel,
        telefone_responsavel: recebido.telefone_responsavel,
        disciplina: "PENDENTE",
        valor_original: recebido.valor_original,

desconto_pontualidade: recebido.desconto_pontualidade || 0,
desconto_comercial: recebido.desconto_comercial || 0,
desconto_bolsa: recebido.desconto_bolsa || 0,
acrescimos: recebido.acrescimos || 0,

valor_desconto: recebido.valor_desconto,
valor_final: recebido.valor_final,
        dia_vencimento: recebido.data_vencimento ? new Date(recebido.data_vencimento).getDate() : 5,
        forma_pagamento: recebido.forma_pagamento,
        tipo_cobranca: recebido.tipo_cobranca,
        quantidade_boletos_analisados: lista.length,
        primeira_competencia: lista[0].competencia,
        ultima_competencia_paga: recebido.status_inter === "RECEBIDO" ? recebido.competencia : null,
        data_padronizacao: new Date().toISOString(),
        algoritmo_padronizacao: "IMPLANTACAO_V1"
      });
      if (erroUpsert) throw erroUpsert;
      processados += 1;
    }
    res.json({ sucesso: true, responsaveis: processados });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/gerar-mensalidades", async (req, res) => {
  try {
    const { data: boletos, error } = await supabase.from("financeiro_responsaveis").select("*");
    if (error) throw error;
    let criadas = 0;
    let ignoradas = 0;
    for (const item of boletos || []) {
      const { data: existente, error: erroBusca } = await supabase
        .from("mensalidades").select("ID_MENSALIDADE").eq("id_inter", item.id_inter).limit(1);
      if (erroBusca) throw erroBusca;
      if (existente?.length) { ignoradas += 1; continue; }
      const valorOriginal = Number(item.valor_original || 0);
      const desconto = Number(item.valor_desconto || 0);
      const { error: erroInsert } = await supabase.from("mensalidades").insert({
        ID_MENSALIDADE: randomUUID(),
        ID_ALUNO: item.guid_aluno,
        ALUNO: item.nome_responsavel,
        CURSO: "",
        TIPO: "MENSALIDADE",
        VALOR: valorOriginal,
        COMPETENCIA: item.competencia,
        VENCIMENTO: item.data_vencimento,
        STATUS: item.status_inter === "RECEBIDO" ? "PAGO" : "ABERTO",
        DATA_PAGAMENTO: item.ultima_sincronizacao,
        FORMA_PAGAMENTO: "BOLETO",
        responsavel: item.responsavel,
        cpf_responsavel: item.cpf_responsavel,
        origem: "INTER",
        tipo_cobranca: "BOLETO",
        valor_original: valorOriginal,
        valor_desconto: desconto,
        valor_final: valorOriginal - desconto,
        seu_numero: item.seu_numero,
        id_inter: item.id_inter,
        status_inter: item.status_inter
      });
      if (erroInsert) throw erroInsert;
      criadas += 1;
    }
    res.json({ sucesso: true, mensalidades_criadas: criadas, mensalidades_ignoradas: ignoradas });
  } catch (erro) {
    responderErro(res, erro);
  }
});

function competenciaParaMesAno(competencia) {

    const [mes, ano] = competencia.split("/");

    return {
        competencia_mes: Number(mes),
        competencia_ano: Number(ano)
    };

}

app.get("/implantar-titulos", async (req, res) => {
  try {

    const { data: boletos, error } = await supabase
      .from("financeiro_responsaveis")
      .select("*");

    if (error) throw error;

    let criados = 0;
    let existentes = 0;

    for (const boleto of boletos) {

      const { data: mensalidade } = await supabase
        .from("mensalidades")
        .select("id_mensalidade,id")
        .eq("guid_aluno", boleto.guid_aluno)
        .eq("competencia", boleto.competencia)
        .maybeSingle();

      if (!mensalidade) continue;

      const { data: tituloExistente } = await supabase
        .from("financeiro_titulos")
        .select("id")
        .eq("id_inter", boleto.id_inter)
        .maybeSingle();

      if (tituloExistente) {
        existentes++;
        continue;
      }

      const { data: titulo, error: erroTitulo } = await supabase
        .from("financeiro_titulos")
        .insert({
          id_mensalidade: mensalidade.id_mensalidade,

          id_inter: boleto.id_inter,

          valor_original: boleto.valor_original,
          valor_desconto: boleto.valor_desconto,
          valor_final: boleto.valor_final,

          vencimento: boleto.data_vencimento,

          status: boleto.status_inter === "RECEBIDO" ? "PAGO" : "ABERTO",
          status_inter: boleto.status_inter,

          forma_pagamento: boleto.forma_pagamento,

          data_pagamento: boleto.data_pagamento,

          nosso_numero: boleto.nosso_numero,
          seu_numero: boleto.seu_numero,

          linha_digitavel: boleto.linha_digitavel,
          codigo_barras: boleto.codigo_barras,

          codigo_pix: boleto.codigo_pix,
          qr_code_pix: boleto.qr_code_pix,
          pix_copia_cola: boleto.pix_copia_cola,

          url_pdf_boleto: boleto.url_pdf_boleto,

          origem: "IMPLANTACAO"
        })
        .select()
        .single();

      if (erroTitulo) throw erroTitulo;

      await supabase
        .from("mensalidades")
        .update({
          id_titulo: titulo.id
        })
        .eq("id_mensalidade", mensalidade.id_mensalidade);

      criados++;
    }

    res.json({
      sucesso: true,
      criados,
      existentes
    });

  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/gerar-mensalidades-competencia", async (req, res) => {

    try {

        const competencia = req.query.competencia;

        if (!competencia) {
            return res.status(400).json({
                sucesso: false,
                mensagem: "Informe a competência. Ex.: 09/2026"
            });
        }

        const { competencia_mes, competencia_ano } =
            competenciaParaMesAno(competencia);

       const { data: financeiros, error: erroFinanceiro } = await supabase
    .from("financeiro_padrao")
    .select("*");

if (erroFinanceiro) throw erroFinanceiro;

const { data: alunos, error: erroAlunos } = await supabase
    .from("alunos_master")
    .select("guid,nome,status");

if (erroAlunos) throw erroAlunos;const mapaAlunos = new Map(
    alunos.map(aluno => [aluno.guid, aluno])
);

const alunosAptos = financeiros
    .map(financeiro => {

        const aluno = mapaAlunos.get(financeiro.guid_aluno);

        if (!aluno || aluno.status !== "ATIVO") {
            return null;
        }

        return {

    guid: financeiro.guid_aluno,
    guid_responsavel: financeiro.guid_responsavel,
    id_aluno: financeiro.id_aluno,

    nome: financeiro.aluno,
    responsavel: financeiro.responsavel,

    curso: financeiro.disciplina,

    valor_original: Number(financeiro.valor_original),

desconto_pontualidade: Number(financeiro.desconto_pontualidade || 0),
desconto_comercial: Number(financeiro.desconto_comercial || 0),
desconto_bolsa: Number(financeiro.desconto_bolsa || 0),
acrescimos: Number(financeiro.acrescimos || 0),

valor_desconto: Number(financeiro.valor_desconto || 0),
valor_final: Number(financeiro.valor_final),

    vencimento: financeiro.dia_vencimento

};

    })
    .filter(Boolean);

      const { data: mensalidades, error: erroMensalidades } = await supabase
    .from("mensalidades")
    .select("guid_aluno,competencia_mes,competencia_ano")
    .eq("competencia_mes", competencia_mes)
    .eq("competencia_ano", competencia_ano);

if (erroMensalidades) throw erroMensalidades;

    const mensalidadesExistentes = new Set(
    mensalidades.map(m =>
        `${m.guid_aluno}-${m.competencia_mes}-${m.competencia_ano}`
    )
);

const alunosParaGerar = alunosAptos.filter(aluno => {

    const chave =
        `${aluno.guid}-${competencia_mes}-${competencia_ano}`;

    return !mensalidadesExistentes.has(chave);

});
      
    const novasMensalidades = alunosParaGerar.map(aluno => ({

    id_mensalidade: randomUUID(),

    guid_aluno: aluno.guid,
    guid_responsavel: aluno.guid_responsavel,
    id_aluno: aluno.id_aluno,

    aluno: aluno.nome,
    responsavel: aluno.responsavel,

    curso: aluno.curso,
    tipo: "MENSALIDADE",

    competencia,
    competencia_mes,
    competencia_ano,

    valor_original: aluno.valor_original,

desconto_pontualidade: aluno.desconto_pontualidade,
desconto_comercial: aluno.desconto_comercial,
desconto_bolsa: aluno.desconto_bolsa,
acrescimos: aluno.acrescimos,

valor_desconto: aluno.valor_desconto,
valor_final: aluno.valor_final,

    status: "ABERTO",

    criado_automaticamente: true,
    conferido: false,

    data_criacao: new Date(),
    data_atualizacao: new Date()

}));

const { error: erroInsert } = await supabase
    .from("mensalidades")
    .insert(novasMensalidades);

if (erroInsert) throw erroInsert;

res.json({
    sucesso: true,
    competencia,
    mensalidades_criadas: novasMensalidades.length
});

    } catch (erro) {

        responderErro(res, erro);

    }

});

app.get("/auditoria-financeira", async (req, res) => {

    try {

        const { competencia } = req.query;

if (!competencia) {
    return res.status(400).json({
        sucesso: false,
        mensagem: "Informe a competência."
    });
}

const { competencia_mes, competencia_ano } =
    competenciaParaMesAno(competencia);

// Financeiro
const { data: financeiros, error: erroFinanceiro } =
    await supabase
        .from("financeiro_padrao")
        .select("*");

if (erroFinanceiro) throw erroFinanceiro;

// Alunos
const { data: alunos, error: erroAlunos } =
    await supabase
        .from("alunos_master")
        .select("guid,nome,status");

if (erroAlunos) throw erroAlunos;

// Mensalidades
const { data: mensalidades, error: erroMensalidades } =
    await supabase
        .from("mensalidades")
        .select("*")
        .eq("competencia_mes", competencia_mes)
        .eq("competencia_ano", competencia_ano);

if (erroMensalidades) throw erroMensalidades;

// Títulos
const { data: titulos, error: erroTitulos } =
    await supabase
        .from("financeiro_titulos")
        .select("*");

if (erroTitulos) throw erroTitulos;

// Recebimentos
const { data: recebimentos, error: erroRecebimentos } =
    await supabase
        .from("recebimentos")
        .select("*");

if (erroRecebimentos) throw erroRecebimentos;

// Índices
const mapaAlunos = new Map(
    alunos.map(a => [a.guid, a])
);

const mapaFinanceiro = new Map(
    financeiros.map(f => [f.guid_aluno, f])
);

const mapaMensalidades = new Map(
    mensalidades.map(m => [m.guid_aluno, m])
);

const mapaTitulos = new Map(
    titulos.map(t => [
        `${t.guid_aluno}-${t.competencia}`,
        t
    ])
);

const mapaRecebimentos = new Map(
    recebimentos.map(r => [r.id_mensalidade, r])
);

const inconsistencias = [];

    // ======================================================
// REGRA 2 - Mensalidade duplicada
// ======================================================

const contadorMensalidades = new Map();

for (const mensalidade of mensalidades) {

    const quantidade = contadorMensalidades.get(mensalidade.guid_aluno) || 0;

    contadorMensalidades.set(
        mensalidade.guid_aluno,
        quantidade + 1
    );

}

for (const [guidAluno, quantidade] of contadorMensalidades) {

    if (quantidade > 1) {

        const aluno = mapaAlunos.get(guidAluno);

        inconsistencias.push({
            tipo: "MENSALIDADE_DUPLICADA",
            guid_aluno: guidAluno,
            aluno: aluno?.nome || "Aluno não encontrado",
            competencia,
            descricao: `${quantidade} mensalidades encontradas para a mesma competência.`
        });

    }

}

// ======================================================
// REGRA 1 - Aluno ativo sem mensalidade
// ======================================================

for (const financeiro of financeiros) {

    const aluno = mapaAlunos.get(financeiro.guid_aluno);

    if (!aluno || aluno.status !== "ATIVO") continue;

    if (!mapaMensalidades.has(financeiro.guid_aluno)) {

        inconsistencias.push({
            tipo: "SEM_MENSALIDADE",
            guid_aluno: aluno.guid,
            aluno: aluno.nome,
            competencia,
            descricao: "Aluno ativo sem mensalidade."
        });

    }

}


// ======================================================
// REGRA 4 - Aluno ativo sem cadastro financeiro
// ======================================================

for (const aluno of alunos) {

    if (aluno.status !== "ATIVO") continue;

    if (!mapaFinanceiro.has(aluno.guid)) {

        inconsistencias.push({

            tipo: "SEM_CADASTRO_FINANCEIRO",

            guid_aluno: aluno.guid,

            aluno: aluno.nome,

            competencia,

            descricao:
                "Aluno ativo sem cadastro no financeiro."

        });

    }

}

// ======================================================
// REGRA 5 - Mensalidade para aluno inativo
// ======================================================

for (const mensalidade of mensalidades) {

    const aluno = mapaAlunos.get(mensalidade.guid_aluno);

    if (!aluno) continue;

    if (aluno.status !== "ATIVO") {

        inconsistencias.push({

            tipo: "MENSALIDADE_ALUNO_INATIVO",

            guid_aluno: aluno.guid,

            aluno: aluno.nome,

            competencia,

            descricao:
                `Aluno com status "${aluno.status}" possui mensalidade gerada.`

        });

    }

}

res.json({

    sucesso: true,

    competencia,

    resumo: {

        financeiros: financeiros.length,
        alunos: alunos.length,
        mensalidades: mensalidades.length,
        titulos: titulos.length,
        recebimentos: recebimentos.length

    },

    inconsistencias: inconsistencias.length,

    dados: inconsistencias

});

    } catch (erro) {

        responderErro(res, erro);

    }

});

app.get("/sincronizar-recebimentos", async (req, res) => {
  try {
    const { data: recebidos, error } = await supabase
      .from("financeiro_responsaveis").select("*").eq("status_inter", "RECEBIDO");
    if (error) throw error;
    let inseridos = 0;
    for (const item of recebidos || []) {
      const { data: existente, error: erroBusca } = await supabase
        .from("recebimentos").select("ID_RECEBIMENTO")
        .eq("ID_MENSALIDADE", item.ultimo_codigo_inter).limit(1);
      if (erroBusca) throw erroBusca;
      if (existente?.length) continue;
      const { error: erroInsert } = await supabase.from("recebimentos").insert({
        ID_RECEBIMENTO: randomUUID(),
        ID_MENSALIDADE: item.ultimo_codigo_inter,
        ALUNO: item.nome_responsavel,
        VALOR: String(item.valor_mensalidade || 0),
        DATA_RECEBIMENTO: new Date().toISOString(),
        FORMA_PAGAMENTO: "BOLETO",
        OBSERVACAO: item.ultimo_seu_numero,
        STATUS: "PAGO"
      });
      if (erroInsert) throw erroInsert;
      inseridos += 1;
    }
    res.json({ sucesso: true, inseridos });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/sincronizar-movimentacoes", async (req, res) => {
  try {
    const { data: recebimentos, error } = await supabase.from("recebimentos").select("*");
    if (error) throw error;
    let inseridos = 0;
    for (const item of recebimentos || []) {
      const { data: existente, error: erroBusca } = await supabase
        .from("movimentacoes").select("ID_MOV").eq("ID_ORIGEM", item.ID_RECEBIMENTO).limit(1);
      if (erroBusca) throw erroBusca;
      if (existente?.length) continue;
      const { error: erroInsert } = await supabase.from("movimentacoes").insert({
        ID_MOV: randomUUID(),
        DATA: item.DATA_RECEBIMENTO,
        DATA_VENCIMENTO: item.DATA_RECEBIMENTO,
        TIPO: "RECEITA",
        CATEGORIA: "MENSALIDADE",
        DESCRICAO: item.ALUNO,
        VALOR: Number(item.VALOR || 0),
        FORMA_PAGAMENTO: item.FORMA_PAGAMENTO,
        ORIGEM: "INTER",
        STATUS: "CONFIRMADO",
        CENTRO_CUSTO: "ESCOLA",
        ID_ORIGEM: item.ID_RECEBIMENTO,
        DATA_PAGAMENTO: item.DATA_RECEBIMENTO,
        AMBIENTE_TESTE: null
      });
      if (erroInsert) throw erroInsert;
      inseridos += 1;
    }
    res.json({ sucesso: true, inseridos });
  } catch (erro) {
    responderErro(res, erro);
  }
});



app.get("/diagnostico-financeiro", async (req, res) => {
  try {
    const [titulos, mensalidades, alunos] = await Promise.all([
      supabase.from("financeiro_titulos").select("id,status,status_inter,id_inter,id_mensalidade"),
      supabase.from("mensalidades").select("ID_MENSALIDADE,STATUS,id_inter"),
      supabase.from("alunos_master").select("guid,nome,status")
    ]);
    if (titulos.error) throw titulos.error;
    if (mensalidades.error) throw mensalidades.error;
    if (alunos.error) throw alunos.error;
    const lista = titulos.data || [];
    res.json({
      alunos: (alunos.data || []).length,
      mensalidades: (mensalidades.data || []).length,
      boletos: lista.length,
      boletosEmitidos: lista.filter((titulo) => titulo.id_inter).length,
      boletosSemInter: lista.filter((titulo) => !titulo.id_inter).length,
      pagos: lista.filter((titulo) => titulo.status === "PAGO").length,
      atrasados: lista.filter((titulo) => titulo.status === "ATRASADO").length,
      cancelados: lista.filter((titulo) => titulo.status_inter === "CANCELADO").length
    });
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/diagnostico-mensalidades", async (req, res) => {
  try {
    const [mensalidades, titulos] = await Promise.all([
      supabase.from("mensalidades").select("ID_MENSALIDADE,ALUNO,COMPETENCIA,id_inter,id_titulo,STATUS"),
      supabase.from("financeiro_titulos").select("id,id_mensalidade,id_inter")
    ]);
    if (mensalidades.error) throw mensalidades.error;
    if (titulos.error) throw titulos.error;
    const porMensalidade = new Map((titulos.data || []).map((titulo) => [titulo.id_mensalidade, titulo]));
    res.json((mensalidades.data || []).map((mensalidade) => {
      const titulo = porMensalidade.get(mensalidade.ID_MENSALIDADE);
      return {
        mensalidade: mensalidade.ID_MENSALIDADE,
        aluno: mensalidade.ALUNO,
        competencia: mensalidade.COMPETENCIA,
        status: mensalidade.STATUS,
        possuiTitulo: Boolean(titulo),
        possuiInter: Boolean(titulo?.id_inter)
      };
    }));
  } catch (erro) {
    responderErro(res, erro);
  }
});

app.get("/mensalidades-sem-titulo", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("mensalidades").select("ID_MENSALIDADE,ALUNO,COMPETENCIA,STATUS").is("id_titulo", null);
    if (error) throw error;
    res.json({ total: (data || []).length, lista: data || [] });
  } catch (erro) {
    responderErro(res, erro);
  }
});

async function sincronizacaoAutomatica() {

    console.log("========== INÍCIO SINCRONIZAÇÃO AUTOMÁTICA ==========");

    const resumo = {
        total_titulos: 0,
        atualizados: 0,
        sem_id_inter: 0,
        erros: 0
    };

    try {

        const { token } = await obterTokenInter();

        const { data: titulos, error } = await supabase
            .from("financeiro_titulos")
            .select("id,id_inter,seu_numero,id_mensalidade")
            .not("id_inter", "is", null);

        if (error) throw error;

        resumo.total_titulos = titulos.length;

        const idsProcessados = new Set();

        for (const titulo of titulos) {

            if (idsProcessados.has(titulo.id_inter)) continue;
            idsProcessados.add(titulo.id_inter);

            if (!titulo.id_inter) {
                resumo.sem_id_inter++;
                continue;
            }

            try {

                const resultado = await sincronizarCodigoInter(
                    titulo.id_inter,
                    token
                );

                if (resultado.sucesso) {

    resumo.atualizados++;

} else {

    resumo.erros++;

    console.error("[AUTO] Título não sincronizado:");
    console.error("       id_inter:", resultado.id_inter);
    console.error("       seu_numero:", resultado.seu_numero);
    console.error("       motivo:", resultado.motivo);

}

            } catch (erro) {

    resumo.erros++;

    console.error("[AUTO] Erro inesperado");
    console.error("       id_inter:", titulo.id_inter);
    console.error("       seu_numero:", titulo.seu_numero);
    console.error("       erro:", erro.message);

}

        }

        console.log("[AUTO] Total de títulos:", resumo.total_titulos);
        console.log("[AUTO] Atualizados:", resumo.atualizados);
        console.log("[AUTO] Sem id_inter:", resumo.sem_id_inter);
        console.log("[AUTO] Erros:", resumo.erros);

    } catch (erro) {

        console.error("[AUTO] Falha geral:", erro);

    }

    console.log("========== FIM SINCRONIZAÇÃO AUTOMÁTICA ==========");

}

function dentroHorarioComercial() {

    const agora = new Date();

    const hora = agora.getHours();

    return hora >= 8 && hora < 19;

}

async function executarEspelhamentoAutomatico() {

    if (!dentroHorarioComercial()) {
        return;
    }

    console.log("[AUTO] Iniciando espelhamento Banco Inter...");

    try {

        await sincronizacaoAutomatica();

        console.log("[AUTO] Espelhamento concluído.");

    } catch (erro) {

        console.error("[AUTO] Erro:", erro);

    }

}

function agendarProximaExecucao() {

    const agora = new Date();

    const proxima = new Date(agora);

    proxima.setSeconds(0);
    proxima.setMilliseconds(0);

    const minuto = proxima.getMinutes();

    let proximoMultiplo = Math.ceil((minuto + 1) / 10) * 10;

    if (proximoMultiplo === 60) {

        proxima.setHours(proxima.getHours() + 1);
        proxima.setMinutes(0);

    } else {

        proxima.setMinutes(proximoMultiplo);

    }

    if (proxima <= agora) {
        proxima.setMinutes(proxima.getMinutes() + 10);
    }

    const espera = proxima.getTime() - agora.getTime();

    console.log("[AUTO] Próxima sincronização às", proxima.toLocaleTimeString("pt-BR"));

    setTimeout(async () => {

        await executarEspelhamentoAutomatico();

        agendarProximaExecucao();

    }, espera);

}

agendarProximaExecucao();

app.listen(PORT, () => log("Servidor iniciado", { porta: PORT }));
