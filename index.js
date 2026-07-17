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

return res.json({

  sucesso: resultado.status >= 200 && resultado.status < 300,

  status_http: resultado.status,

  id_mensalidade: req.body.id_mensalidade,

  guid_aluno: req.body.guid_aluno,

  guid_responsavel: req.body.guid_responsavel,

  id_inter: bodyInter.codigoSolicitacao,

  nosso_numero: bodyInter.nossoNumero,

  seu_numero: bodyInter.seuNumero,

  linha_digitavel: bodyInter.linhaDigitavel,

  codigo_barras: bodyInter.codigoBarras,

  codigo_pix: bodyInter.pix?.txid,

  qr_code_pix: bodyInter.pix?.imagemQrcode,

  pix_copia_cola: bodyInter.pix?.pixCopiaECola,

  url_pdf_boleto: bodyInter.pdf,

  status: bodyInter.situacao,

  resposta_inter: bodyInter

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

  pagina++;

}

console.log(
  "TOTAL COBRANCAS:",
  cobrancas.length
);

const retorno = [];

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
  const existente =
  await supabase
    .from("financeiro_responsaveis")
    .select("id")
    .eq(
      "ultimo_codigo_inter",
      registro.codigo
    )
    .limit(1);

if (
  existente.data &&
  existente.data.length > 0
) {

  await supabase
    .from("financeiro_responsaveis")
    .update({

      data_vencimento:
        registro.vencimento || null,

      nosso_numero:
        registro.nosso_numero || null,

      linha_digitavel:
        registro.linha_digitavel || null,

      codigo_barras:
        registro.codigo_barras || null,

      pix_copia_cola:
        registro.pix_copia_cola || null,

      status_inter:
  registro.status_inter

    })
    .eq(
      "ultimo_codigo_inter",
      registro.codigo
    );

  continue;

}

  const resultadoInsert =
await supabase
  .from("financeiro_responsaveis")
  .insert({

    cpf: registro.cpf,
    nome_responsavel: registro.nome,

    valor_mensalidade: registro.valor_nominal,
    valor_desconto: registro.desconto,
    valor_com_desconto: registro.valor_recebido,

    ultimo_codigo_inter: registro.codigo,
    ultimo_seu_numero: registro.seu_numero,

    data_vencimento: registro.vencimento || null,
    nosso_numero: registro.nosso_numero || null,
    linha_digitavel: registro.linha_digitavel || null,
    codigo_barras: registro.codigo_barras || null,
    pix_copia_cola: registro.pix_copia_cola || null,
    status_inter:
  registro.status_inter,

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
      String(fin.cpf || "")
        .replace(/\D/g, "");

    const encontrado =
      ksis.find(r =>
        String(r.CPF || "")
          .replace(/\D/g, "") === cpfFinanceiro
      );

    if (!encontrado)
      continue;

    await supabase
      .from("financeiro_responsaveis")
      .update({

        guid_responsavel:
          encontrado.GUID_RESPONSAVEL,

        guid_aluno:
          encontrado.GUID_ALUNO

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

app.listen(PORT);
