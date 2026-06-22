const express = require("express");
const fs = require("fs");
const https = require("https");
const querystring = require("querystring");

const app = express();

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
                  status:
                    resp.statusCode,
                  body:
                    data
                })
              );

            }
          );

        reqInter.on(
          "error",
          reject
        );

        reqInter.write(
          postData
        );

        reqInter.end();

      });

    res.json(resultado);

  }

  catch(e){

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
        "/cobranca/v3/cobrancas",

      method:
        "GET",

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
                  status:
                    resp.statusCode,
                  body:
                    data
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

const PORT =
  process.env.PORT || 3000;


app.listen(PORT);
