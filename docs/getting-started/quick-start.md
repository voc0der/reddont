# Quick start

This starts reddont with Docker Compose on your own machine. For a shared
instance, set up [HTTPS](../deployment/reverse-proxy.md) after the first
account is ready.

## 1. Create a compose file

Save this as `compose.yaml` in a new directory:

```yaml
services:
  reddont:
    image: ghcr.io/voc0der/reddont:latest
    container_name: reddont
    environment:
      PUID: "1000"
      PGID: "1000"
      REDDONT_PORT: "3000"
      REDDONT_DISABLE_SSL: "true"
      JWT_SECRET_KEY: "${JWT_SECRET_KEY:?Set JWT_SECRET_KEY in .env}"
    volumes:
      - ./reddont-data:/data
    ports:
      - "127.0.0.1:3000:3000"
    restart: unless-stopped
```

Use `id -u` and `id -g` to find the user and group IDs that should own the
data directory. Create a stable session secret in `.env`:

```sh
printf 'JWT_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" > .env
chmod 600 .env
```

Do this once in the new directory. Keep `.env` across restarts and updates.
The secret signs sessions and is also used to encrypt OIDC refresh tokens.

!!! note "HTTP for this local setup"

    The example publishes only on the host's loopback interface.
    `REDDONT_DISABLE_SSL=true` allows the login cookie over HTTP; it does
    not change how the server listens. For a public HTTPS address, remove
    that setting or set it to `"false"`.

## 2. Start reddont

```sh
docker compose pull
docker compose up -d
docker compose logs reddont
```

Open <http://localhost:3000/register> on the Docker host. If your host is
remote, use an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 user@host`) or follow
the [reverse proxy guide](../deployment/reverse-proxy.md).

## 3. Create your account

The first registered account becomes an administrator. After that, new
password accounts need an invite. Select your username to open the dashboard
and choose **create invite** when you want to add another person.

An account on reddont is separate from a Reddit account. You do not need a
Reddit credential for the initial setup.

## 4. Build your home feed

Open **subs**, use **++** to add community names, or subscribe from a
community's page. Home combines your subscriptions. With none saved, it
falls back to the all feed.

Open your dashboard to select a theme, turn on infinite scrolling, or adjust
thumbnail quality. Continue with [browsing](../usage/browsing.md) and
[preferences](../usage/preferences.md).

## Next steps

- [Docker and storage](../deployment/docker.md): ports, volumes, and the full compose example.
- [Single sign-on](../administration/sso.md): OIDC or remote header authentication.
- [API and feeds](../reference/api.md): personal keys and feed readers.
- [Backups and updates](../deployment/maintenance.md): preserve accounts and subscriptions.
- [Local development](../development/index.md): run directly with Bun.
