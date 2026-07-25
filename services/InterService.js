const axios = require("axios");

class InterService {

  constructor() {

    this.baseURL = "https://cdpj.partners.bancointer.com.br";

  }

  async autenticar() {

    throw new Error("Autenticação ainda não implementada.");

  }

  async emitirBoleto(dados) {

    throw new Error("Emissão ainda não implementada.");

  }

  async consultarBoleto(codigo) {

    throw new Error("Consulta ainda não implementada.");

  }

  async cancelarBoleto(codigo) {

    throw new Error("Cancelamento ainda não implementado.");

  }

}

module.exports = new InterService();
