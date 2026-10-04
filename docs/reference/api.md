# API and feeds

The read-only API lives at `/api/v1`. It uses a personal API key instead of a
browser login cookie, and reads upstream content using the key owner's
[saved Reddit credential](../usage/preferences.md#reddit-credentials).

## Get a key

Open your dashboard and select **Generate key**. Pass the resulting `reddont_`
key in `X-API-Key` or `Authorization: Bearer <key>`.

```sh
export REDDONT_URL="https://reddont.example.com"
read -r -s -p 'API key: ' REDDONT_KEY
printf '\n'
export REDDONT_KEY

curl --fail-with-body -H "X-API-Key: $REDDONT_KEY" \
  "$REDDONT_URL/api/v1/whoami"
```

These examples use Bash. Regenerating a key invalidates its previous value
immediately; revoking a key removes that user's API access until another is
generated.

## Source addresses

The address check runs before API-key authentication. `API_WHITELIST` defaults
to `127.0.0.1,::1` when unset or empty. Configure it on the server for the
actual clients or network that need access:

```yaml
environment:
  API_WHITELIST: "127.0.0.1,::1,192.168.1.50,172.30.0.0/24"
  API_RATE_LIMIT: "600"
```

Replace the example addresses with your own. IPv4 and IPv6 CIDRs are
supported. `off` disables the API, while `*` allows any address through the
network gate. Keys are still checked.

Both the allowlist and rate limit use the **direct TCP peer**, never
`X-Forwarded-For`. Through Docker or a reverse proxy, that may be a bridge or
proxy address. Allowing a proxy lets its forwarded clients pass this check;
apply any finer network policy at the proxy.

Use the only keyless endpoint to test the address gate:

```sh
curl --fail-with-body "$REDDONT_URL/api/v1/health"
```

An allowed request returns `ok`, `service`, and `source`. Rejected requests
are logged with their source IP. The health probe checks API access and app
responsiveness; it does not test upstream Reddit availability.

## Endpoints

All paths below are relative to `/api/v1` and use `GET`.

| Path | Result | Formats |
| --- | --- | --- |
| `/health` | App and source-address probe; no key required | JSON at this exact path |
| `/whoami` | Key owner's ID, username, admin flag, and source address | JSON at this exact path |
| `/subscriptions` | Key owner's subscription names | JSON at this exact path |
| `/r/<sub>/about` | Community metadata | Bare path or `.json` |
| `/r/<sub>/<sort>` | Community posts in the requested sort | JSON or feed |
| `/r/<sub>` | Community posts, default `hot` or `?sort=` | JSON or feed |
| `/home` | Combined subscriptions; falls back to all when empty | JSON or feed |
| `/comments/<id>` | Submission and comments | JSON or feed |
| `/search?q=...` | Post search, optionally `&subreddit=<sub>` | JSON or feed |

For entries marked **JSON or feed**:

- No extension or `.json` returns JSON.
- `.rss` and `.atom` both return **Atom XML**, not RSS 2.0.
- `?format=rss` or `?format=atom` on the bare path also returns Atom.
- `?raw=1` on a JSON request preserves upstream objects inside the API's
  response envelope. It is not a byte-for-byte copy of the upstream response;
  post self-text is decoded before JSON serialization.

Community names can be joined with `+` for combined post listings. The about
endpoint accepts one community. Use a submission ID such as `abc123` for
comments; a `t3_` prefix is also accepted.

## Query parameters

| Parameter | Behavior |
| --- | --- |
| `limit` | Default `25`, clamped to `1`–`100`. |
| `after`, `before` | Listing pagination cursors. Use the returned `after` for the next page. |
| `sort` | Post listings: `hot`, `new`, `top`, `best`, `rising`, or `controversial`. |
| `t` | Time range: `hour`, `day`, `week`, `month`, `year`, or `all`; relevant to time-based sorts. |
| `q` | Required search query for `/search`. |
| `subreddit` | Optional community scope for `/search`. |
| `raw` | `1` or `true` for upstream objects in a JSON response. |

Unknown listing parameters are dropped. An invalid explicit sort in the path
returns `400`; an invalid listing `?sort=` falls back to `hot`. Search passes
its separate alphabetic sort value upstream, such as `relevance` or `new`.
The comments endpoint forwards `limit`, not listing pagination or time filters.

## Examples

=== "Latest posts"

    ```sh
    curl --fail-with-body -H "X-API-Key: $REDDONT_KEY" \
      "$REDDONT_URL/api/v1/r/selfhosted/new.json?limit=25"
    ```

=== "Subscription feed"

    ```sh
    curl --fail-with-body -H "X-API-Key: $REDDONT_KEY" \
      "$REDDONT_URL/api/v1/home.rss?sort=new"
    ```

=== "Search"

    ```sh
    curl --fail-with-body -G -H "X-API-Key: $REDDONT_KEY" \
      --data-urlencode "q=home server" \
      --data-urlencode "subreddit=selfhosted" \
      --data-urlencode "sort=new" \
      "$REDDONT_URL/api/v1/search.json"
    ```

### Feed readers

Prefer an API-key header when the reader supports it. Otherwise add
`?api_key=<your-key>` to a feed URL (or `&api_key=` if it already has a query).
The alias `key=` is also accepted.

reddont redacts query keys from its API log messages and the feed's self
link. Proxies, browser history, and feed readers may still store the complete
URL, so treat a feed URL containing a key as a credential.

### JSON shape

Post listings contain `kind`, `subreddit`, `sort`, `after`, `count`, and
`posts`. Normalized posts include identifiers, title, author, links,
timestamps, score, comment count, content flags, thumbnail, and self-text.

Search responses contain `kind`, `query`, `subreddit`, `after`, `count`, and
`results`. Comment responses contain `kind`, `id`, `submission`, and a
flattened `comments` array. Raw comment responses retain the upstream comment
structure instead. Render any returned user content with appropriate escaping.

## Errors and rate limits

| Status | Meaning |
| --- | --- |
| `400` | Invalid input, such as a missing search query or unknown path sort. |
| `401` | Missing or invalid API key. |
| `403` | Source address is not allowed, or API access is disabled. |
| `404` | Unknown API endpoint. |
| `429` | API request budget exhausted. |
| `502` | Upstream content was unavailable or could not be fetched. |
| `500` | Internal request failure. |

The default budget is 600 requests per 15 minutes per direct peer, including
the health probe. Browser requests have their own limit. Reduce polling
frequency when limited and inspect the response's rate-limit headers.
