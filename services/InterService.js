const axios = require("axios");
const https = require("https");
const fs = require("fs");
const path = require("path");

class InterService {

    constructor() {

        this.baseURL = "https://cdpj.partners.bancointer.com.br";

        this.clientId = process.env.INTER_CLIENT_ID;
        this.clientSecret = process.env.INTER_CLIENT_SECRET;

        this.agent = new https.Agent({

            cert: fs.readFileSync("/etc/secrets/inter-certificado.crt"),

            key: fs.readFileSync("/etc/secrets/inter-chave.key")

        });

        this.token = null;
        this.expiracao = null;

    }

    async obterToken() {

        if (
            this.token &&
            this.expiracao &&
            this.expiracao > Date.now()
        ) {

            return this.token;

        }

        const resposta = await axios.post(

            this.baseURL + "/oauth/v2/token",

            "grant_type=client_credentials",

            {

                httpsAgent: this.agent,

                headers: {

                    "Content-Type":"application/x-www-form-urlencoded"

                },

                auth: {

                    username:this.clientId,

                    password:this.clientSecret

                }

            }

        );

        this.token = resposta.data.access_token;

        this.expiracao =

            Date.now() +

            ((resposta.data.expires_in - 60) * 1000);

        return this.token;

    }

    async consultarBoleto(codigo) {

    const token = await this.obterToken();

    const resposta = await axios.get(

        this.baseURL +
        "/cobranca/v3/cobrancas",

        {

            httpsAgent: this.agent,

            headers: {

                Authorization: "Bearer " + token

            },

            params: {

                idSolicitacao: codigo

            }

        }

    );

    return resposta.data;

}

async sincronizarBoleto(codigo) {

    const resposta = await this.consultarBoleto(codigo);

    const cobranca = resposta.cobrancas
        ? resposta.cobrancas[0].cobranca
        : resposta.cobranca;


    return {

        status: cobranca.situacao,

        dataPagamento: cobranca.dataSituacao,

        valorPago: cobranca.valorTotalRecebido,

        cobranca

    };

}

}



module.exports = new InterService();
