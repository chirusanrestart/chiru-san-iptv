# Chiru-san IPTV 📺

Servidor pessoal para Termux. O Termux mantém o catálogo do Google Fotos, entrega o vídeo original por HTTP Range e pode gerar HLS sob demanda com FFmpeg em **stream copy** (sem reencodar). O Hostless permanece como relay unidirecional de bytes.

## Instalação

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git ffmpeg
git clone https://github.com/chirusanrestart/chiru-san-iptv.git
cd chiru-san-iptv
npm install
cp .env.example .env
npm start
```

Servidor padrão: `http://127.0.0.1:18080/`.

## Rotas

- `/health`: estado do servidor, catálogo e parâmetros HLS.
- `/catalog.json`: metadados dos vídeos.
- `/playlist.m3u`: playlist direta, usando `/video/:id`.
- `/video/:id`: proxy original com encaminhamento de HTTP Range.
- `/hls/:id/index.m3u8`: HLS gerado sob demanda pelo FFmpeg.
- `/hls/:id/segment_000000.ts`: segmentos HLS do vídeo.

Para testar HLS, abra no player `http://IP-DO-TERMUX:18080/hls/ID_DO_VIDEO/index.m3u8`.

## Segmentação e cache

O FFmpeg usa `-c copy` para copiar os fluxos de áudio e vídeo sem reencodificação. A duração de 4 segundos é um alvo: os cortes reais dependem dos keyframes presentes no vídeo e podem ficar maiores. A janela padrão mantém aproximadamente 180 segundos de segmentos, configurável por `HLS_CACHE_SECONDS`. Como é uma janela deslizante, voltar para trechos antigos pode deixar de funcionar depois que os segmentos saírem do cache.

A cópia de streams não ganha muito com multithread de codificação, pois não há codificação. O trabalho é limitado principalmente pela leitura da origem, rede e gravação dos segmentos. O servidor inicia um único processo FFmpeg por vídeo enquanto o processo está ativo.

**Compatibilidade:** stream copy não converte codecs. HLS MPEG-TS funciona melhor quando a origem contém vídeo H.264 e áudio AAC. Se a combinação de codecs/container não for compatível com MPEG-TS, o FFmpeg pode falhar; nesse caso, o endpoint direto `/video/:id` continua disponível.

## Catálogo

O catálogo é atualizado a cada 5 minutos por padrão e fica em `data/videos.json`. Se a atualização falhar, o último catálogo válido permanece em uso. Atualização manual:

```bash
npm run catalog
```

## Tunnel Hostless

O tunnel atual envia um único fluxo de bytes por `POST /enviar/:id` e entrega por `GET /receber/:id`:

```bash
npm run tunnel -- ID_DO_VIDEO
```

Esse contrato não transporta a playlist HLS e os vários segmentos como recursos separados, nem encaminha Range de volta ao Termux. Portanto, o HLS e o seek devem ser testados pela URL direta do Termux nesta versão; pelo Hostless, o tunnel continua sendo um fluxo linear sem seek. Para HLS remoto seria necessário ampliar o protocolo do relay para multiplexar pedidos e respostas, o que ainda não foi implementado.

## Configuração

Edite `.env`:

- `HLS_SEGMENT_SECONDS=4`: duração-alvo de cada segmento.
- `HLS_CACHE_SECONDS=180`: tamanho temporal aproximado da janela de cache.
- `FFMPEG_PATH=ffmpeg`: executável do FFmpeg.
- `TUNNEL_RELAY_URL`: endereço do relay Hostless.

Não coloque senhas ou tokens no GitHub. O servidor não reencoda nem baixa deliberadamente o vídeo inteiro para um único arquivo; ele gera segmentos conforme o FFmpeg lê a origem. Use apenas conteúdo que você tenha autorização para acessar e compartilhar.
