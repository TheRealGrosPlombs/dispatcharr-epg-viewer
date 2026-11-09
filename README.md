# Dispatcharr EPG Viewer

A small browser-based viewer for the XMLTV guide that [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) outputs (e.g. `http://192.168.0.154:9191/output/epg`).

- Classic dark EPG grid: channels down the left, time across the top, programs as cells (title + description) sized by duration
- Red "now" line, `‹ ›` / `« »` navigation, selectable 2/4/6/12-hour window; tap a program for full details
- Search **channel names, program titles and program descriptions** (toggle each on/off)
- Multi-word search (all words must match), highlighted results; tap a result to jump to it in the guide
- Works on PC, Android and iPad browsers on your local network
- **Remote play:** send a channel to an [AerioTV](https://github.com/jonzey231/AerioTV-Android) box on your network with one click (see below)
- You can also open a saved `.xml` file directly

## Why a server?

Browsers block pages from reading another host's XML (CORS), and an `https` page can't call an `http` address. The tiny Node server in this repo serves the page and relays the EPG request, so everything works from any device. No dependencies to install.

## Run it

Requires Node 18+.

```bash
npm install
node server.js
# or with your EPG URL pre-filled:
EPG_URL=http://192.168.0.154:9191/output/epg node server.js
```

Then open `http://<ip-of-that-machine>:7421` from any device on your network.

### Docker

```bash
docker build -t epg-viewer .
docker run -d --name epg-viewer --network host -v epg-viewer-data:/data \
  -e EPG_URL=http://192.168.0.154:9191/output/epg \
  -e DISPATCHARR_API_KEY=your-api-key epg-viewer
```

`--network host` lets the container see AerioTV boxes (mDNS does not cross Docker's default bridge). The volume keeps the pairing tokens.

## Remote play on AerioTV

Click **▶** on a channel row (or open a program and press **Play this channel on TV**) to make an AerioTV box tune that channel. No change to the AerioTV app is needed: the viewer server uses the app's built-in companion-remote feature.

1. AerioTV must be running on the box. Give each box a name in Android (Settings > Device name), or rename it in the viewer (**📺 TVs > Rename**), e.g. "Bedroom" or "Living Room".
2. Set `DISPATCHARR_API_KEY` (and `DISPATCHARR_URL` unless it is the same host as `EPG_URL`) so the viewer can look up each channel's id. It is the same API key AerioTV uses (Dispatcharr user settings).
3. Open **📺 TVs**, press **Pair** next to a box, and type the 6-digit code shown on its screen. Pairing is remembered in `DATA_DIR`.
4. Pick the target box in the drop-down next to **📺 TVs**, then use ▶.

Channels are matched by tvg-id, EPG data id, channel number, then name. If a channel can't be matched you get a message instead of a silent failure.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7421` | Port to listen on |
| `EPG_URL` | empty | Pre-filled EPG URL |
| `DISPATCHARR_URL` | origin of `EPG_URL` | Dispatcharr base URL, e.g. `http://192.168.0.154:9191` |
| `DISPATCHARR_API_KEY` | empty | Enables remote play (channel lookup) |
| `DATA_DIR` | `./data` | Where pairing tokens and TV names are stored |
| `MANUAL_TVS` | empty | Fallback if mDNS can't find a box: `Bedroom=192.168.0.50:41234` (the port changes whenever AerioTV restarts) |
| `ALLOW_ANY_HOST` | off | Set to `1` to allow non-LAN EPG URLs (by default only private/local hosts can be fetched) |

Do not expose this server to the internet: anyone who can reach it can change channels on your paired TVs.
