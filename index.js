const express = require("express");
const fs = require("fs");
const https = require("https");
const querystring = require("querystring");

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
res.json({
status: "ok"
});
});

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

res.json(resultado);

} catch (e) {

res.status(500).json({
  erro: String(e)
});


}

});

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
"/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-06-30&itensPorPagina=500",

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
"/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-06-30&itensPorPagina=500",

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
"/cobranca/v3/cobrancas?dataInicial=2026-04-01&dataFinal=2026-06-30&itensPorPagina=500",

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
  (resultado.cobrancas || [])
  .filter(
    x =>
      x.cobranca &&
      x.cobranca.situacao ===
      "RECEBIDO"
  );

const retorno = [];

for (const item of recebidos.slice(0,5)) {

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

      cpf:
        detalhe.cobranca?.pagador?.cpfCnpj,

      nome:
        detalhe.cobranca?.pagador?.nome,

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

      cpf: registro.cpf,
      nome_responsavel: registro.nome,
      valor_mensalidade: registro.valor_nominal,
      valor_desconto: registro.desconto,
      valor_com_desconto: registro.valor_recebido,
      ultimo_codigo_inter: registro.codigo,
      ultimo_seu_numero: registro.seu_numero,
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

app.listen(PORT);
