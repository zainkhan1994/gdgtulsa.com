# Security headers and caching

## Where the site actually runs

Despite the domain being managed at IONOS, **IONOS is only the registrar and
DNS provider**. The site itself is hosted on GitHub Pages:

```
gdgtulsa.com.      NS   ns1028.ui-dns.com. (+3)   <- IONOS DNS
gdgtulsa.com.      A    185.199.108-111.153       <- GitHub Pages
www.gdgtulsa.com.  CNAME zainkhan1994.github.io.  <- GitHub Pages
```

This matters because **GitHub Pages does not allow any response header
configuration**. It sends a fixed set:

```
server: GitHub.com
cache-control: max-age=600
```

No CSP, no HSTS, no COOP, no `X-Frame-Options`, and a 10-minute cache lifetime
that cannot be changed. That is the entire reason the remaining audit items are
blocked.

## What is already done, with no infrastructure change

A `Content-Security-Policy` is set on every page with a `<meta http-equiv>` tag,
which GitHub Pages serves happily because it lives in the HTML:

```
default-src 'self';
base-uri 'self';
object-src 'none';
script-src 'self' https://www.gstatic.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self';
font-src 'self';
connect-src 'self' https://www.gstatic.com https://firestore.googleapis.com
            https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;
frame-src https://www.youtube-nocookie.com;
worker-src 'self' blob:;
form-action 'self';
upgrade-insecure-requests
```

`Referrer-Policy: strict-origin-when-cross-origin` is set the same way, via
`<meta name="referrer">`.

Notes on how that policy was reached:

- **No `script-src 'unsafe-inline'`.** The three inline `<script>` blocks were
  moved to `assets/ai-stack.js`, `assets/google-workspace.js` and
  `assets/organizer.js`, and the two inline `onerror=""` handlers were replaced
  with the `data-fallback-*` attributes handled by `assets/image-fallback.js`.
  Hashes were considered and rejected: without a build step they silently break
  the moment someone edits a page.
- **`style-src` keeps `'unsafe-inline'`.** There are 109 inline `style=""`
  attributes plus several `<style>` blocks. Removing them is a much larger
  refactor, and style injection is far lower risk than script injection.
- `worker-src blob:` is required by MapLibre, which builds its worker from a
  blob URL. Without it the globe fails to start.
- `connect-src` lists the Firebase Auth and Firestore endpoints used by the
  member portal. Sign-in breaks without them.
- `img-src blob:` covers the globe's canvas work.

## What still needs real response headers

A `<meta>` tag cannot set these. They need a host that lets you configure
headers:

| Header | Value | Why meta cannot do it |
|---|---|---|
| `Content-Security-Policy: frame-ancestors 'none'` | `'none'` | Ignored in meta by spec |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | No meta equivalent |
| `Cross-Origin-Opener-Policy` | `same-origin` | No meta equivalent |
| `X-Content-Type-Options` | `nosniff` | No meta equivalent |
| `X-Frame-Options` | `DENY` | No meta equivalent |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | No meta equivalent |

`frame-ancestors` and `X-Frame-Options` overlap deliberately: the first is the
modern control, the second is the fallback for older browsers.

## Fixing both this and caching: put Cloudflare in front

The site can stay on GitHub Pages. Cloudflare sits in front as a proxy, which
lets us set headers and cache lifetimes without changing how the site deploys —
`git push` still publishes it.

**This is a live DNS change to a production domain. Agree a time, and expect
propagation to take up to a few hours.**

### 1. Add the site to Cloudflare

1. Create a free Cloudflare account and choose *Add a site* → `gdgtulsa.com`.
2. Cloudflare scans the existing records. Confirm it imported:
   - four `A` records for the apex, pointing at `185.199.108-111.153`
   - the `www` `CNAME` to `zainkhan1994.github.io`
   - **any MX or TXT records** — if email runs on this domain, losing these
     breaks it. Check them against the current IONOS zone before continuing.
3. Set all of the above to **Proxied** (orange cloud). Header rules only apply
   to proxied records.

### 2. Repoint the nameservers at IONOS

In the IONOS control panel, under the domain's DNS settings, replace the
current nameservers with the two Cloudflare gives you.

Current values, for rollback:

```
ns1028.ui-dns.com
ns1039.ui-dns.de
ns1057.ui-dns.org
ns1071.ui-dns.biz
```

### 3. Keep GitHub Pages HTTPS working

Set SSL/TLS mode to **Full** (not Flexible — Flexible causes redirect loops
with GitHub Pages). Leave *Always Use HTTPS* on.

### 4. Add the response headers

Rules → Transform Rules → **Modify Response Header**, applied to all requests:

| Action | Header | Value |
|---|---|---|
| Set | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| Set | `X-Content-Type-Options` | `nosniff` |
| Set | `X-Frame-Options` | `DENY` |
| Set | `Cross-Origin-Opener-Policy` | `same-origin` |
| Set | `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| Set | `Content-Security-Policy` | the policy above, plus `frame-ancestors 'none';` |

Once the CSP is served as a real header, the `<meta>` tags become redundant.
Leave them in place — if Cloudflare is ever removed the site keeps its policy —
but note that where both exist the browser enforces the **stricter** of the two.

### 5. Fix the 10-minute cache

Rules → **Caching Rules**. Asset URLs on this site are already versioned with a
query string (`styles.css?v=…`), so they are safe to cache for a long time.

| Match | Setting |
|---|---|
| `URI Path` matches `\.(css\|js\|png\|jpg\|jpeg\|webp\|svg\|woff2\|mp4\|webm)$` | Edge TTL 1 year, Browser TTL 1 year |
| `URI Path` ends with `.html` or equals `/` | Edge TTL 10 minutes, Browser TTL 0 |

HTML must stay short-lived so deploys appear immediately; the versioned assets
carry the long cache. This is the ~586 KiB the audit flagged.

## Verifying afterwards

```bash
curl -sSI https://gdgtulsa.com | grep -iE \
  'strict-transport|content-security|x-frame|x-content-type|cross-origin|permissions|cache-control'

curl -sSI https://gdgtulsa.com/styles.css | grep -i cache-control
```

Expect the security headers on the HTML response, and a one-year
`cache-control` on the stylesheet.

## The alternative: move hosting to IONOS

If there is already an IONOS hosting plan, an Apache `.htaccess` could set the
same headers directly. That means giving up GitHub Pages and the push-to-deploy
workflow, and setting up separate deployment. Cloudflare in front is less
disruptive and free, which is why it is the recommendation above.
