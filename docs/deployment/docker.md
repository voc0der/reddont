# Docker and storage

The image is `ghcr.io/voc0der/reddont`. Use `:latest` for the current main
build or `:0.1.0` for the release version. Images are built for Linux amd64
and arm64. For an exact image pin, use its digest; a version tag can be
rebuilt while the application version stays the same.

Start with the working [quick-start compose file](../getting-started/quick-start.md).

## Persistent data

Mount a host directory or named volume at `/data`. The app stores
`reddont.db` there, including accounts, subscriptions, preferences, invites,
API keys, and saved Reddit credentials.

```yaml
volumes:
  - ./reddont-data:/data
```

`PUID` and `PGID` default to `1000`. The entrypoint creates a matching
container user/group when necessary, adjusts ownership of `/data` and the
application directory, and then runs the app as that user. Set those variables
instead of adding Compose's `user:` setting, which would prevent the
entrypoint from doing its initial setup.

Back up both the data directory and your configuration. See
[backups and updates](maintenance.md).

## Ports

The application listens on `0.0.0.0:3000` by default. A mapping such as
`127.0.0.1:9495:3000` makes it available on the Docker host at port `9495`.
The final number must match `REDDONT_PORT` inside the container.

For a reverse proxy in another container, attach both services to the same
Docker network and use `http://reddont:3000` as the upstream address. You can
remove the host `ports:` mapping if all traffic arrives through that proxy.
Keep `HTTP_BINDING=0.0.0.0` inside the app container so the proxy can reach it.

## Apply configuration changes

After editing environment variables, recreate the container:

```sh
docker compose up -d
docker compose logs --tail=100 reddont
```

`docker compose restart` alone does not apply an edited container environment.
See the [environment reference](../reference/environment.md) for defaults.

## Check API network access

The API defaults to loopback-only access. Requests through a published Docker
port or another container can have a bridge or proxy address, so a request
from the host may need an explicit `API_WHITELIST` entry.

From an allowed client, `GET /api/v1/health` reports the source address reddont
sees. Rejected requests log that address. This setting is separate from
`REVERSE_PROXY_WHITELIST`; see [API access control](../reference/api.md#source-addresses).

## Build the image locally

From a checkout of the repository:

```sh
docker build -t reddont:local .
```

Set `image: reddont:local` in your compose file to use it. Documentation,
Python environments, local screenshots, and databases are excluded from the
Docker build context.

## Full compose reference

The repository's compose file lists the available deployment settings. Adapt
its port binding, secret, and cookie settings to your installation; the
quick start above supplies a local HTTP configuration.

```yaml
--8<-- "docker-compose.yaml"
```
