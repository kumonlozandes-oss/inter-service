const express = require("express");
const fs = require("fs");

const app = express();

app.get("/", (req, res) => {

  res.json({
    status: "ok",
    mensagem: "Inter Service Online"
  });

});

app.get("/health", (req, res) => {

  try {

    const cert =
      fs.readFileSync(
        "/etc/secrets/inter-certificado.crt",
        "utf8"
      );

    const key =
      fs.readFileSync(
        "/etc/secrets/inter-chave.key",
        "utf8"
      );

    res.json({

      sucesso: true,

      certificado:
        cert.includes(
          "BEGIN CERTIFICATE"
        ),

      chave:
        key.includes(
          "BEGIN PRIVATE KEY"
        ),

      tamanhoCertificado:
        cert.length,

      tamanhoChave:
        key.length,

      clientId:
        !!process.env.INTER_CLIENT_ID,

      clientSecret:
        !!process.env.INTER_CLIENT_SECRET

    });

  }

  catch(e){

    res.status(500).json({

      sucesso:false,

      erro:String(e)

    });

  }

});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    "Servidor iniciado na porta " +
    PORT
  );

});
