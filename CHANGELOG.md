# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Saved posts, for the post half of #87. Turn on **Enable saved posts** in
  the preferences, and posts offer **save** (beside **share** on desktop, in
  the **⋯** menu on a phone) and **unsave** once saved. **saved** opens them,
  most recent first; it sits between your username and **preferences** on
  desktop, and in the navigation drawer and account menu on a phone. Saves
  belong to the reddont account, not to Reddit, and turning the preference
  off hides them without deleting them

## [0.1.13] - 2026-11-06

### Security

- Signing in could send a browser to another site: a `?redirect=` path with
  dot segments, such as `/a/..//evil.com`, became `//evil.com` after it was
  checked. Redirect targets are now checked as a browser reads them
- An `API_WHITELIST` range with a malformed prefix length, such as
  `10.0.0.0/` with the length left out, let every address of its family reach
  the API. A malformed range now lets none through
- A post whose link isn't an http or https URL, such as `javascript:`, no
  longer gets a clickable link
- Every response sends `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`, and no
  `X-Powered-By`. Other sites, dashboards included, can no longer show reddont
  in a frame, and links to other sites no longer tell them the page they came
  from
- Stored OIDC refresh tokens decrypt only with GCM's full 16-byte tag, and
  OIDC claim paths read only the claims' own properties

### Changed

- The image installs only runtime packages, without development or peer
  dependencies or the install cache, takes Debian's security updates when it
  is built, and drops privileges with util-linux's `setpriv` instead of `gosu`.
  Publishing scans each image and stops on a high or critical vulnerability
  that has a fix

### Fixed

- Saving a bearer token of nothing but quotes cleared the saved Reddit
  credential; it is now refused. A pasted `Authorization:` line with another
  scheme, such as Basic, is refused with a message instead of being saved
  empty

## [0.1.12] - 2026-11-05

### Added

- **Reddit OAuth App ID** under the dashboard's Reddit authentication, as in
  teddit's `use_reddit_oauth`: paste an installed app's ID and reddont reads
  oauth.reddit.com with the app's token, renewing it before it expires. Save
  it beside a cookie and choose which one goes first under **Try First**; when
  Reddit refuses one, reddont repeats the request with the other. An app can
  be shared with users who have no Reddit authentication, like a cookie, and
  they get its owner's order
- `USE_REDDIT_OAUTH=true` with `REDDIT_APP_ID`, teddit's settings, give the
  whole instance an OAuth app: users without their own authentication use it
  first, and everyone else falls back to it. reddont asks Reddit for its token
  at startup and logs whether it got one. **Requests use** on the dashboard
  lists the order a user's requests follow

### Fixed

- A bearer token saved as the Reddit credential was sent to www.reddit.com,
  which refuses bearer tokens; it now goes to oauth.reddit.com

## [0.1.11] - 2026-11-05

### Fixed

- Feeds and post searches failed again when using a Reddit cookie:
  old.reddit.com now blocks `/api/info.json` for cookie sessions, so reddont
  loads the posts from `/api/info.api`, which returns the same JSON

## [0.1.10] - 2026-11-04

### Fixed

- **load more comments** failed with "Could not load comments. Try again." on
  every thread when using a Reddit cookie: old.reddit.com now blocks
  `/api/morechildren.json` for cookie sessions, so reddont requests
  `/api/morechildren.api`, which returns the same comments

## [0.1.9] - 2026-11-03

### Fixed

- The home feed showed "Feed unavailable" when using a Reddit cookie:
  old.reddit.com redirects a feed of several communities to their canonical
  spelling, and reddont treated the redirect as a refusal. It now follows a
  redirect to the same kind of page on old.reddit.com and goes to the canonical
  page directly on later loads; a redirect it doesn't follow is logged with
  its location

## [0.1.8] - 2026-11-03

### Fixed

- Feeds and post searches failed when using a Reddit cookie: Reddit now blocks
  its JSON feeds and search for cookie sessions on old.reddit.com too, so
  reddont reads the order of posts from old reddit's feed and search pages and
  loads the posts from Reddit's `/api/info.json`

## [0.1.7] - 2026-10-31

### Fixed

- On desktop, a link post without a thumbnail showed a grey rectangle; it now
  shows a grey circle with a link icon, as self posts and old reddit do

## [0.1.6] - 2026-10-31

### Changed

- With a Reddit cookie, subreddit sidebars, discussions, and comment threads
  also load from old.reddit.com, so every Reddit request goes there instead of
  breaking as www.reddit.com blocks more endpoints for cookie sessions

### Fixed

- Post and community searches failed when using a Reddit cookie: www.reddit.com
  now blocks search for cookie sessions, so searches load from old.reddit.com,
  and refused searches are logged with Reddit's status
- Community search showed an error page when Reddit returned nothing; it now
  says "search failed, try again later", as post search does

## [0.1.5] - 2026-10-29

### Changed

- On phones, loading more replies shows a spinner in place of the group's icon
  instead of "Loading…" text

### Fixed

- **all** showed "Feed unavailable" when using a Reddit cookie: www.reddit.com
  now blocks that feed for cookie sessions, so feeds load from old.reddit.com,
  and refused feed requests are logged with Reddit's status

## [0.1.4] - 2026-10-23

### Fixed

- **load more comments** failed with "Could not load comments. Try again." on
  groups of more than about 6,000 replies: the request carrying their IDs
  passed the server's 100 KB body limit. That request now accepts up to 2 MB

## [0.1.3] - 2026-10-23

### Fixed

- **load more comments** failed with "Could not load comments. Try again." on
  every thread when using a Reddit cookie: www.reddit.com now blocks its
  load-more endpoint for cookie sessions, so batches load from old.reddit.com,
  and refused requests are logged with Reddit's status
- Comment pages and **continue this thread** failed with a TypeError when
  Reddit returned nothing; they now show an error page with a link to the
  thread on Reddit. Reddit returns 404 for **continue this thread** on comments
  posted since 2026-10-21

## [0.1.2] - 2026-10-19

### Fixed

- Feeds and post pages failed to load with a TypeError when a gallery post
  listed an image missing from Reddit's `media_metadata`; that image now gets a
  best-guess `.jpg` link, and a gallery with no images shows as a plain post

## [0.1.1] - 2026-10-08

### Added

- Post search offers old reddit's sort, time range, and NSFW options on the
  search page, the desktop sidebar box, and the results page; on a community's
  pages, the sidebar search starts limited to that subreddit
- Search results list matching subreddits above the posts, with join and
  search-within links, add sorted by and links from menus, and page forward
  with the same options
- A preference shares your Reddit cookie with signed-in users of the instance
  who have no saved credential; it is off by default, personal credentials take
  priority, and bearer tokens are never shared

### Changed

- The home, all, and popular feeds show only posts from the past week in all
  five sorts, keeping Reddit's order and fetching ahead to fill filtered pages;
  their time ranges stop at a week, and saved back-navigation pages expire when
  a displayed post leaves the range
- Community feeds keep older posts but put posts from the past week first on
  each page; top and controversial default to all time
- Failed feeds, including infinite-scroll pages, show a recovery page that
  explains Reddit authentication and links to its settings

### Fixed

- Going back to an infinitely scrolled feed after opening a post reloaded only
  its first page whenever the browser had not kept the feed in memory, as phones
  often do, so you lost your place; the feed now comes back with the posts
  already loaded, scrolled to where you left it
- A failed upstream search showed an error page instead of a message
- The desktop header's wordmark now shares the page name and sort tabs'
  baseline, and the search buttons match the input's height

## [0.1.0] - 2026-10-06

### Added

- Initial reddont release, including the existing client, mobile layouts, SSO,
  user preferences, PWA support, and authenticated read-only API
- RES keyboard navigation on desktop: j and k select posts and comments, x or
  Enter expands or collapses the selection, and c opens a post's comments
- RES's subreddit list under "my subreddits": filter your subscriptions, press
  Enter to open the first match, and sort by name or by when you last visited
  each one in this browser
- Desktop comment buttons for permalink, parent, and hiding child comments,
  plus "hide all child comments" on the post
- `branding/` holds the logo's SVG sources, wordmarks, one-color versions, and
  PNGs from 64 to 1024px

### Changed

- Rename the application, configuration variables, data paths, API key prefix,
  container images, and Nix package to reddont
- Publish container images from the new repository's main branch, tagged with
  both latest and the application version
- Desktop pages (768px and wider) now mirror old reddit as Reddit Enhancement
  Suite shows it: the subreddit bar with a "my subreddits" menu and your
  subscriptions, sort tabs beside the logo, ranked listings with thumbnails,
  taglines, and RES expando buttons, a sidebar with search and the
  community's description, and boxed comments with [–] toggles and OP,
  moderator, and admin badges
- "show images" switches desktop feeds to card view, and galleries step
  through their images one at a time
- On desktop, the Dark and RES Night Mode themes use RES's night mode colors
  and Light uses old reddit's
- Desktop text follows old reddit's sizes and grows on viewports wider than
  1920px; windows narrower than 900px move the sidebar below the listing
- Desktop pages use old reddit's Verdana and Arial fonts, so the Inter web font
  is no longer loaded from rsms.me
- Feeds number posts across pages, and the home feed's next page stays on home
- reddont has a logo, a speech bubble holding a slashed R. It is the browser
  tab icon, the desktop header logo, and the icon of the installed app and the
  documentation site, replacing the generated letter icons

### Removed

- The "Classic RES-style Layout" preference; old reddit is now the desktop
  layout for everyone
- The generated `/icon-<size>.png` images; app icons are static files under
  `/icons/`

### Fixed

- Load more comments loads a batch of sibling comments and their replies
  instead of stopping after one comment's subtree
- Next and previous links in the single comment thread pointed at list
  positions instead of comments, and its header showed you as logged out
- App icons were SVG files served under .png names, which iOS does not accept
  for home screen icons; they are now PNGs, with maskable versions for Android
  launchers

### Security

- The infinite-scroll script placed request values inside JavaScript strings,
  so a crafted link could run script; it now reads them from data attributes

## Inherited project history

The entries below describe development before reddont 0.1.0.

## Previously unreleased

### Changed

- Phone-width layout (below 768px) now mirrors reddit's mobile web: header with
  a navigation drawer, subreddit banner and community header with Join and
  Feed/About tabs, reddit-style post cards (author or community avatar, flair,
  link URL, thumbnail badge, vote/comment/share pills), media letterboxed into a
  square over a blurred backdrop, a "Find anything" search bar on the home feed,
  and threaded comments with avatars, OP/MOD labels, and thread connectors
- Phones render in the system font, as reddit does; Inter now loads only on
  desktop
- Stickied moderator comments start collapsed on phones
- Feed and comment requests ask reddit for `sr_detail`, so community icons need
  no extra requests

Desktop rendering is unchanged.

## [0.3.0] - 2026-08-07

### Added

- Per-user API keys, generated, rotated, and revoked from the dashboard, that
  authenticate a read-only `/api/v1` surface without a browser session
- API requests reuse the key owner's stored Reddit credential (burner bearer
  token or cookie), so automations share reddont's authenticated session instead
  of hitting Reddit anonymously
- `/api/v1` endpoints for subreddit listings, the subscription home feed,
  comment threads, search, subreddit metadata, and subscriptions, each available
  as an Atom feed shaped like Reddit's own `.rss`, as normalized JSON, or as
  Reddit's raw listing JSON via `?raw=1`
- `API_WHITELIST` gates the API by source address (the direct TCP peer, never
  `X-Forwarded-For`), defaulting to loopback only, and accepting plain IPs, IPv4
  and IPv6 CIDR ranges, `off`, or `*`
- `API_RATE_LIMIT` gives the API its own request budget (default 600 per 15
  minutes), keyed on the same peer address as the whitelist so a forwarded
  header cannot rotate around it
- API keys supplied as `?api_key=` are redacted from logs, error messages, and
  the Atom `rel="self"` link so they do not persist in feed readers
- Database migration: add-api-key-column

## [0.2.4] - 2026-07-31

### Fixed

- Detect link posts that Reddit returns without a `post_hint`, so posts with no
  thumbnail render a clickable external-link glyph instead of an empty gray
  placeholder and regain their external-link action chip
- Added a hover and keyboard-focus state to the thumbnail-less link preview so
  it reads as interactive

## [0.2.3] - 2026-07-31

### Added

- Added RES-style discussion thumbnails for Reddit text posts: the main glyph
  opens the full post while a small expando toggles a formatted inline preview
- Added responsive, keyboard-accessible text previews to compact feeds, search
  results, crossposts, and posts loaded by infinite scroll

### Fixed

- Decode self-text in compact listings and nested crossposts so inline previews
  render formatted content instead of encoded markup

## [0.2.2] - 2026-07-30

### Fixed

- Fixed expanded Reddit videos failing in Vivaldi and Chromium-based mobile
  browsers that advertise unusable native HLS support
- Initialize DASH before expanded playback to retain audio, with automatic MP4
  recovery when adaptive playback fails
- Release the thumbnail decoder while a mobile video is expanded and restore
  thumbnail playback when it is closed
- Explicitly play only visible video thumbnails, pause offscreen videos, and
  initialize thumbnails added by infinite scroll
- Retry thumbnail playback with Reddit's alternate MP4 when the preferred
  quality cannot be decoded
- Keep cross-origin media and byte-range requests out of the app service
  worker's HTML/offline cache path

## [0.2.1] - 2026-07-30

### Changed

- Renamed the personalized subscription feed heading from `reddont` to `home`

## [0.2.0] - 2026-07-30

### Added

- Reddit-inspired responsive feed with right-aligned thumbnails, compact post
  metadata, action chips, and full-width expanded media
- Responsive app navigation and compact feed sorting/view controls
- Per-user Reddit auth settings in the dashboard for bearer tokens or cookie headers
- Add /r/popular link to navigation menu (next to /r/all)
- High-resolution thumbnail support using Reddit preview images (like RES)
  - Uses preview.images API for 640x640+ quality instead of low-res 70x70 thumbnails
  - User preference toggle in dashboard (enabled by default)
  - Low-bandwidth option available by disabling high-res thumbnails
- New database migration for `highResThumbnails` user preference

### Changed

- Updated light, dark, and automatic themes to use Reddit-inspired colors
- Centered the feed on desktop while keeping posts edge-to-edge on mobile
- Kept the optional classic layout compact on desktop without breaking expanded
  media
- Updated `postThumbnail()` function to accept user preference parameter
- Enhanced navigation header to include popular subreddit access
- Improved image quality across all post listings

### Fixed

- Fixed expanded videos breaking after Android browsers entered fullscreen
- Prepare HLS/DASH before mobile playback and automatically restore the fallback
  MP4 when DASH playback fails
- Fixed compact expanded media rendering beside and underneath post text instead
  of in a full-width row
- Pause expanded videos when their post is collapsed
- Video preview quality in compact view now uses fallback_url (full quality) instead of scrubber_url (low quality)
- Video previews now respect the same `highResThumbnails` user preference toggle
  - High-res enabled: uses fallback_url (full quality MP4)
  - High-res disabled: uses scrubber_url (low quality for bandwidth savings)
- Removed hardcoded 100px x 100px dimensions from video preview, now responsive via CSS

### Technical

- Added keyboard-accessible thumbnail expansion and semantic navigation markup
- Added local DASH playback support with a mobile-safe MP4 fallback
- Database migration: add-reddit-auth-headers-column
- Database migration: add-high-res-thumbnails-column
