# Reverse proxy and HTTPS

Use an HTTPS address when sharing an instance or installing the PWA on a
phone. reddont can accept HTTP behind a TLS-terminating proxy or serve HTTPS
directly.

## TLS at a reverse proxy

Point the proxy to the app's HTTP listener, normally `http://reddont:3000`
on a shared Docker network or `http://127.0.0.1:3000` on the same host.

- Serve the app at the root of its hostname, such as `https://reddont.example.com/`.
  Routes and assets use root-relative paths; a subpath deployment is not supported.
- Preserve the public `Host` and send the correct `X-Forwarded-Proto`.
- Keep `REDDONT_DISABLE_SSL` unset or `false` when browsers use HTTPS, even
  when the proxy-to-app connection is HTTP.
- Leave `REDDONT_SSL_CERT_PATH` and `REDDONT_SSL_KEY_PATH` unset when the
  proxy handles TLS.

When OIDC or remote header login is active, explicitly set
`REVERSE_PROXY_WHITELIST` to the proxy IPs. Without it, the app's forwarded
request handling falls back to trusting one proxy hop. Header authentication
still separately checks the direct proxy address.

For password-only deployments, leave `REMOTE_HEADER_LOGIN` unset if you do
not use header SSO. In the current version, even the nonempty string `false`
enables Express's proxy-trust setup, although it does not enable header login.

## API requests through a proxy

The API uses the direct TCP peer for both its address allowlist and request
budget. It does not use `X-Forwarded-For` for these checks. If the proxy is
allowed in `API_WHITELIST`, all clients forwarded by that proxy pass the
address check and share its API rate budget; each still needs an API key.

Restrict clients at the proxy when you need a client-specific network rule.
`REVERSE_PROXY_WHITELIST` does not grant API access. See
[API source addresses](../reference/api.md#source-addresses).

## Direct HTTPS

Mount certificate and key files into the container and point reddont at
their container paths:

```yaml
environment:
  REDDONT_SSL_CERT_PATH: "/certs/fullchain.pem"
  REDDONT_SSL_KEY_PATH: "/certs/privkey.pem"
volumes:
  - ./certs:/certs:ro
```

Both paths must be nonempty to start an HTTPS listener. If either is missing,
the app starts HTTP. If both are supplied but cannot be read or used, startup
fails. The runtime user selected by `PUID`/`PGID` must be able to read them.

The HTTPS listener uses `REDDONT_PORT` (default `3000`); there is no second
HTTP listener. Restart the app after renewing its certificates because they
are read at startup.

## Login problems after enabling HTTPS

Clear stale site cookies, reload the page, and check the public scheme,
cookie setting, and proxy headers. With OIDC, the provider callback must
exactly match `OIDC_REDIRECT_URI`, including scheme and path.

See [troubleshooting](../reference/troubleshooting.md).
