# Video Dancer beta download page

A password page in front of the installers, on Cloudflare (a Worker and a private R2 bucket). The
password is a Cloudflare secret, checked on Cloudflare and never sent to the page. Ten tries a minute
per visitor. Installed copies keep updating from GitHub Releases.

Run these from this folder (`beta-gate`).

## Once, on your account

1. In the Cloudflare dashboard, switch R2 on. The free tier covers this (10 GB stored, downloads free).
2. `npx wrangler login` (opens your browser).
3. `npx wrangler r2 bucket create vidancer-beta`
4. `npx wrangler secret put BETA_PASSWORD` (it asks for the password; type it there).
5. `npx wrangler deploy` prints the page's address (`https://vidancer-beta.<your name>.workers.dev`).

## Each release

`npx wrangler r2 object put vidancer-beta/VideoDancer-Windows-Setup.exe --file <the installer> --remote`
(and `VideoDancer-Mac.dmg` for the Mac one). The release workflow does this itself once the repo has
the secrets `CLOUDFLARE_API_TOKEN` (an API token with R2 edit) and `CLOUDFLARE_ACCOUNT_ID`.

To change the password: `npx wrangler secret put BETA_PASSWORD` again.
