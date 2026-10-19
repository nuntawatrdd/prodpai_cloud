# Todo List — static site served by unprivileged Nginx on port 8080.
# Build from this directory:  docker build -t todo-list:local .
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24-slim

LABEL org.opencontainers.image.title="plodphai-todo-list" \
      org.opencontainers.image.description="Plod Phai Cloud demo workload: static Todo List served by Nginx"

# Replace the default config with our own (non-root PID/temp paths, /health).
COPY nginx.conf /etc/nginx/nginx.conf

# Copy only the files the browser needs.
COPY index.html /usr/share/nginx/html/index.html
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY assets/    /usr/share/nginx/html/assets/

# Base image already runs as the non-root "nginx" user (uid 101).
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
