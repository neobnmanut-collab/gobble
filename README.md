# Blobbit — multiplayer

A shared online arena: real players and bots in one world, run by one server.
The server decides everything (movement, eating, splitting, spikes), so players can't cheat by editing the page.
Bots fill the arena up to 50 players and step aside as real people join.

```
client/   the game page players open (index.html, game.js, net.js)
server/   the Node.js game server; it also serves the page
deploy/   ready-made service and HTTPS files for a Linux server
```

The game name is a placeholder. When you pick the final name, change `GAME_NAME` at the top of `client/game.js` and the `<title>` in `client/index.html`.

## Try it on your own computer

**Quickest:** double-click `start-windows.bat` (Windows) or `start-mac.command` (Mac). It installs what it needs the first time, starts the game and opens it in your browser. Close the window to stop it.

Or by hand:

You need Node.js 18 or newer (https://nodejs.org).

```
cd server
npm install
npm start
```

Open http://localhost:8080 in two browser windows to see two players in the same arena.

## Put it online in Europe

This takes about 30 minutes. You need:

- a small Linux server (VPS) in a European data centre: Hetzner (Germany, Finland), OVHcloud (France, Germany, Poland) or DigitalOcean (Frankfurt, Amsterdam) all work. A central location such as Frankfurt or Amsterdam gives the lowest delay across most of Europe. Pick Ubuntu 24.04, 2 vCPU and 2 GB RAM to start.
- a domain name, for example `play.yourgame.io`.

### 1. Point the domain at the server

In your domain's DNS settings, add an **A record** for `play` (or the whole domain) pointing to the server's IP address. It can take a few minutes to start working.

### 2. Install Node.js and the game

Log in to the server with SSH, then:

```
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs unzip
sudo useradd --system --create-home --home-dir /opt/game game
```

Copy this folder to the server (from your computer, replace the IP):

```
scp -r client server deploy root@YOUR.SERVER.IP:/opt/game/
```

Then on the server:

```
cd /opt/game/server
sudo npm ci --omit=dev
sudo chown -R game:game /opt/game
```

### 3. Keep it running

```
sudo cp /opt/game/deploy/game.service /etc/systemd/system/game.service
sudo systemctl daemon-reload
sudo systemctl enable --now game
sudo systemctl status game        # should say "active (running)"
curl http://127.0.0.1:8080/health # should print {"ok":true,...}
```

The server now restarts by itself if it crashes or the machine reboots.

### 4. Secure address (HTTPS) with Caddy

Browsers need HTTPS for a public game. Caddy sets it up and renews it automatically:

```
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Edit `/opt/game/deploy/Caddyfile`, replace `play.example.com` with your domain, then:

```
sudo cp /opt/game/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 5. Firewall

```
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Open `https://your-domain` and play. Share that link with anyone.

## Updating the game later

Copy the changed files to `/opt/game` again, then `sudo systemctl restart game`.
Players in the arena are disconnected for a second and reconnect on their own.

## Tuning

Every gameplay number (arena size, bots, pellets, spikes, speeds, limits) is in `server/src/config.js`.
Restart the server after changing it.

- `BOT_FILL` — bots fill the arena up to this many players.
- `MAX_PLAYERS` — real players allowed at once (default 120).
- `PORT`, `HOST` — set in `deploy/game.service`.

## Checking how it's doing

- `https://your-domain/health` shows players, connections, orbs and how long each game step takes. The step must stay well under 25 ms; on a normal server it is a few ms.
- `sudo journalctl -u game -f` shows the server log. Add `Environment=LOG_STATS=1` to the service file for a line every 5 seconds with players and bandwidth.
- `cd /opt/game/server && node test/load.js 100 30` runs 100 simulated players against a test copy of the server and reports cost and bandwidth.

## Tested here

With 120 simulated players splitting, feeding and switching boxes, one game step took about 6 ms (the budget is 25 ms) and each player used about 8 KB/s of download. Real servers vary, so watch `/health` when you launch.

## Later

- More players than one arena holds: run several servers (or several ports on one server) and add a server list.
- Other regions: the same files run anywhere; add a server in another region and let players choose.
