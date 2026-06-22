const express = require("express");

const app = express();

app.get("/", (req, res) => {

  res.json({
    status: "ok",
    mensagem: "Inter Service Online"
  });

});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    "Servidor iniciado na porta " +
    PORT
  );

});
