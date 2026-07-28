const express = require("express");
const fs = require("fs");
const https = require("https");
const querystring = require("querystring");

const { createClient } = require("@supabase/supabase-js");

const financeiroRoutes = require("./routes/financeiro");
const interRoutes = require("./routes/inter");
const webhookRoutes = require("./routes/webhook");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use("/financeiro", financeiroRoutes);
app.use("/inter", interRoutes);
app.use("/webhook", webhookRoutes);

app.get("/", (req, res) => {
res.json({
status: "ok"
});
});

/**
 * ==========================================================
 * INFRAESTRUTURA
 * Obtém o token OAuth do Banco Inter.
 * Utilizado pelas demais rotas.
 * ==========================================================
 */

app.get("/oauth", async (req, res) => {

try {

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const postData = querystring.stringify({
  client_id: process.env.INTER_CLIENT_ID,
  client_secret: process.env.INTER_CLIENT_SECRET,
  grant_type: "client_credentials",
  scope: "boleto-cobranca.read boleto-cobranca.write"
});

const options = {
  hostname: "cdpj.partners.bancointer.com.br",
  port: 443,
  path: "/oauth/v2/token",
  method: "POST",

  cert,
  key,

  headers: {
    "Content-Type":
      "application/x-www-form-urlencoded",
    "Content-Length":
      Buffer.byteLength(postData)
  }
};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
            "end",
            () => resolve({
              status: resp.statusCode,
              body: data
            })
          );

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.write(postData);

    reqInter.end();

  });

res.json(resultado);

} catch (e) {

res.status(500).json({
  erro: String(e)
});

}

});

/**
 * ==========================================================
 * DESENVOLVIMENTO / TESTES
 * ==========================================================
 */

app.get("/teste-api", async (req, res) => {

try {

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

if (!tokenJson.body) {

  return res.json({
    erro: "OAuth retornou body vazio",
    oauth: tokenJson
  });

}

const token =
  JSON.parse(
    tokenJson.body
  ).access_token;

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

  path:
"/cobranca/v3/cobrancas?dataInicial=2026-05-01&dataFinal=2026-06-30&itensPorPagina=500",

  method: "GET",

  cert,
  key,

  headers: {
    Authorization:
      "Bearer " + token
  }

};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
  "end",
  () => resolve(
    JSON.parse(data)
  )
);

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.end();

  });

res.json(resultado);

} catch (e) {

res.status(500).json({
  erro: String(e)
});

}

});

/**
 * ==========================================================
 * OPERAÇÃO DIÁRIA
 * Emite um novo boleto no Banco Inter.
 * Atualiza financeiro_titulos e mensalidades.
 * ==========================================================
 */

app.post("/gerar-boleto", async (req, res) => {

try {

  console.log(req.body);

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

if (!tokenJson.body) {

  return res.json({
    erro: "OAuth retornou body vazio",
    oauth: tokenJson
  });

}

const oauthBody =
  JSON.parse(
    tokenJson.body
  );

const token =
  oauthBody.access_token;

if (!token) {

  return res.json({
    erro: "Access token não encontrado",
    oauth: oauthBody
  });

}

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const body = JSON.stringify({

  seuNumero: req.body.seuNumero,

  valorNominal: Number(
    req.body.valorNominal
  ),

  dataVencimento:
    req.body.dataVencimento,

  numDiasAgenda: 30,

  multa: {
    codigo: "PERCENTUAL",
    taxa: 2
  },

  mora: {
    codigo: "TAXAMENSAL",
    taxa: 1
  },

  pagador: {

    cpfCnpj:
      req.body.cpfCnpj,

    tipoPessoa:
      "FISICA",

    nome:
      req.body.nome,

    endereco:
      req.body.endereco,

    cidade:
      req.body.cidade,

    uf:
      req.body.uf,

    cep:
      req.body.cep

  }

});

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

  path:
    "/cobranca/v3/cobrancas",

  method: "POST",

  cert,
  key,

  headers: {

    Authorization:
      "Bearer " + token,

    "Content-Type":
      "application/json",

    "Content-Length":
      Buffer.byteLength(body)

  }

};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
            "end",
            () => resolve({
              status: resp.statusCode,
              body: data
            })
          );

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.write(body);

    reqInter.end();

  });

let bodyInter = {};

try {

  bodyInter = resultado.body
    ? JSON.parse(resultado.body)
    : {};

} catch (e) {

  bodyInter = {

    resposta_original: resultado.body

  };

}

const codigoSolicitacao = bodyInter.codigoSolicitacao;

const detalhe = await new Promise((resolve, reject) => {

  const reqConsulta = https.request({

    hostname: "cdpj.partners.bancointer.com.br",
    port: 443,
    path: "/cobranca/v3/cobrancas/" + codigoSolicitacao,
    method: "GET",
    cert,
    key,

    headers: {
      Authorization: "Bearer " + token
    }

  }, resp => {

    let data = "";

    resp.on("data", chunk => data += chunk);

    resp.on("end", () => {

      try {
        resolve(JSON.parse(data));
      } catch(e) {
        reject(e);
      }

    });

  });

  reqConsulta.on("error", reject);

  reqConsulta.end();

});

  console.log("status:", resultado.status);

console.log(
  "BODY INTER:",
  JSON.stringify(bodyInter, null, 2)
);

// Atualiza financeiro_titulos
await supabase
  .from("financeiro_titulos")
  .update({
    id_inter: detalhe.cobranca?.codigoSolicitacao,
    status_inter: detalhe.cobranca?.situacao,
    status: detalhe.cobranca?.situacao === "RECEBIDO" ? "PAGO" : detalhe.cobranca?.situacao,
    nosso_numero: detalhe.boleto?.nossoNumero,
    linha_digitavel: detalhe.boleto?.linhaDigitavel,
    codigo_barras: detalhe.boleto?.codigoBarras,
    pix_copia_cola: detalhe.pix?.pixCopiaECola,
    url_pdf_boleto: detalhe.pdf,
    ultima_sincronizacao: new Date().toISOString()
  })
  .eq("id", req.body.id_titulo);

// Atualiza mensalidades
await supabase
  .from("mensalidades")
  .update({
    id_inter: detalhe.cobranca?.codigoSolicitacao,
    status_inter: detalhe.cobranca?.situacao,
    STATUS: detalhe.cobranca?.situacao === "RECEBIDO" ? "PAGO" : detalhe.cobranca?.situacao,
    nosso_numero: detalhe.boleto?.nossoNumero,
    linha_digitavel: detalhe.boleto?.linhaDigitavel,
    codigo_barras: detalhe.boleto?.codigoBarras,
    pix_copia_cola: detalhe.pix?.pixCopiaECola,
    url_pdf_boleto: detalhe.pdf,
    ultima_sincronizacao: new Date().toISOString()
  })
  .eq("ID_MENSALIDADE", req.body.id_mensalidade);

return res.json({

  sucesso: resultado.status >= 200 && resultado.status < 300,

  status_http: resultado.status,

  id_mensalidade: req.body.id_mensalidade,

  guid_aluno: req.body.guid_aluno,

  guid_responsavel: req.body.guid_responsavel,

  id_inter: detalhe.cobranca?.codigoSolicitacao,

  nosso_numero: detalhe.boleto?.nossoNumero,

  seu_numero: detalhe.cobranca?.seuNumero,

  linha_digitavel: detalhe.boleto?.linhaDigitavel,

  codigo_barras: detalhe.boleto?.codigoBarras,

  codigo_pix: detalhe.pix?.txid,

  qr_code_pix: detalhe.pix?.imagemQrcode,

  pix_copia_cola: detalhe.pix?.pixCopiaECola,

  url_pdf_boleto: detalhe.pdf,

  status: detalhe.cobranca?.situacao,

  resposta_inter: detalhe

});

} catch (e) {

res.status(500).json({
  erro: String(e)
});


}

});

/**
 * ==========================================================
 * OPERAÇÃO DIÁRIA
 * Consulta um boleto no Banco Inter.
 * ==========================================================
 */

app.get("/consultar/:codigo", async (req, res) => {

try {

const codigo = req.params.codigo;

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

const token =
  JSON.parse(
    tokenJson.body
  ).access_token;

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

  path:
    "/cobranca/v3/cobrancas/" + codigo,

  method: "GET",

  cert,
  key,

  headers: {
    Authorization:
      "Bearer " + token
  }

};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
  "end",
  () => resolve(
    JSON.parse(data)
  )
);

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.end();

  });

res.json(resultado);

} catch (e) {

res.status(500).json({
  erro: String(e)
});

}

});

/**
 * ==========================================================
 * SINCRONIZA UM BOLETO
 * ==========================================================
 */
app.get("/sincronizar/:idInter", async (req, res) => {

try {

const idInter = req.params.idInter;

const consulta = await fetch(

    "https://inter-service.onrender.com/consultar/" +

    idInter

);

const retorno = await consulta.json();

const cobranca = retorno.cobranca || {};

const { data: titulo } = await supabase

.from("financeiro_titulos")

.select("*")

.eq("id_inter", idInter)

.limit(1);

if(!titulo || titulo.length === 0){

    const seuNumero = cobranca.seuNumero || "";

const { data: mensalidade } = await supabase
  .from("mensalidades")
  .select("ID_MENSALIDADE,seu_numero,COMPETENCIA,ALUNO")
  .eq("seu_numero", seuNumero);

console.log("INTER:", cobranca.seuNumero);
console.log("PROCURANDO:", seuNumero);
console.log("ENCONTROU:", mensalidade);

    if(mensalidade && mensalidade.length){

        const m = mensalidade[0];

        const insert = await supabase

        .from("financeiro_titulos")

        .insert({

            id_mensalidade: m.ID_MENSALIDADE,

            guid_aluno: m.guid_aluno,

            guid_responsavel: m.guid_responsavel,

            aluno: m.ALUNO,

            responsavel: m.responsavel,

            cpf_responsavel: m.cpf_responsavel,

            valor_original: m.valor_original,

            valor_desconto: m.valor_desconto,

            valor_final: m.valor_final,

            competencia_mes: m.competencia_mes,

            competencia_ano: m.competencia_ano,

            forma_pagamento: "BOLETO",

            status: cobranca.situacao === "RECEBIDO" ? "PAGO" : cobranca.situacao,

            status_inter: cobranca.situacao,

            id_inter: idInter

        })

        .select()

        .single();

        if(insert.data){

            await supabase

            .from("mensalidades")

            .update({

                id_titulo: insert.data.id

            })

            .eq("ID_MENSALIDADE", m.ID_MENSALIDADE);

        }

    }

}

await supabase

.from("financeiro_titulos")

.update({

    status:
        cobranca.situacao === "RECEBIDO"
            ? "PAGO"
            : cobranca.situacao,

    status_inter: cobranca.situacao,

    data_pagamento: cobranca.dataSituacao || null,

    valor_recebido: Number(cobranca.valorTotalRecebido || 0),

    data_baixa: cobranca.dataSituacao || null,

    ultima_sincronizacao: new Date(),

    sincronizado_inter: true

})
.eq("id_inter", idInter);

await supabase

.from("mensalidades")

.update({

    status_inter: cobranca.situacao,

    DATA_PAGAMENTO: cobranca.dataSituacao || null,

    data_baixa: cobranca.dataSituacao || null,

    ultima_sincronizacao: new Date(),

    STATUS:
        cobranca.situacao === "RECEBIDO"
            ? "PAGO"
            : cobranca.situacao

})
.eq("id_inter", idInter);

res.json({

    sucesso:true,

    situacao:cobranca.situacao

});

}catch(e){

res.status(500).json({

erro:String(e)

});

}

});



/**
 * ==========================================================
 * SINCRONIZA TODOS OS BOLETOS
 * ==========================================================
 */
app.get("/sincronizar-todos", async (req, res) => {

  try {

    const resposta = await fetch(
      "https://inter-service.onrender.com/boletos"
    );

    const lista = await resposta.json();

    const cobrancas = lista.cobrancas || [];

    let conciliados = 0;
    let pagos = 0;

    for (const item of cobrancas) {

      const c = item.cobranca || {};
      
      let seuNumero = (c.seuNumero || "").trim();

      if (
        seuNumero.length >= 7 &&
        !seuNumero.includes("/")
      ) {
        seuNumero =
          seuNumero.slice(0, -2) +
          "/" +
          seuNumero.slice(-2);
      }

    const { data: titulo } = await supabase
  .from("financeiro_titulos")
  .select("*")
  .eq("id_inter", c.codigoSolicitacao)
  .limit(1);

if (!titulo || titulo.length === 0)
  continue;

const m = titulo[0];
      
      await supabase
    .from("financeiro_titulos")
        .update({

          id_inter: c.codigoSolicitacao,

          status_inter: c.situacao,

          status:
            c.situacao === "RECEBIDO"
              ? "PAGO"
              : c.situacao,

          nosso_numero:
            item.boleto?.nossoNumero || null,

          linha_digitavel:
            item.boleto?.linhaDigitavel || null,

          codigo_barras:
            item.boleto?.codigoBarras || null,

          pix_copia_cola:
            item.pix?.pixCopiaECola || null,

          url_pdf_boleto:
            item.pdf || null,

          data_baixa:
  c.dataSituacao || null,

DATA_PAGAMENTO:
  c.dataSituacao || null,

          ultima_sincronizacao:
            new Date().toISOString()

        })
        .eq("id", m.id);

      await supabase
.from("mensalidades")
.update({

  STATUS:
    c.situacao === "RECEBIDO"
      ? "PAGO"
      : c.situacao,

  status_inter:
    c.situacao,

  DATA_PAGAMENTO:
    c.dataSituacao || null,

  data_baixa:
    c.dataSituacao || null,

  nosso_numero:
    item.boleto?.nossoNumero || null,

  linha_digitavel:
    item.boleto?.linhaDigitavel || null,

  codigo_barras:
    item.boleto?.codigoBarras || null,

  pix_copia_cola:
    item.pix?.pixCopiaECola || null,

  id_inter:
    c.codigoSolicitacao,

  ultima_sincronizacao:
    new Date().toISOString()

})
.eq(
  "ID_MENSALIDADE",
  m.ID_MENSALIDADE
);

      conciliados++;

      if (c.situacao === "RECEBIDO")
        pagos++;

    }

    res.json({
  sucesso: true,
  conciliados,
  pagos,
  teste: "VERSAO_NOVA_001"
});

  } catch (e) {

    res.status(500).json({
      erro: String(e)
    });

  }

});

app.get("/boletos", async (req, res) => {

try {

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

const token =
  JSON.parse(
    tokenJson.body
  ).access_token;

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

path:
"/cobranca/v3/cobrancas?dataInicial=2026-01-01&dataFinal=2026-12-31&itensPorPagina=500",
  method:"GET",

  cert,
  key,

  headers:{
    Authorization:"Bearer "+token
  }

};

const resultado =
await new Promise((resolve,reject)=>{

const reqInter =
https.request(options,resp=>{

let data="";

resp.on("data",c=>data+=c);

resp.on("end",()=>resolve(JSON.parse(data)));

});

reqInter.on("error",reject);

reqInter.end();

});

res.json(resultado);

}catch(e){

res.status(500).json({

erro:String(e)

});

}

});

/**
 * ==========================================================
 * OPERAÇÃO DIÁRIA
 * Cancela um boleto no Banco Inter.
 * ==========================================================
 */

app.get("/cancelar/:codigo", async (req, res) => {

try {

const codigo = req.params.codigo;

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

const token =
  JSON.parse(
    tokenJson.body
  ).access_token;

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const body = JSON.stringify({
  situacao: "CANCELADA"
});

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

  path:
"/cobranca/v3/cobrancas/" + codigo,

  method: "PATCH",

  cert,
  key,

  headers: {

    Authorization:
      "Bearer " + token,

    "Content-Type":
      "application/json",

    "Content-Length":
      Buffer.byteLength(body)

  }

};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
            "end",
            () => resolve({
              status: resp.statusCode,
              body: data
            })
          );

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.write(body);

    reqInter.end();

  });

res.json(resultado);

} catch (e) {

res.status(500).json({
  erro: String(e)
});

}

});

/**
 * ==========================================================
 * DESENVOLVIMENTO / TESTES
 * ==========================================================
 */

app.get("/descontos-reais", async (req, res) => {

try {

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

const token =
  JSON.parse(
    tokenJson.body
  ).access_token;

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

  path:
"/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-12-31&itensPorPagina=500",

  method: "GET",

  cert,
  key,

  headers: {
    Authorization:
      "Bearer " + token
  }

};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
            "end",
            () => resolve(
              JSON.parse(data)
            )
          );

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.end();

  });

const lista = [];

for (const item of resultado.cobrancas || []) {

  const c = item.cobranca || {};

  const desconto =
  c.descontos &&
  c.descontos.length > 0
    ? Number(c.descontos[0].valor)
    : 0;

  lista.push({

    cpf:
      c.pagador?.cpfCnpj || "",

    nome:
      c.pagador?.nome || "",

    vencimento:
      c.dataVencimento || "",

    valor_nominal:
      Number(c.valorNominal || 0),

    desconto:
      desconto,

    situacao:
      c.situacao || "",

    seu_numero:
      c.seuNumero || ""

  });

}

res.json(lista);

} catch (e) {

res.status(500).json({
  erro: String(e)
});

}

});

const PORT =
process.env.PORT || 3000;

/**
 * ==========================================================
 * DESENVOLVIMENTO / TESTES
 * ==========================================================
 */

app.get("/historico-maio-junho", async (req, res) => {

try {

const oauth =
  await fetch(
    "https://inter-service.onrender.com/oauth"
  );

const tokenJson =
  await oauth.json();

const token =
  JSON.parse(
    tokenJson.body
  ).access_token;

const cert = fs.readFileSync(
  "/etc/secrets/inter-certificado.crt"
);

const key = fs.readFileSync(
  "/etc/secrets/inter-chave.key"
);

const options = {

  hostname:
    "cdpj.partners.bancointer.com.br",

  port: 443,

  path:
"/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-12-31&itensPorPagina=500",

  method: "GET",

  cert,
  key,

  headers: {
    Authorization:
      "Bearer " + token
  }

};

const resultado =
  await new Promise((resolve, reject) => {

    const reqInter =
      https.request(
        options,
        resp => {

          let data = "";

          resp.on(
            "data",
            chunk => data += chunk
          );

          resp.on(
            "end",
            () => resolve(
              JSON.parse(data)
            )
          );

        }
      );

    reqInter.on(
      "error",
      reject
    );

    reqInter.end();

  });

const recebidos =
  resultado.cobrancas.filter(
    x =>
      x.cobranca &&
      x.cobranca.situacao ===
      "RECEBIDO"
  );

res.json(recebidos);

} catch (e) {

res.status(500).json({
  erro: String(e)
});

}

});

/**
 * ==========================================================
 * DESENVOLVIMENTO / TESTES
 * ==========================================================
 */

app.get("/descontos-confirmados", async (req, res) => {

try {

  const historico =
    await fetch(
      "https://inter-service.onrender.com/historico-maio-junho"
    );

  const cobrancas =
    await historico.json();

  const lista = [];

  for (const item of cobrancas) {

    const codigo =
      item.cobranca?.codigoSolicitacao;

    if (!codigo) continue;

    try {

      const consulta =
        await fetch(
          "https://inter-service.onrender.com/consultar/" +
          codigo
        );

      const detalhe =
  await consulta.json();

if (!detalhe.cobranca) {

  lista.push({
    erro: true,
    codigo: codigo,
    retorno: detalhe
  });

  continue;

}

const c = detalhe.cobranca;

      const desconto =
        c.descontos &&
        c.descontos.length > 0
          ? Number(c.descontos[0].valor)
          : 0;

      lista.push({

        cpf:
          c.pagador?.cpfCnpj || "",

        nome:
          c.pagador?.nome || "",

        valor_nominal:
          Number(c.valorNominal || 0),

        desconto:
          desconto,

        vencimento:
          c.dataVencimento || "",

        seu_numero:
          c.seuNumero || "",

        codigo:
          codigo

      });

    } catch (erroInterno) {

      console.log(
        "Erro ao consultar:",
        codigo
      );

    }

  }

  res.json(lista);

} catch (e) {

  res.status(500).json({
    erro: String(e)
  });

}

});

/**
 * ==========================================================
 * IMPLANTAÇÃO FINANCEIRA
 * Importa todos os boletos existentes no Banco Inter.
 * Utilizada apenas na implantação de novas unidades.
 * ==========================================================
 */

app.get("/sincronizar-boletos", async (req, res) => {

  try {

    const oauth =
      await fetch(
        "https://inter-service.onrender.com/oauth"
      );

    const tokenJson =
      await oauth.json();

    const token =
      JSON.parse(
        tokenJson.body
      ).access_token;

    const cert = fs.readFileSync(
      "/etc/secrets/inter-certificado.crt"
    );

    const key = fs.readFileSync(
      "/etc/secrets/inter-chave.key"
    );

    const options = {

      hostname:
        "cdpj.partners.bancointer.com.br",

      port: 443,

      path:
"/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-12-31&itensPorPagina=500",

      method: "GET",

      cert,
      key,

      headers: {
        Authorization:
          "Bearer " + token
      }

    };

    let pagina = 0;
let totalPaginas = 1;

const cobrancas = [];

while (pagina < totalPaginas) {

  const optionsPagina = {

    hostname:
      "cdpj.partners.bancointer.com.br",

    port: 443,

    path:
      "/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-12-31&itensPorPagina=100&paginaAtual=" +
      pagina,

    method: "GET",

    cert,
    key,

    headers: {
      Authorization:
        "Bearer " + token
    }

  };

  const resultado =
    await new Promise((resolve, reject) => {

      const reqInter =
        https.request(
          optionsPagina,
          resp => {

            let data = "";

            resp.on(
              "data",
              chunk => data += chunk
            );

            resp.on(
              "end",
              () => resolve(
                JSON.parse(data)
              )
            );

          }
        );

      reqInter.on(
        "error",
        reject
      );

      reqInter.end();

    });

  totalPaginas =
    resultado.totalPaginas || 1;

  cobrancas.push(
    ...(resultado.cobrancas || [])
  );

  console.log(
    "Página:",
    pagina,
    "Registros:",
    (resultado.cobrancas || []).length,
    "Total páginas:",
    resultado.totalPaginas
);

  pagina++;

}

console.log(
  "TOTAL COBRANCAS:",
  cobrancas.length
);

const retorno = [];

console.log("TOTAL NO ARRAY:", cobrancas.length);

for (const item of cobrancas) {

  const codigo =
    item.cobranca.codigoSolicitacao;

  try {

    const detalheOptions = {

      hostname:
        "cdpj.partners.bancointer.com.br",

      port: 443,

      path:
        "/cobranca/v3/cobrancas/" +
        codigo,

      method: "GET",

      cert,
      key,

      headers: {
        Authorization:
          "Bearer " + token
      }

    };

    const detalhe =
      await new Promise(
        (resolve, reject) => {

          const reqInter =
            https.request(
              detalheOptions,
              resp => {

                let data = "";

                resp.on(
                  "data",
                  chunk => data += chunk
                );

                resp.on(
                  "end",
                  () => resolve(
                    JSON.parse(data)
                  )
                );

              }
            );

          reqInter.on(
            "error",
            reject
          );

          reqInter.end();

        }
      );

    retorno.push({

  cpf: detalhe.cobranca?.pagador?.cpfCnpj,
  nome: detalhe.cobranca?.pagador?.nome,

  valor_nominal:
    Number(
      detalhe.cobranca?.valorNominal || 0
    ),

  valor_recebido:
    Number(
      detalhe.cobranca?.valorTotalRecebido || 0
    ),

  desconto:
    detalhe.cobranca?.descontos?.[0]?.valor || 0,

  vencimento:
    detalhe.cobranca?.dataVencimento,

  seu_numero:
    detalhe.cobranca?.seuNumero,

  status_inter:
    detalhe.cobranca?.situacao || null,

  nosso_numero:
    detalhe.boleto?.nossoNumero || null,

  linha_digitavel:
    detalhe.boleto?.linhaDigitavel || null,

  codigo_barras:
    detalhe.boleto?.codigoBarras || null,

  pix_copia_cola:
  detalhe.pix?.pixCopiaECola || null,

codigo_pix:
  detalhe.pix?.txid || null,

qr_code_pix:
  detalhe.pix?.imagemQrcode || null,

url_pdf_boleto:
  detalhe.pdf || null,

codigo:
  codigo

});

  } catch (e) {

    retorno.push({
      erro: true,
      codigo: codigo,
      mensagem: String(e)
    });

  }

}


for (const registro of retorno) {

  if (!registro.cpf) continue;

  const resultadoInsert =
    await supabase
      .from("financeiro_responsaveis")
      .insert({

        cpf_responsavel: registro.cpf,

        responsavel: registro.nome,

        valor_original: Number(registro.valor_nominal || 0),

        valor_desconto: Number(registro.desconto || 0),

        valor_final:
          Number(registro.valor_nominal || 0) -
          Number(registro.desconto || 0),

        valor_recebido: Number(registro.valor_recebido || 0),

        id_inter: registro.codigo,

        seu_numero: registro.seu_numero,

        competencia: registro.seu_numero,
        
        nosso_numero: registro.nosso_numero,

        data_vencimento: registro.vencimento || null,

        status_inter: registro.status_inter,

        linha_digitavel: registro.linha_digitavel || null,

        codigo_barras: registro.codigo_barras || null,

        pix_copia_cola: registro.pix_copia_cola || null,

        codigo_pix: registro.codigo_pix || null,

        qr_code_pix: registro.qr_code_pix || null,

        url_pdf_boleto: registro.url_pdf_boleto || null,

        origem: "INTER",

        ultima_sincronizacao: new Date().toISOString()

      });

  console.log(
    "INSERT:",
    JSON.stringify(resultadoInsert)
  );

}
    
res.json({
  sucesso: true,
  inseridos: retorno.length
});

  } catch (e) {

    res.status(500).json({
      erro: String(e)
    });

  }

});

/**
 * ==========================================================
 * IMPLANTAÇÃO FINANCEIRA
 * Vincula os responsáveis importados aos alunos do ERP.
 * Utilizada apenas na implantação de novas unidades.
 * ==========================================================
 */

app.get("/vincular-responsaveis", async (req, res) => {

try {

  const { data: financeiros } =
    await supabase
      .from("financeiro_responsaveis")
      .select("*");

  const { data: ksis } =
    await supabase
      .from("ksis_responsaveis")
      .select("*");

  let atualizados = 0;

  for (const fin of financeiros) {

    const cpfFinanceiro =
  String(fin.cpf_responsavel || "")
    .replace(/\D/g, "");

const encontrado =
  ksis.find(r =>
    String(r.cpf || "")
      .replace(/\D/g, "") === cpfFinanceiro
  );

    if (!encontrado)
      continue;

    await supabase
  .from("financeiro_responsaveis")
  .update({

    guid_responsavel: encontrado.guid_responsavel,

    guid_aluno: encontrado.guid_aluno,

    email_responsavel: encontrado.email,

    telefone_responsavel: encontrado.celular

  })
      .eq("id", fin.id);

    atualizados++;

  }

  res.json({
    sucesso: true,
    atualizados
  });

} catch (e) {

  res.status(500).json({
    erro: String(e)
  });

}

});

/**
 * ==========================================================
 * IMPLANTAÇÃO FINANCEIRA
 * Padroniza os boletos importados.
 * Gera 1 registro por responsável em financeiro_padrao.
 * ==========================================================
 */
app.get("/padronizar-financeiro", async (req, res) => {

  try {

    const { data: boletos } = await supabase
      .from("financeiro_responsaveis")
      .select("*");

    if (!boletos || boletos.length === 0) {

      return res.json({
        sucesso: false,
        mensagem: "Nenhum boleto encontrado."
      });

    }

    // Agrupa por responsável
    const grupos = {};

    for (const b of boletos) {

      const chave =
        b.guid_responsavel ||
        b.cpf_responsavel;

      if (!chave)
        continue;

      if (!grupos[chave]) {

        grupos[chave] = [];

      }

      grupos[chave].push(b);

    }

    let processados = 0;

    for (const chave in grupos) {

  const lista = grupos[chave];

lista.sort((a, b) =>
  String(a.seu_numero).localeCompare(String(b.seu_numero))
);

const primeiro = lista[0];

      if (!primeiro.guid_aluno || !primeiro.guid_responsavel) {
  continue;
}

const recebido =
  lista.find(x => x.status_inter === "RECEBIDO") ||
  primeiro;

const resultado = await supabase
  .from("financeiro_padrao")
  .upsert({

    guid_aluno: recebido.guid_aluno,

    guid_responsavel: recebido.guid_responsavel,

    aluno: "",

    responsavel: recebido.responsavel,

    cpf_responsavel: recebido.cpf_responsavel,

    email_responsavel: recebido.email_responsavel,

    telefone_responsavel: recebido.telefone_responsavel,

    disciplina: "PENDENTE",

    valor_original: recebido.valor_original,

    valor_desconto: recebido.valor_desconto,

    valor_final: recebido.valor_final,

    dia_vencimento: recebido.data_vencimento
      ? new Date(recebido.data_vencimento).getDate()
      : 5,

    forma_pagamento: recebido.forma_pagamento,

    tipo_cobranca: recebido.tipo_cobranca,

    quantidade_boletos_analisados: lista.length,

    primeira_competencia: lista[0].competencia,

    ultima_competencia_paga:
      recebido.status_inter === "RECEBIDO"
        ? recebido.competencia
        : null,

    data_padronizacao: new Date(),

    algoritmo_padronizacao: "IMPLANTACAO_V1"

  });

if (resultado.error) {
  console.log(resultado.error);
}

  processados++;

}

    res.json({

      sucesso: true,

      responsaveis:
        processados

    });

  } catch (e) {

    res.status(500).json({
      erro: String(e)
    });

  }

});

/**
 * ==========================================================
 * IMPLANTAÇÃO FINANCEIRA
 * Gera mensalidades a partir da tabela financeiro_responsaveis.
 * Utilizada apenas na implantação de novas unidades.
 * Não faz parte da operação diária.
 * ==========================================================
 */

app.get("/gerar-mensalidades", async (req, res) => {

  try {

    const { data: boletos, error } =
      await supabase
        .from("financeiro_responsaveis")
        .select("*");

    if (error) throw error;

    let criadas = 0;
    let ignoradas = 0;

    for (const item of boletos) {

      const existente =
        await supabase
          .from("mensalidades")
          .select("ID_MENSALIDADE")
          .eq(
            "id_inter",
            item.ultimo_codigo_inter
          )
          .limit(1);

      if (
        existente.data &&
        existente.data.length > 0
      ) {

        ignoradas++;
        continue;

      }

      const valorOriginal =
        Number(
          item.valor_mensalidade || 0
        );

      const desconto =
        Number(
          item.valor_desconto || 0
        );

      const valorFinal =
        valorOriginal - desconto;

      const mensalidade = {

        ID_MENSALIDADE:
          crypto.randomUUID(),

        ID_ALUNO:
          item.guid_aluno,

        ALUNO:
          item.nome_responsavel,

        CURSO:
          "",

        TIPO:
          "MENSALIDADE",

        VALOR:
          valorOriginal,

        COMPETENCIA:
          item.ultimo_seu_numero,

        VENCIMENTO:
  item.data_vencimento,

        STATUS:
  item.status_inter === "RECEBIDO"
    ? "PAGO"
    : "ABERTO",

        DATA_PAGAMENTO:
          item.ultima_sincronizacao,

        FORMA_PAGAMENTO:
          "BOLETO",

        responsavel:
          item.nome_responsavel,

        cpf_responsavel:
          item.cpf,

        origem:
          "INTER",

        tipo_cobranca:
          "BOLETO",

        valor_original:
          valorOriginal,

        valor_desconto:
          desconto,

        valor_final:
          valorFinal,

        seu_numero:
          item.ultimo_seu_numero,

        id_inter:
          item.ultimo_codigo_inter,

        status_inter:
          item.status_inter,

        VENCIMENTO:
  item.data_vencimento,

      };

      const insert =
        await supabase
          .from("mensalidades")
          .insert(mensalidade);

      if (!insert.error) {
        criadas++;
      }

    }

    res.json({

      sucesso: true,

      mensalidades_criadas:
        criadas,

      mensalidades_ignoradas:
        ignoradas

    });

  } catch (e) {

    res.status(500).json({
      erro: String(e)
    });

  }

});

/**
 * ==========================================================
 * IMPLANTAÇÃO FINANCEIRA
 * Importa recebimentos históricos existentes.
 * Utilizada apenas na implantação de novas unidades.
 * ==========================================================
 */

app.get("/sincronizar-recebimentos", async (req, res) => {

  try {

    const { data: recebidos } =
      await supabase
        .from("financeiro_responsaveis")
        .select("*")
        .eq("status_inter", "RECEBIDO");

    let inseridos = 0;

    for (const item of recebidos || []) {

      const existe =
        await supabase
          .from("recebimentos")
          .select("ID_RECEBIMENTO")
          .eq(
            "ID_MENSALIDADE",
            item.ultimo_codigo_inter
          )
          .limit(1);

      if (
        existe.data &&
        existe.data.length > 0
      ) {
        continue;
      }

      await supabase
        .from("recebimentos")
        .insert({

          ID_RECEBIMENTO:
            crypto.randomUUID(),

          ID_MENSALIDADE:
            item.ultimo_codigo_inter,

          ALUNO:
            item.nome_responsavel,

          VALOR:
            String(
              item.valor_mensalidade || 0
            ),

          DATA_RECEBIMENTO:
            new Date().toISOString(),

          FORMA_PAGAMENTO:
            "BOLETO",

          OBSERVACAO:
            item.ultimo_seu_numero,

          STATUS:
            "PAGO"

        });

      inseridos++;

    }

    res.json({
      sucesso: true,
      inseridos
    });

  } catch (e) {

    res.status(500).json({
      erro: String(e)
    });

  }

});

/**
 * ==========================================================
 * IMPLANTAÇÃO FINANCEIRA
 * Gera movimentações financeiras históricas.
 * Utilizada apenas na implantação de novas unidades.
 * ==========================================================
 */

app.get("/sincronizar-movimentacoes", async (req, res) => {

  try {

    const { data: recebimentos } =
      await supabase
        .from("recebimentos")
        .select("*");

    let inseridos = 0;

    for (const item of recebimentos || []) {

      const existe =
        await supabase
          .from("movimentacoes")
          .select("ID_MOV")
          .eq(
            "ID_ORIGEM",
            item.ID_RECEBIMENTO
          )
          .limit(1);

      if (
        existe.data &&
        existe.data.length > 0
      ) {
        continue;
      }

      await supabase
        .from("movimentacoes")
        .insert({

          ID_MOV:
            crypto.randomUUID(),

          DATA:
            item.DATA_RECEBIMENTO,

          DATA_VENCIMENTO:
            item.DATA_RECEBIMENTO,

          TIPO:
            "RECEITA",

          CATEGORIA:
            "MENSALIDADE",

          DESCRICAO:
            item.ALUNO,

          VALOR:
            Number(item.VALOR || 0),

          FORMA_PAGAMENTO:
            item.FORMA_PAGAMENTO,

          ORIGEM:
            "INTER",

          STATUS:
            "CONFIRMADO",

          CENTRO_CUSTO:
            "ESCOLA",

          ID_ORIGEM:
            item.ID_RECEBIMENTO,

          DATA_PAGAMENTO:
            item.DATA_RECEBIMENTO,

          AMBIENTE_TESTE:
            null

        });

      inseridos++;

    }

    res.json({
      sucesso: true,
      inseridos
    });

  } catch (e) {

    res.status(500).json({
      erro: String(e)
    });

  }

});

/**
 * ==========================================================
 * DIAGNÓSTICO DO FINANCEIRO
 * ==========================================================
 */
app.get("/diagnostico-financeiro", async (req, res) => {

try{

const titulos = await supabase
.from("financeiro_titulos")
.select("id,status,status_inter,id_inter,id_mensalidade");

const mensalidades = await supabase
.from("mensalidades")
.select("ID_MENSALIDADE,STATUS,id_inter");

const alunos = await supabase
.from("alunos_master")
.select("guid,nome,status");

res.json({

    alunos: alunos.data.length,

    mensalidades: mensalidades.data.length,

    boletos: titulos.data.length,

    boletosEmitidos:

        titulos.data.filter(t=>t.id_inter).length,

    boletosSemInter:

        titulos.data.filter(t=>!t.id_inter).length,

    pagos:

        titulos.data.filter(t=>t.status==="PAGO").length,

    atrasados:

        titulos.data.filter(t=>t.status==="ATRASADO").length,

    cancelados:

        titulos.data.filter(t=>t.status_inter==="CANCELADO").length

});

}catch(e){

res.status(500).json({

erro:String(e)

});

}

});

/**
 * ==========================================================
 * DIAGNÓSTICO DAS MENSALIDADES
 * ==========================================================
 */
app.get("/diagnostico-mensalidades", async (req, res) => {

try{

const { data: mensalidades } = await supabase
.from("mensalidades")
.select("ID_MENSALIDADE,ALUNO,COMPETENCIA,id_inter,id_titulo,STATUS");

const { data: titulos } = await supabase
.from("financeiro_titulos")
.select("id,id_mensalidade,id_inter");

const mapa = {};

titulos.forEach(t=>{

    mapa[t.id_mensalidade] = t;

});

const resultado = mensalidades.map(m=>{

    const titulo = mapa[m.ID_MENSALIDADE];

    return{

        mensalidade:m.ID_MENSALIDADE,

        aluno:m.ALUNO,

        competencia:m.COMPETENCIA,

        status:m.STATUS,

        possuiTitulo:!!titulo,

        possuiInter:!!titulo?.id_inter

    };

});

res.json(resultado);

}catch(e){

res.status(500).json({

erro:String(e)

});

}

});

app.get("/mensalidades-sem-titulo", async (req, res) => {

const { data } = await supabase

.from("mensalidades")

.select("ID_MENSALIDADE,ALUNO,COMPETENCIA,STATUS")

.is("id_titulo",null);

res.json({

    total:data.length,

    lista:data

});

});

/**
 * ==========================================================
 * SINCRONIZAÇÃO AUTOMÁTICA
 * ==========================================================
 */

async function sincronizacaoAutomatica() {

  try {

    const resposta = await fetch(
  "http://localhost:" + PORT + "/sincronizar-todos"
);

    const json = await resposta.json();

    console.log(
      "[INTER] Sincronização automática:",
      json
    );

  } catch (e) {

    console.error(
      "[INTER] Erro na sincronização:",
      e
    );

  }

}

// executa 1 minuto após iniciar
setTimeout(sincronizacaoAutomatica, 60000);

// executa a cada 10 minutos
setInterval(sincronizacaoAutomatica, 10 * 60 * 1000);


app.listen(PORT);
