const express = require("express");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    modulo: "Webhook",
    status: "OK"
  });
});

module.exports = router;
