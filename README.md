# Olympus Control Plane

A NOC-style control plane for the Olympus homelab.

## v0.2 improvements

- Next.js 16 / React 19.2 dependency targets.
- Responsive NOC dashboard layout.
- Service search/filter in the top bar.
- Manual telemetry sync control with last-sync timestamp.
- Clear `DEMO TELEMETRY` banner so mock values are not confused with live data.
- Expanded service inventory with host placement.
- Integration-source panel for Prometheus, Proxmox API, Docker Engine, K3s API, Loki and Tailscale.
- Camera slot kept as a future integration point.
- No credentials are stored in the browser UI.

## Run

```bash
npm install
npm run dev
```

Then open the local Next.js development URL.

## Important

The dashboard is still using representative telemetry. The next engineering step is to replace the mock values with server-side API adapters.

Recommended flow:

```text
Browser
   |
   v
Next.js server routes
   |---- Prometheus
   |---- Proxmox API
   |---- Docker Engine / Portainer
   |---- K3s API
   |---- Loki
   `---- Tailscale
```

Keep API tokens, passwords and kubeconfig material server-side in environment variables. Do not expose them to client-side React code.

## Future camera

When the camera is available, add a server-side camera configuration such as `CAMERA_URL` and render the appropriate stream format. Avoid exposing private credentials in the URL.
