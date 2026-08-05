const express = require("express");
const https = require("https");
const fs = require("fs");
const querystring = require("querystring");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
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

    return {

        origem: "INTER",

        id_inter: cobranca.codigoSolicitacao,
        seu_numero: cobranca.seuNumero,
        nosso_numero: boleto.nossoNumero,

        status_inter: cobranca.situacao,
        status: statusInterno(cobranca.situacao),

        vencimento: cobranca.dataVencimento,
        data_pagamento: cobranca.dataSituacao,

        valor_original: valorOriginal,
        valor_desconto: valorDesconto,
        valor_final: valorOriginal === null
            ? null
            : valorOriginal - valorDesconto,

        valor_recebido: numero(cobranca.valorTotalRecebido),

        linha_digitavel: boleto.linhaDigitavel,
        codigo_barras: boleto.codigoBarras,

        codigo_pix: pix.txid,
        pix_copia_cola: pix.pixCopiaECola,
        qr_code_pix: pix.imagemQrcode,

        url_pdf_boleto: detalhe.pdf
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

    ultima_sincronizacao: new Date().toISOString()

};

    if (existente) {

        const { error: erroUpdate } = await supabase
            .from("financeiro_titulos")
            .update(registro)
            .eq("id", existente.id);

        if (erroUpdate) throw erroUpdate;

        return "atualizado";
    }

    const { error: erroInsert } = await supabase
        .from("financeiro_titulos")
        .insert(registro);

    if (erroInsert) throw erroInsert;

    return "novo";

}

async function sincronizarBoletos() {

    log("Iniciando sincronização...");

    const { token, cobrancas } = await listarCobrancasInter();

    let novos = 0;
    let atualizados = 0;

    for (const item of cobrancas) {

        const codigo = item.cobranca.codigoSolicitacao;

        const detalhe = await consultarCobranca(codigo, token);

        const resultado = await salvarTitulo(
            dadosTitulo(detalhe)
        );

        if (resultado === "novo")
            novos++;
        else
            atualizados++;

    }

    log(`Sincronização concluída. Novos: ${novos} | Atualizados: ${atualizados}`);

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

async function gerarMensalidades() {

    const { competencia, mes, ano } = competenciaAtual();

    const { data: alunos, error } = await supabase
        .from("alunos_master")
        .select("guid,guid_responsavel,id_aluno,nome,responsavel")
        .eq("status", "ATIVO");

    if (error) throw error;

    let criadas = 0;

    for (const aluno of alunos) {

        const { data: existe, error: erroBusca } = await supabase
            .from("mensalidades")
            .select("id_mensalidade")
            .eq("guid_aluno", aluno.guid)
            .eq("competencia_mes", mes)
            .eq("competencia_ano", ano)
            .maybeSingle();

        if (erroBusca) throw erroBusca;

        if (existe) continue;

        const { error: erroInsert } = await supabase
            .from("mensalidades")
            .insert({

                id_mensalidade: randomUUID(),

                guid_aluno: aluno.guid,
                guid_responsavel: aluno.guid_responsavel,
                id_aluno: aluno.id_aluno,

                aluno: aluno.nome,
                responsavel: aluno.responsavel,

                competencia,
                competencia_mes: mes,
                competencia_ano: ano,

                status: "ABERTO",

                criado_em: new Date().toISOString()

            });

        if (erroInsert) throw erroInsert;

        criadas++;

    }

    return criadas;

}
// ======================================================
// SINCRONIZAÇÃO AUTOMÁTICA
// ======================================================

async function sincronizacaoAutomatica() {

    log("=======================================");
    log("Sincronização iniciada");

    try {

const resumo = await sincronizarBoletos();

await gerarMensalidades();

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

        const corpo = JSON.stringify({

seuNumero: `MENS-${id_mensalidade}`,

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

await salvarTitulo({

    ...dados,

    origem: "ERP",

    id_mensalidade,

    guid_aluno,

    guid_responsavel

});

const { error: erroMensalidade } = await supabase
    .from("mensalidades")
    .update({

        id_inter: dados.id_inter,

        status_inter: dados.status_inter,

        status: dados.status,

        valor_original: dados.valor_original,

        valor_desconto: Number(valorDesconto || 0),
        
        valor_final: Number(valorNominal) - Number(valorDesconto || 0),
        
        vencimento: dados.vencimento,

        nosso_numero: dados.nosso_numero,

        seu_numero: dados.seu_numero,

        linha_digitavel: dados.linha_digitavel,

        codigo_barras: dados.codigo_barras,

        codigo_pix: dados.codigo_pix,

        pix_copia_cola: dados.pix_copia_cola,

        qr_code_pix: dados.qr_code_pix,

        url_pdf_boleto: dados.url_pdf_boleto

    })
    .eq("id_mensalidade", id_mensalidade);

    if (erroMensalidade) {
    throw erroMensalidade;
}

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

app.get("/", (req, res) => {

    res.json({
        servico: "Banco Inter",
        status: "ONLINE"
    });

});

app.listen(PORT, async () => {

    log(`Servidor iniciado na porta ${PORT}`);

    await executarEspelhamentoAutomatico();

    agendarProximaExecucao();

});
