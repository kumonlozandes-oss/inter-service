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


  async atualizarStatusInter(idInter, cobranca) {

    const { error } = await supabase
      .from("financeiro_titulos")
      .update({

        status_inter: cobranca.situacao,

        nosso_numero:
          cobranca.boleto?.nossoNumero || null,

        linha_digitavel:
          cobranca.boleto?.linhaDigitavel || null,

        codigo_barras:
          cobranca.boleto?.codigoBarras || null,

        data_pagamento:
    cobranca.dataSituacao || new Date().toISOString(),

valor_recebido:
    Number(cobranca.valorTotalRecebido || 0),

webhook_recebido:
    true,

sincronizado_inter:
    true,

data_sincronizacao_inter:
    new Date().toISOString(),

        ultima_sincronizacao:
          new Date().toISOString()

      })
      .eq("id_inter", idInter);


    if (error) throw error;
  }

}


module.exports = new FinanceiroRepository();
