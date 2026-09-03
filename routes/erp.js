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
  })
  .order("aluno");

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
 * USUÁRIOS
 * ==========================
 */

router.get("/usuarios", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("usuarios")
      .select(`
        id,
        nome,
        email,
        login,
        perfil,
        ativo,
        telefone,
        cpf,
        observacoes,
        data_nascimento,
        data_admissao,
        cursos,
        funcoes,
        cep,
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        cargo,
        salario,
        carga_horaria,
        acesso_erp
      `)
      .order("nome");

    if (error) throw error;

    res.json(data);
  } catch (e) {
    console.error("ERRO AO CARREGAR USUÁRIOS:", e);

    res.status(500).json({
      erro: e.message
    });
  }
});

router.put("/usuarios/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      nome,
      email,
      login,
      senha,
      perfil,
      ativo,
      telefone,
      cpf,
      observacoes,
      data_nascimento,
      data_admissao,
      cursos,
      funcoes,
      cep,
      logradouro,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      cargo,
      salario,
      carga_horaria,
      acesso_erp
    } = req.body;

    const dados = {
      nome,
      email,
      login,
      perfil,
      ativo,
      telefone: telefone || null,
      cpf: cpf || null,
      observacoes: observacoes || null,
      data_nascimento: data_nascimento || null,
      data_admissao: data_admissao || null,
      cursos: cursos || [],
      funcoes: funcoes || [],
      cep: cep || null,
      logradouro: logradouro || null,
      numero: numero || null,
      complemento: complemento || null,
      bairro: bairro || null,
      cidade: cidade || null,
      estado: estado || null,
      cargo: cargo || null,
      salario: salario ?? null,
      carga_horaria: carga_horaria ?? null,
      acesso_erp: acesso_erp ?? false
    };

    if (senha) {
      dados.senha_hash = senha;
    }

    const { data, error } = await supabase
      .from("usuarios")
      .update(dados)
      .eq("id", id)
      .select(`
        id,
        nome,
        email,
        login,
        perfil,
        ativo,
        telefone,
        cpf,
        observacoes,
        data_nascimento,
        data_admissao,
        cursos,
        funcoes,
        cep,
        logradouro,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        cargo,
        salario,
        carga_horaria,
        acesso_erp
      `)
      .single();

    if (error) throw error;

    res.json({
      sucesso: true,
      usuario: data
    });
  } catch (e) {
    console.error("ERRO AO ATUALIZAR USUÁRIO:", e);

    res.status(500).json({
      sucesso: false,
      erro: e.message
    });
  }
});

module.exports = router;
