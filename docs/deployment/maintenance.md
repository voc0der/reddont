# Backups and updates

The persistent data directory holds `reddont.db`. It contains accounts,
subscriptions, preferences, invites, API keys, saved Reddit credentials, and
OIDC state. Configuration and `JWT_SECRET_KEY` must be kept separately.

## Find the database

The application chooses its data directory in this order:

1. `REDDONT_DATA_DIR`, when nonempty.
2. `/data`, if that directory exists.
3. `$XDG_DATA_HOME/reddont`, if `XDG_DATA_HOME` is set.
4. `~/.local/share/reddont` for the user running the app.

With the [quick-start setup](../getting-started/quick-start.md), the host copy
is `./reddont-data/reddont.db`.

## Back up

Stop the app while copying its data directory so the SQLite files are
consistent. From the directory containing the quick-start compose file:

```sh
docker compose stop reddont
tar -czf "reddont-backup-$(date +%Y%m%d-%H%M%S).tar.gz" reddont-data compose.yaml .env
docker compose start reddont
```

Adjust the filenames if your compose or secret files live elsewhere. Keep
the backup somewhere access-controlled: it contains credentials as well as
subscriptions. Retain the original `JWT_SECRET_KEY` to keep encrypted OIDC
refresh tokens usable.

## Update

After making a backup:

```sh
docker compose pull
docker compose up -d
docker compose logs --tail=100 reddont
```

The database applies pending migrations at startup. Check that you can sign
in and read your subscriptions after the update. Image tags follow the
application version; change a version pin deliberately when upgrading.

## Restore or roll back

Stop the container. Extract a backup into a separate directory, then restore
its data and configuration to the mounted paths. Set the image version to
the version used for that backup and start the app again.

Preserve ownership for the configured `PUID` and `PGID`. Do not assume an
older app can read a database migrated by a newer release; roll back the
database and image together.

If an existing installation appears empty, first check the volume mapping,
data-directory environment variable, and service user. Do not overwrite the
old database with a newly created empty one.
