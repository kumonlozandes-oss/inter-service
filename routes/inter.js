const express = require("express");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({
    modulo: "Inter",
    status: "OK"
  });
});

module.exports = router;
