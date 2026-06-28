# personal-site (timeriser.com)

This repo lives at `/srv/personal-site` on `ovh-claude`. Caddy serves `starriser/` directly from this checkout on `:8080`, fronted by a Cloudflare Tunnel to `https://timeriser.com`.

**Edits are live the moment you save.** No deploy cycle, no rsync. Caddy reads files from this path on every request.

## Always push after editing

After **every** change to files in this repo (no matter how small), commit and push:

```
git add -A
git commit -m "<concise, lowercase, present-tense message — match the style in git log>"
git push origin main
```

This keeps GitHub in sync with the source of truth (the live site). Skipping this step leaves the laptop clone (`/home/david/repos/personal-site` on `david-pangolin`) silently out of date.

If a push fails (network, auth, conflict), surface the error — don't paper over it with `--force` or by deleting the commit. Most likely cause: someone pushed from the laptop concurrently; do `git pull --rebase` and push again.

## Other notes

- Static site, no build step.
- `starriser/planeta/` is iframed as the WebGL background of `starriser/index.html`. Edits to `planeta/` affect the landing page background.
- Avoid changing `.github/workflows/deploy-timeriser.yml` — it still runs on push but rsyncs to `/var/www/timeriser/` which Caddy no longer reads. It is harmless and serves as a backup; leave it alone unless deleting deliberately.
