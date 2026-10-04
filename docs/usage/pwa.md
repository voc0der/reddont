# Install as an app

reddont provides a web app manifest and service worker, so compatible browsers
can install it with an app icon and a standalone window.

## Install

Use your instance's HTTPS address for installation on another device. Browser
installation controls vary, but common routes are:

- **Android:** open the browser menu and choose **Install app** or **Add to Home screen**.
- **iPhone or iPad:** open the site in Safari, choose **Share**, then **Add to Home Screen**.
- **Desktop:** use the browser's install control when offered.

Sign in through the installed app as needed. It uses the same instance and
account data as the website.

## Offline behavior

The service worker caches selected resources and provides an offline fallback
page. Some previously visited pages may be available from cache. New feeds,
searches, and uncached media still need a network connection; this is not a
downloaded archive of your subscriptions.

## Refresh after an update

Reload or close and reopen the installed app after updating the server. If
old assets persist, clear the browser's site data and reopen the instance.
Clearing site data also removes the local session, so you will need to sign
in again.

See [HTTPS setup](../deployment/reverse-proxy.md) if installation is unavailable.
