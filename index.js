const express = require("express");
const fs = require("fs");
const https = require("https");
const querystring = require("querystring");

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

const PORT =
process.env.PORT || 3000;

app.listen(PORT);
