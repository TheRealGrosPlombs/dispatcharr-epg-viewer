# Dispatcharr EPG Viewer

A small browser-based viewer for the XMLTV guide that [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) outputs (e.g. `http://192.168.0.154:9191/output/epg`).

- Classic dark EPG grid: channels down the left, time across the top, programs as cells (title + description) sized by duration
- Red "now" line, `‹ ›` / `« »` navigation, selectable 2/4/6/12-hour window; tap a program for full details
- Search **channel names, program titles and program descriptions** (toggle each on/off)
- Multi-word search (all words must match), highlighted results; tap a result to jump to it in the guide
- Works on PC, Android and iPad browsers on your local network
- You can also open a saved `.xml` file directly

## Why a server?

Browsers block pages from reading another host's XML (CORS), and an `https` page can't call an `http` address. The tiny Node server in this repo serves the page and relays the EPG request, so everything works from any device. No dependencies to install.

## Run it

Requires Node 18+.

```bash
node server.js
# or with your EPG URL pre-filled:
EPG_URL=http://192.168.0.154:9191/output/epg node server.js
```

Then open `http://<ip-of-that-machine>:7421` from any device on your network.

### Docker

```bash
docker build -t epg-viewer .
docker run -d --name epg-viewer -p 7421:7421 \
  -e EPG_URL=http://192.168.0.154:9191/output/epg epg-viewer
```

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7421` | Port to listen on |
| `EPG_URL` | empty | Pre-filled EPG URL |
| `ALLOW_ANY_HOST` | off | Set to `1` to allow non-LAN EPG URLs (by default only private/local hosts can be fetched) |

Do not expose this server to the internet.
