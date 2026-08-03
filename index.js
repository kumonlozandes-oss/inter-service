const express = require("express");
const https = require("https");
const fs = require("fs");
const querystring = require("querystring");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const financeiroRoutes = require("./routes/financeiro");
const interRoutes = require("./routes/inter");
const webhookRoutes = require("./routes/webhook");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/financeiro", financeiroRoutes);
app.use("/inter", interRoutes);
app.use("/webhook", webhookRoutes);

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

        const req = https.request(options, res => {

            let dados = "";

            res.on("data", chunk => {

                dados += chunk;

            });

            res.on("end", () => {

                resolve({

                    status: res.statusCode || 500,

                    body: dados

                });

            });

        });

        req.on("error", reject);

        if (body) {

            req.write(body);

        }

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

function hojeISO() {

    return new Date().toISOString().slice(0, 10);

}

function data50Dias() {

    const data = new Date();

    data.setDate(data.getDate() - 50);

    return data.toISOString().slice(0, 10);

}

function ultimoDiaMesSeguinte() {

    const hoje = new Date();

    return new Date(

        hoje.getFullYear(),

        hoje.getMonth() + 2,

        0

    ).toISOString().slice(0, 10);

}

function statusInterno(statusInter) {

    if (statusInter === "RECEBIDO") return "PAGO";

    if (statusInter === "VENCIDO") return "VENCIDO";

    if (statusInter === "CANCELADO") return "CANCELADO";

    return "ABERTO";

}

function numero(valor) {

    if (valor === null || valor === undefined || valor === "") {

        return null;

    }

    const n = Number(valor);

    return Number.isFinite(n) ? n : null;

}

function dadosTitulo(detalhe) {

    const cobranca = detalhe.cobranca || {};

    const boleto = detalhe.boleto || {};

    const pix = detalhe.pix || {};

    return {

        id_inter: cobranca.codigoSolicitacao,

        seu_numero: cobranca.seuNumero,

        nosso_numero: boleto.nossoNumero,

        status_inter: cobranca.situacao,

        status: statusInterno(cobranca.situacao),

        vencimento: cobranca.dataVencimento,

        data_pagamento: cobranca.dataSituacao,

        valor_original: numero(cobranca.valorNominal),

        valor_recebido: numero(cobranca.valorTotalRecebido),

        linha_digitavel: boleto.linhaDigitavel,

        codigo_barras: boleto.codigoBarras,

        codigo_pix: pix.txid,

        pix_copia_cola: pix.pixCopiaECola,

        qr_code_pix: pix.imagemQrcode,

        url_pdf_boleto: detalhe.pdf

    };

}

// ======================================================
// BUSCA PAGINADA DOS BOLETOS NO BANCO INTER
// ======================================================

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

        const lista = json.cobrancas || [];

        for (const item of lista) {

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

// ======================================================
// UPSERT EM FINANCEIRO_TITULOS
// ======================================================

async function salvarTitulo(dados) {

    const { data: existente, error } = await supabase

        .from("financeiro_titulos")

        .select("*")

        .eq("id_inter", dados.id_inter)

        .maybeSingle();

    if (error) throw error;

    if (existente) {

        const { error: erroUpdate } = await supabase

            .from("financeiro_titulos")

            .update({

                seu_numero: dados.seu_numero,

                nosso_numero: dados.nosso_numero,

                status: dados.status,

                status_inter: dados.status_inter,

                vencimento: dados.vencimento,

                data_pagamento: dados.data_pagamento,

                valor_original: dados.valor_original,

                valor_recebido: dados.valor_recebido,

                linha_digitavel: dados.linha_digitavel,

                codigo_barras: dados.codigo_barras,

                codigo_pix: dados.codigo_pix,

                pix_copia_cola: dados.pix_copia_cola,

                qr_code_pix: dados.qr_code_pix,

                url_pdf_boleto: dados.url_pdf_boleto,

                ultima_sincronizacao: new Date().toISOString()

            })

            .eq("id", existente.id);

        if (erroUpdate) throw erroUpdate;

        return "atualizado";

    }

    const { error: erroInsert } = await supabase

        .from("financeiro_titulos")

        .insert({

            ...dados,

            ultima_sincronizacao: new Date().toISOString()

        });

    if (erroInsert) throw erroInsert;

    return "novo";

}

// ======================================================
// IMPORTAÇÃO / ESPELHAMENTO
// ======================================================

async function sincronizarBoletos() {

    log("Iniciando sincronização...");

    const { token, cobrancas } = await listarCobrancasInter();

    let novos = 0;

    let atualizados = 0;

    for (const item of cobrancas) {

        const codigo = item.cobranca.codigoSolicitacao;

        const detalhe = await consultarCobranca(

            codigo,

            token

        );

        const dados = dadosTitulo(detalhe);

        const resultado = await salvarTitulo(dados);

        if (resultado === "novo") {

            novos++;

        } else {

            atualizados++;

        }

    }

    log(

        `Sincronização concluída. Novos: ${novos} | Atualizados: ${atualizados}`

    );

    return {

        total: cobrancas.length,

        novos,

        atualizados

    };

}

// ======================================================
// ENDPOINT MANUAL
// ======================================================

app.get("/sincronizar-boletos", async (req, res) => {

    try {

        const resumo = await sincronizarBoletos();

        res.json({

            sucesso: true,

            ...resumo

        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

});

// ======================================================
// GERAÇÃO DE MENSALIDADES
// ======================================================

function competenciaAtual() {

    const hoje = new Date();

    return {

        competencia:
            `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`,

        mes: hoje.getMonth() + 1,

        ano: hoje.getFullYear()

    };

}

app.get("/gerar-mensalidades", async (req, res) => {

    try {

        const { competencia, mes, ano } = competenciaAtual();

        const { data: alunos, error } = await supabase

            .from("alunos_master")

            .select("*")

            .eq("status", "ATIVO");

        if (error) throw error;

        let criadas = 0;

        for (const aluno of alunos) {

            const { data: existe } = await supabase

                .from("mensalidades")

                .select("id_mensalidade")

                .eq("guid_aluno", aluno.guid)

                .eq("competencia_mes", mes)

                .eq("competencia_ano", ano)

                .maybeSingle();

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

        res.json({

            sucesso: true,

            mensalidades_criadas: criadas

        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

});

// ======================================================
// SINCRONIZAÇÃO AUTOMÁTICA
// ======================================================

async function sincronizacaoAutomatica() {

    console.log("");

    console.log("=======================================");

    console.log("[AUTO] SINCRONIZAÇÃO INICIADA");

    console.log("=======================================");

    try {

        const resumo = await sincronizarBoletos();

        console.log("[AUTO] Total encontrados:", resumo.total);

        console.log("[AUTO] Novos:", resumo.novos);

        console.log("[AUTO] Atualizados:", resumo.atualizados);

    } catch (erro) {

        console.error("[AUTO]", erro);

    }

    console.log("=======================================");

    console.log("[AUTO] SINCRONIZAÇÃO FINALIZADA");

    console.log("=======================================");

    console.log("");

}

// ======================================================
// HORÁRIO DE EXECUÇÃO
// ======================================================

function dentroHorarioComercial() {

    const hora = new Date().getHours();

    return hora >= 8 && hora < 19;

}

async function executarEspelhamentoAutomatico() {

    if (!dentroHorarioComercial()) {

        return;

    }

    await sincronizacaoAutomatica();

}

// ======================================================
// AGENDADOR
// ======================================================

function agendarProximaExecucao() {

    const agora = new Date();

    const proxima = new Date(agora);

    proxima.setMilliseconds(0);

    proxima.setSeconds(0);

    let minuto = proxima.getMinutes();

    minuto = Math.ceil((minuto + 1) / 10) * 10;

    if (minuto >= 60) {

        proxima.setHours(proxima.getHours() + 1);

        proxima.setMinutes(0);

    } else {

        proxima.setMinutes(minuto);

    }

    const espera = proxima.getTime() - agora.getTime();

    console.log(

        "[AUTO] Próxima sincronização:",

        proxima.toLocaleTimeString("pt-BR")

    );

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

agendarProximaExecucao();

app.listen(PORT, () => {

    console.log("");

    console.log("=======================================");

    console.log("Servidor iniciado.");

    console.log("Porta:", PORT);

    console.log("=======================================");

    console.log("");

});

// ======================================================
// CONSULTAR UM BOLETO
// ======================================================

app.get("/consultar/:idInter", async (req, res) => {

    try {

        const token = await obterTokenInter();

        const boleto = await consultarCobranca(

            req.params.idInter,

            token

        );

        res.json(boleto);

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

});

// ======================================================
// LISTAR BOLETOS DO INTER
// ======================================================

app.get("/boletos", async (req, res) => {

    try {

        const lista = await listarCobrancasInter();

        res.json(lista.cobrancas);

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

});

// ======================================================
// RESPOSTA PADRÃO DE ERRO
// ======================================================

function responderErro(res, erro) {

    console.error("");

    console.error("================================");

    console.error("ERRO");

    console.error(erro);

    console.error("================================");

    console.error("");

    res.status(500).json({

        sucesso: false,

        erro: erro.message || String(erro)

    });

}
