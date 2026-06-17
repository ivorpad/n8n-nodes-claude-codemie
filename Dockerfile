# Reference image: self-hosted n8n with Claude Agent SDK + CodeMie Proxy support.
#
# Build:  docker build -t n8n-claude-codemie .
# Run:    docker run -it --rm \
#           --hostname n8n-codemie \                # STABLE hostname (see note)
#           -p 5678:5678 \
#           -v n8n_data:/home/node/.n8n \
#           -v codemie_home:/home/node/.codemie \   # persists SSO creds + proxy state
#           n8n-claude-codemie
#
# Note on --hostname: CodeMie encrypts stored SSO credentials with a machine id
# derived from hostname + platform + arch. A changing hostname (the Docker
# default is a random container id) breaks decryption across restarts, forcing
# re-authentication every time. Always pin --hostname and keep CODEMIE_HOME on a
# named volume. Credentials are NOT portable across hosts.

FROM n8nio/n8n:latest

USER root

# The CodeMie CLI provides bin/proxy-daemon.js (the local proxy) and the codemie
# binary. Installed globally so the companion can resolve it at runtime.
RUN npm install -g @codemieai/code

USER node

# Install the main node + the CodeMie companion as n8n community nodes. The
# companion being present is the feature flag — the main node detects it and
# exposes the "CodeMie Proxy" authentication option.
RUN mkdir -p /home/node/.n8n/nodes \
	&& cd /home/node/.n8n/nodes \
	&& npm install n8n-nodes-claude-agent-sdk n8n-nodes-claude-codemie

# Persist the encrypted SSO credential store + proxy daemon state across restarts.
ENV CODEMIE_HOME=/home/node/.codemie
VOLUME ["/home/node/.codemie"]
