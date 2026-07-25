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

/**
 * Sincroniza um boleto
 */
router.get("/sincronizar/:codigo", async (req, res) => {

    try {

        const resultado = await inter.sincronizarBoleto(
            req.params.codigo
        );

        const financeiro = require("../repositories/FinanceiroRepository");

        await financeiro.atualizarStatusInter(

            req.params.codigo,

            {
                situacao: resultado.status,
                dataPagamento: resultado.dataPagamento,
                valorPago: resultado.valorPago,
                boleto: resultado.boleto
            }

        );

        res.json({

            sucesso: true,

            situacao: resultado.status

        });

    } catch (erro) {

        console.error(erro);

        res.status(500).json({

            sucesso: false,

            erro: erro.message

        });

    }

});

module.exports = router;
