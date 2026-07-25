const express = require("express");
const router = express.Router();

const inter = require("../services/InterService");

/**
 * Consulta um boleto
 */
router.get("/consultar/:codigo", async (req, res) => {

    try {

        const resultado = await inter.consultarBoleto(

            req.params.codigo

        );

        res.json(resultado);

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,
            erro: erro.message

        });

    }

});

module.exports = router;
