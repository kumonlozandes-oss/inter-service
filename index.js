const express = require("express");
const cors = require("cors");
const https = require("https");
const fs = require("fs");
const querystring = require("querystring");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors({
    origin: "*",
    methods: ["GET","POST","PUT","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization"]
}));

app.use(express.json());
const erpRoutes = require("./routes/erp");

app.use(express.json());
app.use("/api", erpRoutes);

const PORT = process.env.PORT || 3000;

const INTER_HOST = "cdpj.partners.bancointer.com.br";

const CERT_PATH =
    process.env.INTER_CERT_PATH ||
    "/etc/secrets/inter-certificado.crt";

const KEY_PATH =
    process.env.INTER_KEY_PATH ||
    "/etc/secrets/inter-chave.key";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

function log(...msg) {
    console.log("[INTER]", ...msg);
}

function certificadosInter() {
    return {
        cert: fs.readFileSync(CERT_PATH),
        key: fs.readFileSync(KEY_PATH)
    };
}

function requisicaoHttps(options, body) {

    return new Promise((resolve, reject) => {

        const req = https.request(options, (res) => {

            let dados = "";

            res.on("data", chunk => dados += chunk);

            res.on("end", () => {

                resolve({
                    status: res.statusCode || 500,
                    body: dados
                });

            });

        });

        req.on("error", reject);

        if (body) req.write(body);

        req.end();

    });

}

function jsonSeguro(texto) {

    if (!texto) return {};

    try {
        return JSON.parse(texto);
    } catch {
        return {};
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

    const resposta = await requisicaoHttps({

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

    const json = jsonSeguro(resposta.body);

    if (!json.access_token) {
        throw new Error("Falha ao obter token do Banco Inter.");
    }

    return json.access_token;

}

async function requisicaoInter({
    path,
    method = "GET",
    body,
    token
}) {

    const acesso = token || await obterTokenInter();

    const { cert, key } = certificadosInter();

    const headers = {
        Authorization: `Bearer ${acesso}`
    };

    if (body) {

        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(body);

    }

    const resposta = await requisicaoHttps({

        hostname: INTER_HOST,
        port: 443,
        path,
        method,
        cert,
        key,
        headers

    }, body);

    const json = jsonSeguro(resposta.body);

    if (resposta.status < 200 || resposta.status >= 300) {

        const erro = new Error("Erro Banco Inter");
        erro.status = resposta.status;
        erro.resposta = json;

        throw erro;

    }

    return {
        token: acesso,
        json
    };

}

async function consultarCobranca(idInter, token) {

    const { json } = await requisicaoInter({

        path: `/cobranca/v3/cobrancas/${encodeURIComponent(idInter)}`,
        token

    });

    console.log(
    "DETALHE INTER:",
    JSON.stringify(json, null, 2)
);

return json;

}

function data50Dias() {

    const data = new Date();
    data.setDate(data.getDate() - 50);

    return data.toISOString().slice(0,10);

}

function ultimoDiaMesSeguinte() {

    const hoje = new Date();

    return new Date(
        hoje.getFullYear(),
        hoje.getMonth() + 2,
        0
    ).toISOString().slice(0,10);

}

function statusInterno(status) {

    switch (status) {

        case "RECEBIDO":
            return "PAGO";

        case "VENCIDO":
            return "VENCIDO";

        case "CANCELADO":
            return "CANCELADO";

        default:
            return "ABERTO";

    }

}

function numero(valor) {

    if (valor === null || valor === undefined || valor === "")
        return null;

    const n = Number(valor);

    return Number.isFinite(n) ? n : null;

}

function dadosTitulo(detalhe) {

    const cobranca = detalhe.cobranca || {};
    const boleto = detalhe.boleto || {};
    const pix = detalhe.pix || {};

    const descontos = Array.isArray(cobranca.descontos)
        ? cobranca.descontos
        : [];

    const valorOriginal = numero(cobranca.valorNominal);

    const valorDesconto = descontos.reduce((total, desconto) => {
        return total + (numero(desconto.valor) || 0);
    }, 0);

    let competencia = null;
    let competencia_mes = null;
    let competencia_ano = null;

    let guid_aluno = null;
    let id_mensalidade = null;

    if (cobranca.seuNumero?.startsWith("ERP|")) {

        const [
            ,
            idMensalidade,
            guidAluno,
            comp
        ] = cobranca.seuNumero.split("|");

        id_mensalidade = idMensalidade;
        guid_aluno = guidAluno;
        competencia = comp;

        if (comp) {

            const [mes, ano] = comp.split("/");

            competencia_mes = Number(mes);
            competencia_ano = Number(ano);

        }

    }

    return {

        origem: "INTER",

        id_mensalidade,

        guid_aluno,

        guid_responsavel: detalhe.guid_responsavel || null,

        cpf_responsavel: cobranca.pagador?.cpfCnpj || null,

        competencia,
        competencia_mes,
        competencia_ano,

        id_inter: cobranca.codigoSolicitacao,

        seu_numero: cobranca.seuNumero,
        nosso_numero: boleto.nossoNumero,

        status_inter: cobranca.situacao,
        status: statusInterno(cobranca.situacao),

        vencimento: cobranca.dataVencimento,
        data_emissao: cobranca.dataEmissao,
        data_pagamento: cobranca.dataSituacao,

        valor_original: valorOriginal,
        valor_desconto: valorDesconto,
        valor_final: valorOriginal === null
            ? null
            : valorOriginal - valorDesconto,

        valor_recebido: numero(cobranca.valorTotalRecebido),

        valor_multa: numero(cobranca.multa?.taxa),
        valor_juros: numero(cobranca.mora?.taxa),

        linha_digitavel: boleto.linhaDigitavel,
        codigo_barras: boleto.codigoBarras,

        codigo_pix: pix.txid,
        pix_copia_cola: pix.pixCopiaECola,
        qr_code_pix: pix.imagemQrcode,

        url_pdf_boleto: detalhe.pdf,

        json_inter: detalhe

    };

}

async function listarCobrancasInter() {

    const token = await obterTokenInter();

    const cobrancas = [];
    const codigos = new Set();

    let pagina = 0;
    let totalPaginas = 1;

    do {

        const parametros = new URLSearchParams({

            dataInicial: data50Dias(),
            dataFinal: ultimoDiaMesSeguinte(),

            filtrarDataPor: "VENCIMENTO",

            "paginacao.itensPorPagina": "1000",
            "paginacao.paginaAtual": String(pagina)

        });

        const { json } = await requisicaoInter({

            token,
            path: `/cobranca/v3/cobrancas?${parametros}`

        });

        totalPaginas = Number(json.totalPaginas || 1);

        for (const item of (json.cobrancas || [])) {

            const codigo = item?.cobranca?.codigoSolicitacao;

            if (!codigo) continue;

            if (codigos.has(codigo)) continue;

            codigos.add(codigo);

            cobrancas.push(item);

        }

        pagina++;

    } while (pagina < totalPaginas);

    log(`Boletos encontrados: ${cobrancas.length}`);

    return {
        token,
        cobrancas
    };

}
async function salvarTitulo(dados) {

    const { data: existente, error } = await supabase
        .from("financeiro_titulos")
        .select("*")
        .eq("id_inter", dados.id_inter)
        .maybeSingle();

    if (error) throw error;

    const registro = {

        ...(existente || {}),

        ...dados,

        guid_aluno: dados.guid_aluno || null,
        guid_responsavel: dados.guid_responsavel || null,

        competencia: dados.competencia || null,
        competencia_mes: dados.competencia_mes || null,
        competencia_ano: dados.competencia_ano || null,

        id_mensalidade: dados.id_mensalidade || null,

        ultima_sincronizacao: new Date().toISOString()

    };

    if (existente) {

        const { error: erroUpdate } = await supabase
            .from("financeiro_titulos")
            .update(registro)
            .eq("id", existente.id);

        if (erroUpdate) throw erroUpdate;

    } else {

        const { error: erroInsert } = await supabase
            .from("financeiro_titulos")
            .insert(registro);

        if (erroInsert) throw erroInsert;

    }

    if (dados.id_mensalidade) {

    const { error: erroTitulo } = await supabase
    .from("financeiro_titulos")
    .update({
        id_mensalidade: dados.id_mensalidade
    })
    .eq("id_inter", dados.id_inter);

if (erroTitulo) throw erroTitulo;

// Atualização da tabela mensalidades removida.
// A partir desta etapa, financeiro_titulos passa a ser a fonte
// oficial das informações do boleto.

}

    return existente ? "atualizado" : "novo";

}

async function sincronizarBoletos() {

    log("Iniciando sincronização...");

    const { token, cobrancas } = await listarCobrancasInter();

    let novos = 0;
    let atualizados = 0;

    for (const item of cobrancas) {

        const codigo = item.cobranca.codigoSolicitacao;

        const detalhe = await consultarCobranca(codigo, token);

        const dados = dadosTitulo(detalhe);

        const resultado = await salvarTitulo(dados);

        if (resultado === "novo") {
            novos++;
        } else {
            atualizados++;
        }

    }

    log(`Sincronização concluída. Novos: ${novos} | Atualizados: ${atualizados}`);

    await vincularTitulosPorCpf();

    return {
        total: cobrancas.length,
        novos,
        atualizados
    };

}


function competenciaAtual() {

    const hoje = new Date();

    return {

        competencia:
            `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`,

        mes: hoje.getMonth() + 1,

        ano: hoje.getFullYear()

    };

}


async function vincularTitulosPorCpf() {

    log("Vinculando títulos por CPF...");
    log("Buscando títulos...");

    const { data: alunos, error: erroAlunos } = await supabase
    .from("alunos_master")
    .select(`
        guid,
        guid_responsavel,
        cpf,
        responsavel_cpf,
        responsavel2_cpf,
        cpf_aluno
    `);

if (erroAlunos) throw erroAlunos;

    const { data: titulos, error } = await supabase
        .from("financeiro_titulos")
        .select(`
    id,
    cpf_responsavel,
    seu_numero,
    competencia
`)
        .is("guid_aluno", null)
        .not("cpf_responsavel", "is", null);

    if (error) throw error;

    log(`Títulos encontrados: ${titulos?.length || 0}`);

    let vinculados = 0;

    log("Iniciando processamento...");

    for (const titulo of titulos) {
        log(`CPF: ${titulo.cpf_responsavel}`);

        const cpf = String(titulo.cpf_responsavel).replace(/\D/g, "");


let aluno = null;

for (const item of (alunos || [])) {

    const cpfs = [

    item.cpf,
    item.cpf_aluno,
    item.responsavel_cpf,
    item.responsavel2_cpf

].map(c => String(c || "").replace(/\D/g, ""));

if (cpfs.some(c => c === cpf)) {

    aluno = item;
    break;

}

}

        if (!aluno) {

    const { error: erroAlerta } = await supabase
    .from("financeiro_titulos")
    .update({
        alerta_vinculo: true,
        motivo_alerta: "Não foi possível localizar o aluno automaticamente."
    })
    .eq("id", titulo.id);

if (erroAlerta) throw erroAlerta;

continue;

}

        const { error: erroUpdate } = await supabase
            .from("financeiro_titulos")

            .update({

    guid_aluno: aluno.guid,
    guid_responsavel: aluno.guid_responsavel,

    alerta_vinculo: false,
    motivo_alerta: null

})
            .eq("id", titulo.id);

        if (erroUpdate)
            throw erroUpdate;

        vinculados++;

    }

    log(`Títulos vinculados: ${vinculados}`);

    return vinculados;

}

// ======================================================
// SINCRONIZAÇÃO AUTOMÁTICA
// ======================================================

async function sincronizacaoAutomatica() {

    log("=======================================");
    log("Sincronização iniciada");

    try {

        const resumo = await sincronizarBoletos();

        log(`Total: ${resumo.total}`);
        log(`Novos: ${resumo.novos}`);
        log(`Atualizados: ${resumo.atualizados}`);

    } catch (erro) {

        console.error("[AUTO]", erro);

    }

    log("Sincronização finalizada");
    log("=======================================");

}

// ======================================================
// EXECUÇÃO AUTOMÁTICA
// ======================================================

function dentroHorarioComercial() {

    const hora = new Date().getHours();

    return hora >= 8 && hora < 19;

}

async function executarEspelhamentoAutomatico() {

    await sincronizacaoAutomatica();

}

// ======================================================
// AGENDADOR (A CADA 10 MINUTOS)
// ======================================================

function agendarProximaExecucao() {

    const agora = new Date();

    const proxima = new Date(agora);

    proxima.setSeconds(0);
    proxima.setMilliseconds(0);

    const minutos = Math.ceil((proxima.getMinutes() + 1) / 10) * 10;

    if (minutos >= 60) {

        proxima.setHours(proxima.getHours() + 1);
        proxima.setMinutes(0);

    } else {

        proxima.setMinutes(minutos);

    }

    const espera = proxima.getTime() - agora.getTime();

    log(`Próxima sincronização: ${proxima.toLocaleTimeString("pt-BR")}`);

    setTimeout(async () => {

        try {

            await executarEspelhamentoAutomatico();

        } finally {

            agendarProximaExecucao();

        }

    }, espera);

}

// ======================================================
// INICIALIZAÇÃO
// ======================================================

app.post("/gerar-boleto", async (req, res) => {

const {

    id_mensalidade,

    guid_aluno,

    guid_responsavel,

    cpfCnpj,

    nome,

    endereco,

    cidade,

    uf,

    cep,

    valorNominal,

    valorDesconto,

    dataVencimento

} = req.body;

const documento = String(cpfCnpj).replace(/\D/g, "");

    try {

        const competencia = competenciaAtual().competencia;

        const corpo = JSON.stringify({

seuNumero: `ERP|${id_mensalidade}|${guid_aluno}|${competencia}`,

valorNominal: Number(valorNominal),

dataVencimento: dataVencimento,


            numDiasAgenda: 30,

multa: {
    codigo: "PERCENTUAL",
    taxa: 2
},

mora: {
    codigo: "TAXAMENSAL",
    taxa: 1
},

descontos: [

    {
        codigo: "VALORFIXO",
        taxa: 0,
        valor: Number(valorDesconto || 0),
        data: dataVencimento
    }

],

pagador: {

    cpfCnpj: documento,

    tipoPessoa: documento.length === 14 ? "JURIDICA" : "FISICA",

    nome,

    endereco,

    cidade,

    uf,

    cep

}

        });

const emissao = await requisicaoInter({

    path: "/cobranca/v3/cobrancas",

    method: "POST",

    body: corpo

});

        if (!emissao.json.codigoSolicitacao) {

    throw new Error("Banco Inter não retornou o código da cobrança.");

}

const codigo = emissao.json.codigoSolicitacao;

const detalhe = await consultarCobranca(
    codigo,
    emissao.token
);

const dados = dadosTitulo(detalhe);

const [competenciaMes, competenciaAno] =
    competencia.split("/");

await salvarTitulo({

    ...dados,

    origem: "ERP",

    id_mensalidade,

    guid_aluno,

    guid_responsavel,

    competencia,

    competencia_mes: Number(competenciaMes),

    competencia_ano: Number(competenciaAno)

});

res.json({

    sucesso: true,

    dados

});

    } catch (erro) {

        res.status(500).json({
            sucesso: false,
            erro: erro.message
        });

    }

});

app.get("/teste-cobranca", async (req, res) => {

    try {

        const codigo = req.query.id;

        if (!codigo) {

            return res.status(400).json({
                erro: "Informe o parâmetro id."
            });

        }

        const token = await obterTokenInter();

        const detalhe = await consultarCobranca(
            codigo,
            token
        );

        res.json(detalhe);

    } catch (erro) {

        res.status(500).json({

            erro: erro.message,

            resposta: erro.resposta || null

        });

    }

});

app.get("/teste-primeiro-boleto", async (req, res) => {

    try {

        const { token, cobrancas } = await listarCobrancasInter();

        if (!cobrancas.length) {

            return res.json({
                erro: "Nenhuma cobrança encontrada."
            });

        }

        const codigo =
            cobrancas[0].cobranca.codigoSolicitacao;

        const detalhe =
            await consultarCobranca(codigo, token);

        res.json(detalhe);

    } catch (erro) {

        res.status(500).json({

            erro: erro.message,

            resposta: erro.resposta || null

        });

    }

});

app.get("/alunos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("alunos_master")
      .select("*")
      .order("nome");

    if (error) throw error;

    res.json(data);

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      sucesso: false,
      erro: erro.message
    });
  }
});

app.get("/mensalidades", async (req, res) => {

    console.log("=== CHAMOU /api/mensalidades ===");

    const { data, count, error } = await supabase
        .from("vw_mensalidades")
        .select("*", { count: "exact" });

    console.log("Erro:", error);
    console.log("Count:", count);
    console.log("Primeiro:", data?.[0]);

    if (error) {
        return res.status(500).json(error);
    }

    res.json(data);

});

app.get("/", (req, res) => {

    res.json({
        servico: "Banco Inter",
        status: "ONLINE"
    });

});
app.get("/api/sincronizar", async (req, res) => {

    try {

        const resultado = await sincronizarBoletos();

        res.json(resultado);

    } catch (e) {

        res.status(500).json({
            erro: e.message
        });

    }

});

app.get("/api/reconstruir-financeiro", async (req, res) => {

    try {

        const { data: mensalidades, error } = await supabase
            .from("mensalidades")
            .select("*");

        if (error) throw error;

        let atualizados = 0;

        for (const mensalidade of mensalidades) {

            const { error: erroUpdate } = await supabase
                .from("financeiro_titulos")
                .update({

                    id_mensalidade: mensalidade.id_mensalidade,
                    guid_aluno: mensalidade.guid_aluno,
                    guid_responsavel: mensalidade.guid_responsavel

                })
                .eq("guid_aluno", mensalidade.guid_aluno);

            if (erroUpdate) throw erroUpdate;

            atualizados++;

        }

        res.json({

            sucesso: true,

            atualizados

        });

    } catch (e) {

        console.error(e);

        res.status(500).json({

            sucesso: false,

            erro: e.message

        });

    }

});

// ===============================
// PENDÊNCIAS DE VÍNCULO
// ===============================

app.get("/api/pendencias-vinculo", async (req, res) => {

    try {

        const { data, error } = await supabase
            .from("financeiro_titulos")
            .select("*")
            .eq("alerta_vinculo", true)
            .order("vencimento");

        if (error) throw error;

        res.json(data);

    } catch (e) {

        res.status(500).json({
            sucesso: false,
            erro: e.message
        });

    }

});




app.listen(PORT, async () => {

    log(`Servidor iniciado na porta ${PORT}`);

    await executarEspelhamentoAutomatico();

    agendarProximaExecucao();

});
