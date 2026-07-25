const supabase = require("./SupabaseRepository");
class FinanceiroRepository {
  async listarTitulosPendentes() {

    const { data, error } = await supabase
      .from("financeiro_titulos")
      .select("*")
      .in("status", [
        "EMITIDO",
        "ABERTO",
        "ATRASADO"
      ]);

    if (error) throw error;

    return data || [];
  }
  async atualizarTitulo(id, dados) {

    const { error } = await supabase
      .from("financeiro_titulos")
      .update(dados)
      .eq("id", id);

    if (error) throw error;
  }
  async atualizarMensalidade(idMensalidade, dados) {

    const { error } = await supabase
      .from("mensalidades")
      .update(dados)
      .eq("ID_MENSALIDADE", idMensalidade);

    if (error) throw error;
  }
}
async atualizarStatusInter(idInter, cobranca) {

    const { error } = await supabase
        .from("financeiro_titulos")
        .update({

            status_inter: cobranca.situacao,
            nosso_numero: cobranca.nossoNumero,
            linha_digitavel: cobranca.boleto?.linhaDigitavel,
            codigo_barras: cobranca.boleto?.codigoBarras,
            data_pagamento: cobranca.dataPagamento || null,
            ultima_sincronizacao: new Date().toISOString()
        })
        .eq("id_inter", idInter);

    if (error) throw error;
}

module.exports = new FinanceiroRepository();
