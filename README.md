# Chiru-san IPTV 📺

Servidor pessoal para executar diretamente no Termux. O Termux mantém o catálogo, serve a playlist e transmite os vídeos do álbum compartilhado do Google Fotos. O Hostless fica reservado exclusivamente ao papel de túnel, sem processar catálogo, playlist ou mídia.

## Termux

Instale Node.js e Git pelo gerenciador de pacotes do Termux e execute:

```bash
git clone https://github.com/chirusanrestart/chiru-san-iptv.git
cd chiru-san-iptv
npm install
cp .env.example .env
npm start
```

O servidor usa a porta 18080 por padrão. Acesse `http://127.0.0.1:18080/` no próprio aparelho ou use o IP local do Termux em outro dispositivo da rede.

## Rotas

- `/health`: estado do servidor e quantidade de vídeos.
- `/playlist.m3u`: playlist M3U.
- `/video/:id`: streaming direto com encaminhamento de requisições HTTP Range, necessário para seek.

## Catálogo

O catálogo é extraído do álbum configurado em `GOOGLE_PHOTOS_ALBUM_URL` e atualizado a cada 5 minutos por padrão. O arquivo `data/videos.json` é local e não é enviado ao Git. Se uma atualização falhar, o último catálogo válido permanece em uso.

Atualização manual:

```bash
npm run catalog
```

## Dynu (opcional)

Preencha `DYNU_HOSTNAME`, `DYNU_USERNAME` e `DYNU_PASSWORD` no `.env` para atualizar o registro IPv6 a cada cinco minutos. Deixe em branco para desativar.

## Túnel Hostless

O processo de mídia permanece no Termux. O Hostless será somente um relay de transporte entre a conexão de saída do Termux e o cliente externo. A implementação do relay será ligada separadamente quando o endpoint/protocolo do serviço Hostless estiver definido; não há proxy de vídeo nem lógica IPTV no Hostless.

## Observações

O servidor não baixa nem armazena os vídeos inteiros. Ele encaminha os bytes da origem e respeita o cabeçalho Range do player. Use somente conteúdo que você tenha autorização para acessar e compartilhar.
