const express = require("express");
const router = express.Router();

const supabase = require("../repositories/SupabaseRepository");

/**
 * ==========================
 * ALUNOS
 * ==========================
 */

router.get("/alunos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("alunos_master")
      .select("*")
      .order("nome");

    if (error) throw error;

    res.json(data);

  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/**
 * ==========================
 * ALUNO
 * ==========================
 */

router.get("/alunos/:guid", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("alunos_master")
      .select("*")
      .eq("guid", req.params.guid)
      .single();

    if (error) throw error;

    res.json(data);

  } catch (e) {

    res.status(500).json({
      erro: e.message
    });

  }

});

/**
 * ==========================
 * RESPONSÁVEIS
 * ==========================
 */

router.get("/responsaveis", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("alunos_master")
      .select(`
        guid,
        guid_responsavel,
        responsavel,
        responsavel_cpf,
        responsavel_telefone,
        responsavel_email
      `)
      .order("responsavel");

    if (error) throw error;

    res.json(data);

  } catch (e) {

    res.status(500).json({
      erro: e.message
    });

  }

});

/**
 * ==========================
 * MENSALIDADES
 * ==========================
 */

router.get("/mensalidades", async (req, res) => {

  try {

    const { data, error } = await supabase
  .from("vw_mensalidades")
  .select("*")
  .order("competencia", {
    ascending: false
  });

    if (error) throw error;

    res.json(data);

  } catch (e) {

    res.status(500).json({
      erro: e.message
    });

  }

});

module.exports = router;
