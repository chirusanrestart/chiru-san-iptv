# Chiru-san IPTV 📺

Servidor pessoal para executar diretamente no Termux. O Termux mantém o catálogo, serve a playlist e transmite os vídeos do álbum compartilhado do Google Fotos. O Hostless é somente um relay de bytes, sem catálogo, playlist ou processamento de mídia.

## Instalação no Termux

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git
git clone https://github.com/chirusanrestart/chiru-san-iptv.git
cd chiru-san-iptv
npm install
cp .env.example .env
npm start
```

O servidor usa a porta 18080 por padrão. Acesse `http://127.0.0.1:18080/` no próprio aparelho ou use o IP local do Termux em outro dispositivo da rede.

## Rotas locais

- `/health`: estado do servidor e quantidade de vídeos.
- `/catalog.json`: IDs e metadados básicos para identificar os vídeos sem expor as URLs de origem.
- `/playlist.m3u`: playlist M3U com URLs do próprio Termux.
- `/video/:id`: streaming direto com encaminhamento HTTP Range, necessário para seek.

## Catálogo

O catálogo é extraído do álbum compartilhado do Google Fotos e atualizado a cada 5 minutos por padrão. O arquivo `data/videos.json` fica no armazenamento local e não é enviado ao Git. Se uma atualização falhar, o último catálogo válido permanece em uso.

Atualização manual:

```bash
npm run catalog
```

## Túnel Hostless

O relay existente fica em `https://melissa-iptv.hostless.app` e mantém somente os endpoints de transporte:

- Termux envia bytes por `POST /enviar/:id`.
- O player recebe bytes por `GET /receber/:id`.

Com o servidor Termux ligado, inicie um túnel para o ID do vídeo:

```bash
npm run tunnel -- ID_DO_VIDEO
```

O terminal exibirá a URL pública `/receber/ID_DO_VIDEO`. Use essa URL no player enquanto o processo `npm run tunnel` estiver ativo. O relay aceita um remetente e um receptor por ID; encerre o processo quando terminar.

**Limite importante do relay atual:** ele é um fluxo unidirecional de bytes. Ele não encaminha pedidos HTTP Range do player de volta ao Termux. Portanto, seek funciona na URL direta `/video/:id`, mas não fica disponível através desse túnel simples. Para seek remoto via túnel seria necessário um protocolo bidirecional de controle, o que mudaria o contrato do relay.

## Dynu (opcional)

Preencha `DYNU_HOSTNAME`, `DYNU_USERNAME` e `DYNU_PASSWORD` no `.env` para atualizar o registro IPv6 a cada cinco minutos. Deixe em branco para desativar.

## Observações

O servidor não baixa nem armazena os vídeos inteiros. Ele encaminha os bytes da origem e respeita Range na rota direta. Use somente conteúdo que você tenha autorização para acessar e compartilhar.
