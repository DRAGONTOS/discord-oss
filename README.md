# Librecord (stable deployment)

This branch is a pull-and-run deployment of Librecord. It pulls the published server and SFU images from GitHub Container Registry, so it needs Docker and nothing else. There is no source, no build configuration and no Node, Bun or Go toolchain here.

Librecord is a self-hosted chat server that speaks Discord's REST API, gateway and voice protocol. It serves the official Discord web client from a local cache with Equicord built in, rebranded with your instance's name and icon.

> Librecord is not made by, affiliated with or endorsed by Discord Inc. Accounts are separate from Discord accounts, and nothing posted on an instance is sent to Discord.

## Run an instance

```sh
git clone -b docker-stable https://github.com/libre-cord/librecord.git && cd librecord
cp .env.example .env
$EDITOR .env
docker compose up -d
docker compose logs -f client
```

Fill in `DOMAIN`, `POSTGRES_PASSWORD`, `WRTC_PUBLIC_IP` and the other values in `.env` before starting. The `client` service downloads the Discord web client into a volume on the first start and exits; the server then listens on `127.0.0.1:32171`. Point a reverse proxy or tunnel at it and open `https://<DOMAIN>/register`.

Open UDP port 50000 for voice, or the port set in `WRTC_PORT`. The published images are public, so no registry login is needed.

## Pin a release

GitHub Actions publishes `ghcr.io/libre-cord/meowcord-server` and `ghcr.io/libre-cord/meowcord-sfu` when a version tag such as `v1.2.3` is pushed from the `production` branch. `latest` tracks the latest release, and each release also gets `sha-<commit>` tags. To pin an exact release:

```sh
MEOWCORD_SERVER_IMAGE=ghcr.io/libre-cord/meowcord-server:v1.2.3 \
MEOWCORD_SFU_IMAGE=ghcr.io/libre-cord/meowcord-sfu:v1.2.3 \
docker compose up -d
```

The same variables can be set in `.env` to make the pin persistent.

## Update

To move to a new release, change the pinned tags or use `latest`, then recreate the containers:

```sh
docker compose pull
docker compose up -d
```

Database migrations run when the server starts. The web client lives in a volume and stays as it is until the client service downloads a new one.

## Files in this branch

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Services, environment, volumes and published image names. |
| `.env.example` | Template for the instance configuration. |
| `assets/collectibles.json` | Bind-mounted into the server for the Shop catalogue. |
| `LICENSE` | GNU AGPL v3.0. |

## Source code

The source, build scripts and documentation live on the [`production`](https://github.com/libre-cord/librecord/tree/production) branch. This branch intentionally has none of them.
