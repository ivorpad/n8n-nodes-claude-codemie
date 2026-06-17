# n8n-nodes-claude-codemie

CodeMie SSO proxy companion for [`n8n-nodes-claude-agent-sdk`](https://github.com/ivorpad/n8n-nodes-claude-agent-sdk).

Installing this package into your self-hosted n8n is the feature flag: the Claude
Agent SDK node detects it at load and adds a **CodeMie Proxy** authentication
option. There is no environment variable to toggle. Authenticate to CodeMie
entirely from the n8n UI — no terminal required.

## How it works

1. The main node detects this package via `require.resolve('n8n-nodes-claude-codemie')`.
2. You create a **CodeMie SSO API** credential (instance URL + a pasted SSO login token).
3. On the Claude Agent SDK node, an **Authenticate** link opens CodeMie sign-in; you
   copy the token from the redirect page into the credential and click **Test**.
4. **Test** decodes the token, stores the SSO session where the CodeMie proxy daemon
   reads it, starts/reuses the daemon (`@codemieai/code`), and verifies by listing models.
5. At execution the node points Claude at the local proxy:
   `ANTHROPIC_BASE_URL=<proxy>`, `ANTHROPIC_AUTH_TOKEN=<gateway key>`, `ANTHROPIC_API_KEY=` (empty).

## Setup in n8n

1. Install both `n8n-nodes-claude-agent-sdk` and `n8n-nodes-claude-codemie`, then restart n8n.
2. In the Claude Agent SDK node, set **Authentication → CodeMie Proxy**.
3. Create a **CodeMie SSO API** credential and set **Instance URL** (e.g.
   `https://codemie.lab.epam.com`). Save.
4. Back on the node, open the **Authenticate** link, sign in to CodeMie, and copy the
   `token=...` value from the page the browser lands on.
5. Paste it into the credential's **Login Token** field and click **Test** — a green
   check means the SSO session is stored and the proxy is serving models.
6. Pick a **Model** from the dropdown (or type a **Manual Model**), then run the task.

When the SSO session expires (~24h), re-open the Authenticate link, paste a fresh
token, and Test again.

## Requirements

- `@codemieai/code` (installed as a dependency; provides the proxy daemon).
- Run the n8n container with a **stable `--hostname`** and a persistent
  `CODEMIE_HOME` volume: CodeMie credentials are encrypted with a machine id
  (`hostname + platform + arch`) and are **not** portable across hosts or a
  changing hostname.

## Caveats

- **SSO sessions expire (~24h)** and refresh only via the browser. When a deep
  health check returns `401`, re-open the Authenticate link and paste a fresh token.
- Credentials are machine-bound — you cannot stage them on one host and ship them
  to another; they must be written on the host the daemon runs on.

## Docker

A reference image bundling n8n + the Claude Agent SDK node + this companion +
the CodeMie CLI is in [`Dockerfile`](./Dockerfile). Run it with a **stable
`--hostname`** and a persistent `CODEMIE_HOME` volume (credentials are
machine-id-bound, so a changing hostname forces re-authentication):

```bash
docker build -t n8n-claude-codemie .
docker run -it --rm --hostname n8n-codemie -p 5678:5678 \
  -v n8n_data:/home/node/.n8n -v codemie_home:/home/node/.codemie \
  n8n-claude-codemie
```

## Development

```bash
pnpm install
pnpm build      # tsc + copy icon assets into dist/
pnpm test       # vitest unit tests
```

For publishing as a verified n8n community node, additionally run
`npx @n8n/node-cli lint` and address any findings.

## License

MIT
