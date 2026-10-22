# Chiru-san IPTV 📺

Servidor de mídia em Node.js que organiza uma coleção de vídeos em um catálogo e disponibiliza rotas HTTP para acessar os conteúdos e gerar uma playlist M3U. O projeto também contém rotinas auxiliares para descobrir o IPv6 público e atualizar um registro Dynu.

## ✨ Recursos

- 📚 Carrega o catálogo local a partir de `videos.json`
- 📺 Gera uma playlist M3U com os vídeos cadastrados
- 🔗 Disponibiliza rotas HTTP para localizar e reproduzir vídeos
- 🌐 Suporte a escuta IPv6
- 🔄 Rotina para descobrir o IPv6 público e atualizar o Dynu
- 🧰 Scripts auxiliares para catalogar e testar links

Os endereços de vídeo precisam ser acessíveis pelo servidor e pelo aplicativo que reproduzirá a playlist. A disponibilidade depende da rede, do host dos arquivos e da configuração do dispositivo.

## 📋 Requisitos

- Node.js com suporte a módulos ES
- npm
- Conexão com a internet para os recursos de rede e atualização Dynu

## 🚀 Instalação

```bash
git clone https://github.com/chirusanrestart/chiru-san-iptv.git
cd chiru-san-iptv
npm install
```

Crie uma configuração local:

```bash
cp .env.example .env
```

Edite o arquivo `.env` e configure as credenciais Dynu somente se for utilizar a atualização automática do endereço IPv6:

```dotenv
PORT=18080
DYNU_USERNAME=
DYNU_PASSWORD=
```

Nunca publique suas credenciais reais.

## ▶️ Iniciar o servidor

```bash
node server.mjs
```

A porta padrão é `18080`. Para usar outra porta, defina a variável `PORT` no ambiente antes de iniciar.

## 📂 Catálogo de vídeos

O servidor lê o arquivo `videos.json`. Cada item deve conter um identificador ou nome e uma URL acessível. O código reconhece diferentes nomes de campo para a URL, como `url`, `videoUrl`, `playbackUrl`, `directUrl`, `src` ou `link`.

Exemplo ilustrativo de estrutura:

```json
[
  {
    "id": "video-01",
    "title": "Meu vídeo",
    "url": "https://exemplo.com/video.mp4"
  }
]
```

Use URLs válidas e autorizadas. O exemplo acima é apenas um modelo, não um endereço real.

## 🌐 Rede e acesso externo

O servidor escuta em IPv6. Para acessá-lo de outra rede, verifique as regras do roteador, a disponibilidade de conexões de entrada e as configurações do provedor de internet. Ter um endereço IPv6 público ou um registro Dynu não garante, por si só, que o servidor esteja acessível externamente.

## 🔐 Segurança

- Mantenha o arquivo `.env` fora do Git.
- Não publique usuário ou senha do Dynu.
- Disponibilize apenas vídeos que você tenha autorização para compartilhar.
- Evite expor o servidor à internet sem compreender as implicações de acesso público.

## 🧪 Scripts auxiliares

O repositório inclui scripts para catalogação, testes de links, descoberta de IPv6 e download de teste. Consulte cada arquivo antes de executá-lo para entender seu comportamento.

## 👩‍💻 Projeto

Projeto pessoal desenvolvido por **Chiru-san**.
