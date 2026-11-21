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
- `/stats`: sessões ativas, processos FFmpeg, uso de memória e tamanho/quantidade do cache local.
- `/catalog.json`: metadados dos vídeos.
- `/playlist.m3u`: playlist direta, usando `/video/:id`.
- `/playlist-hls.m3u`: playlist HLS, usando `/hls/:id/index.m3u8`.
- `/video/:id`: proxy original com encaminhamento de HTTP Range.
- `/hls/:id/index.m3u8`: HLS gerado sob demanda pelo FFmpeg.
- `/hls/:id/segment_000000.ts`: segmentos HLS do vídeo.

Para testar HLS, abra no player `http://IP-DO-TERMUX:18080/hls/ID_DO_VIDEO/index.m3u8` ou carregue a playlist `/playlist-hls.m3u`.

## Segmentação e cache

O FFmpeg usa `-c copy` para copiar os fluxos de áudio e vídeo sem reencodificação. A duração de 4 segundos é um alvo: os cortes reais dependem dos keyframes presentes no vídeo e podem ficar maiores. A leitura é limitada à velocidade normal do vídeo (`-re`) para o FFmpeg não consumir a origem inteira depressa demais. A janela padrão mantém aproximadamente 180 segundos de segmentos, configurável por `HLS_CACHE_SECONDS`. Como é uma janela deslizante, voltar para trechos antigos pode deixar de funcionar depois que os segmentos saírem do cache. O servidor Termux mantém essa janela local e, quando entrega a playlist HLS, sincroniza os segmentos referenciados com o cache RAM do Hostless. A playlist recebida pelo player aponta diretamente para `https://melissa-iptv.hostless.app/cache/...`; assim, o Hostless entrega os bytes e atende requisições HTTP Range sem transformar os segmentos em um fluxo contínuo.

A cópia de streams não ganha muito com multithread de codificação, pois não há codificação. O trabalho é limitado principalmente pela leitura da origem, rede e gravação dos segmentos. O servidor inicia um único processo FFmpeg por vídeo enquanto o processo está ativo.

**Compatibilidade:** stream copy não converte codecs. HLS MPEG-TS funciona melhor quando a origem contém vídeo H.264 e áudio AAC. Se a combinação de codecs/container não for compatível com MPEG-TS, o FFmpeg pode falhar; nesse caso, o endpoint direto `/video/:id` continua disponível.

## Playlist pública pelo Hostless

O próprio `npm start` conecta automaticamente o servidor ao tunnel reverso, sem senha ou token. O player pode carregar diretamente:

```
https://melissa-iptv.hostless.app/iptv/playlist-hls.m3u8
```

O Hostless encaminha playlist e manifests ao Termux. Os segmentos HLS continuam sendo publicados no cache RAM do Hostless e a playlist aponta para esses segmentos públicos. O player não precisa conhecer o IP do Termux, executar comandos, informar IDs ou enviar tokens.

Não é necessário configurar credenciais em nenhum dos dois servidores. O player também não envia código, senha, ID ou cabeçalho especial.

## Catálogo

O catálogo é atualizado a cada 5 minutos por padrão e fica em `data/videos.json`. Se a atualização falhar, o último catálogo válido permanece em uso. Atualização manual:

```bash
npm run catalog
```

## Hostless: tunnel e cache HLS

O tunnel antigo continua independente e envia um único fluxo de bytes por `POST /enviar/:id`, entregando-o por `GET /receber/:id`:

```bash
npm run tunnel -- ID_DO_VIDEO
```

Esse caminho continua linear e não oferece seek. Para HLS, o servidor usa a API separada de cache de segmentos: consulta `GET /cache/:stream`, envia os segmentos ausentes por `POST /cache/:stream/:segment` e reescreve as URIs da playlist para o Hostless. O player solicita cada segmento diretamente ao Hostless, que responde com suporte a HTTP Range (206). Cada execução FFmpeg usa um identificador de stream exclusivo para evitar misturar segmentos antigos após reinícios.

Se o Hostless estiver indisponível ou um envio falhar, o servidor mantém a URL local do Termux para aquele segmento. Isso preserva a reprodução local como fallback. O cache remoto usa 512 MiB totais e 16 MiB por segmento por padrão; segmentos maiores que o limite não são enviados e permanecem disponíveis localmente.

## Configuração

Edite `.env`:

- `HLS_SEGMENT_SECONDS=4`: duração-alvo de cada segmento.
- `HLS_CACHE_SECONDS=180`: tamanho temporal aproximado da janela de cache.
- `FFMPEG_PATH=ffmpeg`: executável do FFmpeg.
- `HLS_MAX_JOBS=2`: limite de processos FFmpeg simultâneos.
- `HLS_IDLE_MS=90000`: encerra uma geração HLS sem pedidos após 90 segundos.

O endpoint `/stats` mostra as métricas locais. Processos HLS sem requisições por 90 segundos são encerrados; registros de processos finalizados expiram após uma hora; diretórios HLS sem atividade por mais de 24 horas são removidos periodicamente. Sessões ativas protegem seus processos da limpeza automática.
- `TUNNEL_RELAY_URL`: endereço do relay usado pelo comando de tunnel.
- `HOSTLESS_CACHE_ENABLED=true`: ativa a publicação de segmentos HLS no cache remoto.
- `HOSTLESS_CACHE_URL`: URL base do serviço Hostless que recebe os segmentos.
- `HOSTLESS_CACHE_TTL_SECONDS`: validade dos segmentos remotos (padrão: janela HLS + 120 segundos; máximo: 3600).

Não coloque senhas ou tokens no GitHub. O servidor não reencoda nem baixa deliberadamente o vídeo inteiro para um único arquivo; ele gera segmentos conforme o FFmpeg lê a origem. Use apenas conteúdo que você tenha autorização para acessar e compartilhar.
