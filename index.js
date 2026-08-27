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

console.log("DETALHE INTER:");
console.log(JSON.stringify(json, null, 2));

return json;

}



async function cancelarCobrancaInter(idInter, motivo = "Reemissão de cobrança") {

    const { json } = await requisicaoInter({

        path: `/cobranca/v3/cobrancas/${encodeURIComponent(idInter)}/cancelar`,

        method: "POST",

        body: JSON.stringify({

            motivoCancelamento: motivo

        })

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

        case "CANCELADO":
            return "CANCELADO";

        case "VENCIDO":
        case "EXPIRADO":
            return "VENCIDO";

        case "ATRASADO":
            return "ATRASADO";

        case "A_RECEBER":
        case "EM_PROCESSAMENTO":
            return "ABERTO";

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
    let guid_responsavel = null;
    let id_mensalidade = null;

    const seuNumero = String(cobranca.seuNumero || "")
        .trim()
        .toUpperCase();

    // ======================================================
    // 1 - BOLETOS GERADOS PELO ERP
    // ======================================================

    if (seuNumero.startsWith("ERP|")) {

        const partes = seuNumero.split("|");

        id_mensalidade = partes[1] || null;
        guid_aluno = partes[2] || null;
        competencia = partes[3] || null;

    }

    // ======================================================
    // 2 - BOLETOS MANUAIS
    // ======================================================

    else {

        const meses = {
            JANEIRO: "01",
            FEVEREIRO: "02",
            MARCO: "03",
            MARÇO: "03",
            ABRIL: "04",
            MAIO: "05",
            JUNHO: "06",
            JULHO: "07",
            AGOSTO: "08",
            SETEMBRO: "09",
            OUTUBRO: "10",
            NOVEMBRO: "11",
            DEZEMBRO: "12"
        };

        // AGOSTO/26
        let m = seuNumero.match(/^([A-ZÇÃ]+)[\/\-](\d{2})$/);

        if (m && meses[m[1]]) {

            competencia = `${meses[m[1]]}/20${m[2]}`;

        }

        // 08/2026
        if (!competencia) {

            m = seuNumero.match(/^(\d{1,2})[\/\-](\d{4})$/);

            if (m) {

                competencia =
                    `${String(m[1]).padStart(2, "0")}/${m[2]}`;

            }

        }

        // ÚLTIMA CAMADA: DATA DE VENCIMENTO
        if (!competencia && cobranca.dataVencimento) {

            const partes = cobranca.dataVencimento.split("-");

            if (partes.length === 3) {

                competencia =
                    `${partes[1]}/${partes[0]}`;

            }

        }

    }

    if (competencia) {

        const [mes, ano] = competencia.split("/");

        competencia_mes = Number(mes);
        competencia_ano = Number(ano);

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
        valor_final:
            valorOriginal == null
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

async function listarTodasCobrancasInter() {

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

    console.log("SALVAR TITULO RECEBEU:");
console.log({
    id_mensalidade: dados.id_mensalidade,
    guid_aluno: dados.guid_aluno,
    guid_responsavel: dados.guid_responsavel
});

    const { data: existente, error } = await supabase
        .from("financeiro_titulos")
        .select("*")
        .eq("id_inter", dados.id_inter)
        .maybeSingle();

    if (error) throw error;

    if (!dados.guid_aluno && dados.cpf_responsavel) {

    const cpf = String(dados.cpf_responsavel).replace(/\D/g, "");

    const { data: aluno } = await supabase
        .from("alunos_master")
        .select("guid,guid_responsavel")
        .or(
            `responsavel_cpf.eq.${cpf},responsavel2_cpf.eq.${cpf},cpf.eq.${cpf},cpf_aluno.eq.${cpf}`
        )
        .maybeSingle();

    if (aluno) {

        dados.guid_aluno = aluno.guid;
        dados.guid_responsavel = aluno.guid_responsavel;

        if (dados.competencia) {

            const { data: mensalidade } = await supabase
                .from("mensalidades")
                .select("id_mensalidade")
                .eq("guid_aluno", aluno.guid)
                .eq("competencia", dados.competencia)
                .maybeSingle();

            if (mensalidade) {
                dados.id_mensalidade = mensalidade.id_mensalidade;
            }

        }

    }

}

    const registro = {

    ...(existente || {}),

    ...dados,

    guid_aluno: dados.guid_aluno ?? existente?.guid_aluno ?? null,

    guid_responsavel: dados.guid_responsavel ?? existente?.guid_responsavel ?? null,

    id_mensalidade: dados.id_mensalidade ?? existente?.id_mensalidade ?? null,

    competencia: dados.competencia ?? existente?.competencia ?? null,

    competencia_mes: dados.competencia_mes ?? existente?.competencia_mes ?? null,

    competencia_ano: dados.competencia_ano ?? existente?.competencia_ano ?? null,

    ultima_sincronizacao: new Date().toISOString()

};
    let tituloSalvo;

    if (existente) {

const { data, error: erroUpdate } = await supabase
    .from("financeiro_titulos")
    .update(registro)
    .eq("id", existente.id)
    .select()
    .single();

if (erroUpdate) throw erroUpdate;
        tituloSalvo = data;

    } else {

const { data, error: erroInsert } = await supabase
    .from("financeiro_titulos")
    .insert(registro)
    .select()
    .single();

if (erroInsert) throw erroInsert;
        tituloSalvo = data;

    }

    await reconciliarTitulo(tituloSalvo);

if (tituloSalvo.id_mensalidade) {
    await sincronizarMensalidadeComTitulo(tituloSalvo);
}

    return tituloSalvo;

}

async function reconciliarTitulo(titulo) {

    if (titulo.guid_aluno && titulo.id_mensalidade)
        return titulo;

    const cpf = String(titulo.cpf_responsavel || "").replace(/\D/g, "");

    if (!cpf)
        return titulo;

    const { data: aluno } = await supabase
        .from("alunos_master")
        .select("guid,guid_responsavel")
        .or(`responsavel_cpf.eq.${cpf},responsavel2_cpf.eq.${cpf},cpf.eq.${cpf},cpf_aluno.eq.${cpf}`)
        .maybeSingle();

    if (!aluno)
        return titulo;

    let consulta = supabase
    .from("mensalidades")
    .select("id_mensalidade,competencia,competencia_mes,competencia_ano,vencimento")
    .eq("guid_aluno", aluno.guid);

if (titulo.competencia) {

    consulta = consulta.eq("competencia", titulo.competencia);

} else if (titulo.vencimento) {

    consulta = consulta.eq("vencimento", titulo.vencimento);

}

const { data: mensalidade } =
    await consulta.maybeSingle();

    if (!mensalidade)
        return titulo;

    const { data } = await supabase
        .from("financeiro_titulos")
        .update({

            guid_aluno: aluno.guid,
            guid_responsavel: aluno.guid_responsavel,

            id_mensalidade: mensalidade.id_mensalidade,

            competencia: mensalidade.competencia,
            competencia_mes: mensalidade.competencia_mes,
            competencia_ano: mensalidade.competencia_ano

        })
        .eq("id", titulo.id)
        .select()
        .single();

    return data || titulo;

}

async function sincronizarMensalidadeComTitulo(titulo) {

    if (!titulo?.id_mensalidade)
        return;

    const { error } = await supabase
        .from("mensalidades")
        .update({

            id_titulo: titulo.id,

            id_inter: titulo.id_inter,

            status: titulo.status,

            status_inter: titulo.status_inter,

            nosso_numero: titulo.nosso_numero,

            seu_numero: titulo.seu_numero,

            linha_digitavel: titulo.linha_digitavel,

            codigo_barras: titulo.codigo_barras,

            codigo_pix: titulo.codigo_pix,

            pix_copia_cola: titulo.pix_copia_cola,

            url_pdf_boleto: titulo.url_pdf_boleto,

            forma_pagamento: titulo.forma_pagamento,
            
            data_pagamento: titulo.data_pagamento,
            
           
            data_atualizacao: new Date().toISOString()

        })
        .eq("id_mensalidade", titulo.id_mensalidade);

    if (error)
        throw error;

}

async function sincronizarBoletos() {

    log("Iniciando sincronização...");

const { token, cobrancas } = await listarCobrancasInter();

console.log("ENTROU SINCRONIZAR");
console.log("TOKEN:", !!token);
console.log("TOTAL:", cobrancas.length);

    console.log("TOTAL COBRANCAS:", cobrancas.length);

    let novos = 0;
    let atualizados = 0;

    for (const item of cobrancas) {

        try {

            console.log("PROCESSANDO:", item.cobranca.codigoSolicitacao);

            const codigo = item.cobranca.codigoSolicitacao;

            console.log("VAI CONSULTAR:", codigo);

            const detalhe = await consultarCobranca(codigo, token);

            console.log("CONSULTOU:", codigo);

let dados = dadosTitulo(detalhe);

if (!dados.guid_aluno && dados.cpf_responsavel) {

    const cpf = String(dados.cpf_responsavel).replace(/\D/g, "");

    const { data: aluno } = await supabase
        .from("alunos_master")
        .select("guid,guid_responsavel")
        .or(
            `responsavel_cpf.eq.${cpf},responsavel2_cpf.eq.${cpf},cpf.eq.${cpf},cpf_aluno.eq.${cpf}`
        )
        .maybeSingle();

    if (aluno) {

        dados.guid_aluno = aluno.guid;
        dados.guid_responsavel = aluno.guid_responsavel;

        if (dados.competencia) {

            const { data: mensalidade } = await supabase
                .from("mensalidades")
                .select("id_mensalidade")
                .eq("guid_aluno", aluno.guid)
                .eq("competencia", dados.competencia)
                .maybeSingle();

            if (mensalidade) {
                dados.id_mensalidade = mensalidade.id_mensalidade;
            }

        }

    }

}

const titulo = await salvarTitulo(dados);

const tituloFinal = await reconciliarTitulo(titulo);

await sincronizarMensalidadeComTitulo(tituloFinal);

            atualizados++;

        } catch (erro) {

            console.error("ERRO AO PROCESSAR:", item.cobranca.codigoSolicitacao);
            console.error(erro);

        }

    }

    log(`Sincronização concluída. Atualizados: ${atualizados}`);

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

async function montarDadosBoleto(idTitulo) {

    const { data: titulo, error: erroTitulo } = await supabase
        .from("financeiro_titulos")
        .select("*")
        .eq("id", idTitulo)
        .single();

    if (erroTitulo || !titulo)
        throw new Error("Título não encontrado.");

    const { data: aluno, error: erroAluno } = await supabase
        .from("alunos_master")
        .select("*")
        .eq("guid", titulo.guid_aluno)
        .single();

    if (erroAluno || !aluno)
        throw new Error("Aluno não encontrado.");

    return {

        idMensalidade: titulo.id_mensalidade,

        guidAluno: titulo.guid_aluno,

        guidResponsavel: titulo.guid_responsavel,

        id_inter: titulo.id_inter,

        observacoes: titulo.observacao,

        numero_reemissao: (titulo.numero_reemissao || 1) + 1,

        id_titulo_anterior: titulo.id,

        motivo_reemissao: null,

        responsavel: aluno.responsavel,

        responsavel_cpf: aluno.responsavel_cpf,

        responsavel_endereco: aluno.responsavel_endereco,

        responsavel_numero: aluno.responsavel_numero,

        responsavel_bairro: aluno.responsavel_bairro,

        responsavel_cidade: aluno.responsavel_cidade,

        responsavel_uf: aluno.responsavel_uf,

        responsavel_cep: aluno.responsavel_cep,

        whatsapp:
            aluno.responsavel_telefone ||
            aluno.telefone,

        valorOriginal: titulo.valor_original,

        valorDesconto: titulo.valor_desconto,

        valorFinal: titulo.valor_final,

        vencimento: titulo.vencimento,

        competencia: titulo.competencia,

        formaPagamento: titulo.forma_pagamento || "BOLETO"

    };

}

async function gerarBoletoInterno(dados) {

const {
    idMensalidade,
    guidAluno,
    guidResponsavel,

    responsavel,
    responsavel_cpf,
    responsavel_endereco,
    responsavel_numero,
    responsavel_bairro,
    responsavel_cidade,
    responsavel_uf,
    responsavel_cep,

    whatsapp,

    valorOriginal,
    valorDesconto,
    valorFinal,

    vencimento,
    competencia,

    formaPagamento

} = dados;


const id_mensalidade = idMensalidade;
const guid_aluno = guidAluno;
const guid_responsavel = guidResponsavel;

const cpfCnpj = responsavel_cpf;
const nome = responsavel;
const endereco = responsavel_endereco;
const numero = responsavel_numero;
const bairro = responsavel_bairro;
const cidade = responsavel_cidade;
const uf = String(responsavel_uf || "").replace("BR-", "");
const cep = responsavel_cep;

const valorOriginalNumerico = Number(valorOriginal || 0);
const valorDescontoNumerico = Number(valorDesconto || 0);
const valorFinalNumerico = Number(valorFinal || 0);

const valorNominal = valorOriginalNumerico;

let dataVencimento = vencimento;

const hoje = new Date();
hoje.setHours(0,0,0,0);

const vencimentoData = new Date(dataVencimento);

if (vencimentoData < hoje) {

    vencimentoData.setMonth(vencimentoData.getMonth() + 1);

    dataVencimento =
        `${vencimentoData.getFullYear()}-` +
        `${String(vencimentoData.getMonth() + 1).padStart(2,"0")}-` +
        `${String(vencimentoData.getDate()).padStart(2,"0")}`;

}

const documento = String(cpfCnpj || "").replace(/\D/g, "");

    const corpo = JSON.stringify({

        seuNumero: `ERP|${id_mensalidade}|${guid_aluno}|${competencia}`,

        valorNominal: valorOriginalNumerico,

        dataVencimento,

        numDiasAgenda: 30,

        multa: {
            codigo: "PERCENTUAL",
            taxa: 2
        },

        mora: {
            codigo: "TAXAMENSAL",
            taxa: 1
        },

        desconto:
    valorDescontoNumerico > 0
        ? {
            codigo: "VALORFIXODATAINFORMADA",
            quantidadeDias: 0,
            valor: valorDescontoNumerico
        }
        : undefined,

        pagador: {

            cpfCnpj: documento,

            tipoPessoa:
                documento.length === 14
                    ? "JURIDICA"
                    : "FISICA",

            nome,

            endereco,

            cidade,

            uf: String(uf || "").replace("-",""),

            cep

        }

    });

console.log({
    valorOriginalNumerico,
    valorDescontoNumerico,
    dataVencimento
});

const emissao = await requisicaoInter({

    path: "/cobranca/v3/cobrancas",

    method: "POST",

    body: corpo

});

    if (!emissao.json.codigoSolicitacao) {

        throw new Error(
            "Banco Inter não retornou o código da cobrança."
        );

    }

    const codigo = emissao.json.codigoSolicitacao;

    const detalhe = await consultarCobranca(
        codigo,
        emissao.token
    );

    const dadosTituloGerado = dadosTitulo(detalhe);

    const [mes, ano] = competencia.split("/");

    console.log("ANTES DE SALVAR:");
console.log({
    id_mensalidade,
    guid_aluno,
    guid_responsavel
});
    
    const titulo = await salvarTitulo({

    ...dadosTituloGerado,

    origem: "ERP",

    id_mensalidade,

    guid_aluno,

    guid_responsavel,

    competencia,

    competencia_mes: Number(mes),

    competencia_ano: Number(ano),

    numero_reemissao: dados.numero_reemissao,

    id_titulo_anterior: dados.id_titulo_anterior,

    motivo_reemissao: dados.motivo_reemissao

});

if (titulo.id_mensalidade) {
    await sincronizarMensalidadeComTitulo(titulo);
}

return titulo;

}

// ======================================================
// INICIALIZAÇÃO
// ======================================================

app.post("/gerar-boleto", async (req, res) => {

    try {

        const dados = await gerarBoletoInterno(req.body);

        res.json({

            sucesso: true,

            dados

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
// GERAÇÃO EM LOTE DAS COBRANÇAS
// ======================================================

app.post("/api/cobrancas/gerar", async (req, res) => {

    try {

        console.log("PASSO 1");

        const competencia = req.body.competencia;
        await gerarMensalidades(competencia);
        console.log("PASSO 2");
        const ids = req.body.idsMensalidades || [];

        const lista = await listarPendentesGeracao(competencia);
        console.log("PASSO 3", lista.length);

        const listaGeracao =
            ids.length === 0
                ? lista
                : lista.filter(item =>
                      ids.includes(item.idMensalidade)
                  );
        
        let geradas = 0;
        let erros = 0;
        
        const resultado = [];


for (const item of listaGeracao) {
console.log("PASSO 4", listaGeracao.length);

            try {

                item.seuNumero = item.idMensalidade;

                const resposta = await gerarBoletoInterno(item);

                resultado.push({

                    aluno: item.aluno,

                    sucesso: true,

                    dados: resposta

                });

                geradas++;

} catch (erro) {

    console.error("===== ERRO BOLETO =====");
    console.error(erro);

    if (erro instanceof Error) {
        console.error("MESSAGE:", erro.message);
        console.error("STACK:", erro.stack);
    }

    if (erro.response) {
        console.error("RESPONSE:");
        console.error(erro.response.data);
    }

    resultado.push({
        aluno: item.aluno,
        sucesso: false,
        erro: erro instanceof Error ? erro.message : String(erro)
    });

    erros++;
}

        }

        res.json({

            sucesso: true,

            competencia,

            total: listaGeracao.length,

            geradas,

            erros,

            resultado

        });

    } catch (erro) {

    console.error("========== ERRO GERAÇÃO ==========");
    console.error(erro);
    console.error(erro.stack);

    res.status(500).json({
        sucesso: false,
        erro: erro.message
    });

}

});

// ======================================================
// REEMISSÃO DE COBRANÇA
// ======================================================

app.post("/api/cobrancas/reemitir", async (req, res) => {

    try {

const {

    idTitulo,

    newDueDate,

    discount,

    reason

} = req.body;

const dados = await montarDadosBoleto(idTitulo);

dados.motivo_reemissao = reason;

await cancelarCobrancaInter(

    dados.id_inter,

    reason || "Reemissão de cobrança"

);

await supabase
.from("financeiro_titulos")
.update({

    status: "CANCELADO",

    status_inter: "CANCELADO",

    ativo: false,

    data_cancelamento: new Date().toISOString(),

    ultima_sincronizacao: new Date().toISOString()

})
.eq("id", dados.id_titulo_anterior);

dados.vencimento = newDueDate;

dados.valorDesconto = Number(discount || 0);

dados.valorFinal =
    Number(dados.valorOriginal) -
    Number(dados.valorDesconto);

const novoTitulo = await gerarBoletoInterno(dados);

await sincronizarMensalidadeComTitulo(novoTitulo);

res.json({

    sucesso: true,

    titulo: novoTitulo

});

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

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

}catch (erro) {

    console.error("========== REEMISSÃO ==========");
    console.error(erro);

    if (erro.response) {
        console.error("STATUS:", erro.response.status);
        console.error("DADOS:", erro.response.data);
    }

    console.error("===============================");

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

// ===========================================
// ANÁLISE DAS COBRANÇAS
// ======================

async function gerarMensalidades(competencia) {

    const [mes, ano] = competencia.split("/");

    const { data: alunos, error } =
        await supabase
            .from("alunos_master")
            .select("*")
            .eq("status", "ATIVO");

    if (error)
        throw error;

    for (const aluno of alunos) {

        const { data: existente } =
            await supabase
                .from("mensalidades")
                .select("id_mensalidade")
                .eq("guid_aluno", aluno.guid)
                .eq("competencia", competencia)
                .maybeSingle();

if (existente)
    continue;

const diaVencimento = Number(aluno.dia_vencimento || 5);

const { error: erroInsert } = await supabase
    .from("mensalidades")
    .insert({
        id_mensalidade: crypto.randomUUID(),

        guid_aluno: aluno.guid,
        guid_responsavel: aluno.guid_responsavel,
        id_aluno: aluno.id_aluno,

        aluno: aluno.nome,
        responsavel: aluno.responsavel,

        curso: aluno.cursos,

        competencia,
        competencia_mes: Number(mes),
        competencia_ano: Number(ano),

        valor_original: aluno.valor_curso,
        valor_desconto: aluno.valor_desconto,
        valor_final: aluno.valor_final,

        vencimento: `${ano}-${mes}-${String(diaVencimento).padStart(2, "0")}`,

        status: "PENDENTE",
        origem: "ERP"
    });

if (erroInsert)
    throw erroInsert;

    }

}

async function listarCobrancasInter(competencia) {

    const { cobrancas } = await listarTodasCobrancasInter();

    return (cobrancas || []).filter(item => {

        const seuNumero = String(
            item?.cobranca?.seuNumero || ""
        );

        console.log(seuNumero);
        return true;

    });

}

app.get("/api/cobrancas/analisar", async (req, res) => {

    try {

        const competencia = req.query.competencia;

        const cobrancasInter = await listarCobrancasInter(competencia);

        await gerarMensalidades(competencia);

        const mensalidades = await supabase
            .from("mensalidades")
            .select(`
                id_mensalidade,
                competencia,
                valor_final,
                id_titulo,
                alunos_master(
                    nome,
                    responsavel
                )
            `)
            .eq("competencia", competencia);

        if (mensalidades.error) {
            throw mensalidades.error;
        }

        const lista = (mensalidades.data || []).map(item => ({

            idMensalidade: item.id_mensalidade,

            aluno: item.alunos_master?.nome || "",

            responsavel: item.alunos_master?.responsavel || "",

            competencia: item.competencia,

            valorFinal: Number(item.valor_final || 0),

            gerado: cobrancasInter.some(c =>
                String(c.seuNumero || "").includes(item.id_mensalidade)
            ),

            situacao: item.id_titulo ? "GERADO" : "GERAR"

        }));

        const pendentes = lista.filter(x => !x.gerado);

        res.json({

            sucesso: true,

            mensalidades: lista.length,

            existentes: lista.length - pendentes.length,

            pendentes: pendentes.length,

            lista: pendentes

        });

    }

    catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

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

        const { data: titulos, error: erroTitulos } = await supabase
            .from("financeiro_titulos")
            .select("*");

        if (erroTitulos) throw erroTitulos;

        let atualizados = 0;

        for (const titulo of titulos) {

            if (!titulo.guid_aluno) continue;
            if (!titulo.competencia) continue;

            const { data: mensalidade } = await supabase
                .from("mensalidades")
                .select(`
                    id_mensalidade,
                    guid_responsavel,
                    competencia_mes,
                    competencia_ano
                `)
                .eq("guid_aluno", titulo.guid_aluno)
                .eq("competencia", titulo.competencia)
                .maybeSingle();

            if (!mensalidade) continue;

            const { error } = await supabase
                .from("financeiro_titulos")
                .update({

                    id_mensalidade: mensalidade.id_mensalidade,
                    guid_responsavel: mensalidade.guid_responsavel,

                    competencia: titulo.competencia,
                    competencia_mes: mensalidade.competencia_mes,
                    competencia_ano: mensalidade.competencia_ano

                })
                .eq("id", titulo.id);

            if (error) throw error;

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


app.get("/api/sincronizar-boletos", async (req, res) => {

    try {

        const resultado = await sincronizarBoletos();

        res.json({
            sucesso: true,
            ...resultado
        });

    } catch (e) {

        console.error(e);

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
