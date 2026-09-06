# Olympus Control Plane

A custom operations dashboard for the Olympus homelab.

## Current UI

The first version is intentionally frontend-only and uses representative data from the current homelab architecture:

- Apollo / Proxmox
- Athena / Docker
- Hestia / Docker
- K3s
- Prometheus
- Grafana
- Loki
- Grafana Alloy
- Node Exporter
- cAdvisor
- Glances
- Portainer
- Vaultwarden
- Homepage
- Tailscale
- Floci

A dedicated camera / 3D-printer panel is included as a placeholder. The actual stream can be added later.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Run with Docker

```bash
docker compose up -d --build
```

Then open `http://localhost:3000`.

## Next implementation phase

Replace the demo values with backend integrations. Do not put Proxmox or Docker credentials in the browser.

Recommended flow:

Browser -> Next.js API/backend -> Prometheus / Loki / Proxmox / Docker / K3s

Camera can later be added through `CAMERA_URL`, preferably using a browser-compatible stream such as HLS/WebRTC/MJPEG depending on the camera setup.
