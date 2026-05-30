# Domain status and access notes

Last updated: 2026-05-29

## Current state

| Domain | Registered | Role | NRD ages out |
|---|---|---|---|
| `ori-bio.app` | 2026-05-10 | Production primary | ~2026-06-11 |
| `ori-bio.org` | 2026-05-29 | 307 redirect to `.app` (parked hedge) | ~2026-06-28 |

Both domains use Vercel nameservers (`ns1/ns2.vercel-dns.com`), Vercel-managed SSL via Let's Encrypt, and Vercel auto-renew. Vercel CDN active on both.

## The blocking issue

WUSTL's Palo Alto Networks NGFW DNS Security service sinkholes `ori-bio.app` to `sinkhole.paloaltonetworks.com`. Trigger is the Palo Alto "newly-registered-domain" (NRD) classification, which is applied independently from URL Filtering category and lasts roughly 30 days from registration.

Public resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1, Quad9 9.9.9.9) all return correct Vercel Anycast IPs. The block is upstream of Vercel. Nothing in the Vercel project configuration causes or fixes it.

`ori-bio.org` is also NRD-classified starting today; it does not help WUSTL users yet.

## URL to share with colleagues during the block

```
https://ori-bio-git-main-scott-handleys-projects.vercel.app
```

Parent domain `vercel.app` is not NRD-classified. This URL auto-tracks `main`, has a valid TLS cert, and bypasses the sinkhole. Recommend the demo account (`demo@ori.bio` / `plasmids2025`) for testers to avoid OAuth redirect quirks where Supabase's Site URL is the blocked `ori-bio.app`.

Do not share the deployment-specific URL (e.g. `ori-8nrspqtby-...`), it changes with every push.

## Why this project and not the other ~12 Vercel projects

1. `ori-bio.app` is recent (registered 2026-05-10).
2. `.app` is on Google's HSTS preload list at the registry level, which some security vendors weight higher in NRD heuristics.
3. Vercel's shared Anycast IP range (`216.150.x.x`) carries mixed reputation across all hosted projects.

Older projects on aged `.com`/`.io` domains do not trip the same heuristic combination.

## Completed

- Vercel domain config validated (CAA records, certs, nameservers all correct)
- `ori-bio.org` purchased and added to Vercel project as 307 redirect to `ori-bio.app`
- Palo Alto recategorization submitted requesting "Science-and-Technology" (from `handley.scott@gmail.com`)

## Pending

- Update WHOIS registrant on both `.app` and `.org`: WUSTL affiliation, `.edu` email, optionally campus address. Highest-leverage reputation move available.
- Resubmit Palo Alto recategorization at <https://urlfiltering.paloaltonetworks.com/> from the `.edu` email after WHOIS update.
- Optionally ask WUSTL IT to add a DNS Security policy exception for `ori-bio.app` (URL Filtering exception alone is not sufficient; DNS Security has its own list).

## Personal workaround for the maintainer

Set laptop DNS to `1.1.1.1` and `8.8.8.8` (System Settings -> Network -> Wi-Fi -> Details -> DNS). Works if WUSTL VPN is split-tunnel. Full-tunnel VPN forces all DNS through WUSTL resolvers and the sinkhole returns.

## Re-evaluate after 2026-06-11

If `.app` still does not resolve at WUSTL after NRD should have aged out, the recategorization did not take. At that point `.org` becomes the candidate long-term primary (it ages out ~2026-06-28).

Migration cost if switching primaries:

- `app/page.tsx` footer string
- `README.md` references
- Supabase Site URL and allowed redirect URLs
- Google Cloud Console OAuth redirect URIs
- Any other hardcoded `ori-bio.app` strings

Keep `.app` as 307 redirect to `.org` if/when the swap happens.

## Unrelated: Vercel deployment "No Screenshot Available"

Separate root cause, no domain involvement. Landing page in `app/page.tsx` uses `animation-fill-mode: both` with 0.1 to 0.7 second delays on every above-the-fold element. Hero is opacity 0 when Vercel's screenshot bot captures, so the bot sees a blank parchment-colored frame and discards it.

Fix: remove `both` from the `animation` shorthand in the five inline-style blocks in `app/page.tsx` that use `fade-up` or `fade-in`.
