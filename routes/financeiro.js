const express = require("express");

const router = express.Router();

/**
 * Health Check do módulo financeiro
 */
router.get("/health", (req, res) => {

  res.json({

    modulo: "Financeiro",

    status: "OK",

    data: new Date()

  });

});

module.exports = router;
