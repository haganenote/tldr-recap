# tldr-recap
Daily ad-free recap of TLDR newsletters, deduped across editions, summarized via OpenRouter, delivered to your inbox.

Personal automation script that fetches TLDR newsletter emails from Gmail, filters out sponsors and duplicated rticles across editions, categorizes and summarizes items via an LLM (OpenRouter), and sends a clean daily digest back to Gmail. 
Built with Bun + TypeScript + SQLite. Runs on a Hetzner VPS via systemd timer at 17:30 Europe/Madrid.


## Architecture

```
17:30 Europe/Madrid (systemd timer)
    │
    ▼
fetch unread TLDR emails from last 24h (Gmail API)
    │
    ▼
parse each email into items (headline + summary + URL)
    │
    ▼
strip ads (Sponsor markers + sponsor-domain blocklist)
    │
    ▼
canonicalize URLs + dedup against SQLite seen-cache
    │
    ▼
group into categories + summarize via OpenRouter (one batched call)
    │
    ▼
render HTML email + send to self via Gmail API
    │
    ▼
label processed emails as "TLDR/processed" + mark seen URLs in SQLite
```

**Strict-mode parser**: if no items are extracted from an email, the script throws and you get an error email. Better a loud failure once a year than silent drift.

## Deploy on Oracle Cloud (Always Free)

### 1. Install Bun on the VM

```bash
ssh ubuntu@your-oracle-ip
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 2. Clone and install

```bash
sudo mkdir -p /opt/tldr-recap
sudo chown $USER:$USER /opt/tldr-recap
cd /opt/tldr-recap
# rsync from your machine, or git clone, etc.
bun install
```

### 3. Set up Gmail OAuth (one-time, on your laptop)

1. Go to https://console.cloud.google.com → create a project (or reuse one).
2. Enable Gmail API.
3. APIs & Services → Credentials → Create OAuth client ID → "Desktop app".
4. Download the JSON, save as `oauth-client.json`.
5. Run the bootstrap script locally:

   ```bash
   bun run scripts/bootstrap-gmail-auth.ts ./oauth-client.json
   ```

   Browser opens, you grant consent, refresh token prints to console. Copy it.

### 4. Configure

Create `/opt/tldr-recap/.env`:

```
GMAIL_CLIENT_ID=...           # from oauth-client.json
GMAIL_CLIENT_SECRET=...       # from oauth-client.json
GMAIL_REFRESH_TOKEN=...       # from bootstrap step
GMAIL_USER=marco@example.com  # your gmail address (for sending)

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5  # or whatever you prefer

RECAP_RECIPIENT=marco@example.com  # usually same as GMAIL_USER
TZ=Europe/Madrid
```

`chmod 600 .env` — it has secrets.

### 5. Set up Gmail filter (do this in Gmail UI, once)

Settings → Filters → Create new:
- From: `tldrnewsletter.com OR tldr.tech`
- Apply label: `TLDR/raw`
- Skip inbox: yes (optional, keeps things tidy)

The script queries `label:TLDR/raw is:unread newer_than:1d`, so any new TLDR vertical you subscribe to in the future is auto-included.

### 6. Install systemd units

```bash
sudo cp systemd/tldr-recap.service /etc/systemd/system/
sudo cp systemd/tldr-recap.timer /etc/systemd/system/
sudo cp systemd/tldr-recap-failure.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tldr-recap.timer
```

### 7. Verify

```bash
# trigger a manual run
sudo systemctl start tldr-recap.service
journalctl -u tldr-recap.service -f

# check the timer schedule
systemctl list-timers tldr-recap.timer
```

## Live database access (SSHFS)

To browse the SQLite database live from your laptop using DBeaver or any local SQLite tool:

```bash
# Install SSHFS (once)
sudo apt install sshfs

# Mount the remote data folder
mkdir -p ~/mnt/tldr-recap
sshfs user@your-server:/opt/tldr-recap/data ~/mnt/tldr-recap -o IdentityFile=~/.ssh/id_ed25519

# Unmount when done
fusermount -u ~/mnt/tldr-recap
```

Then connect DBeaver to: **New Connection → SQLite → `~/mnt/tldr-recap/state.db`**

## Checking execution

```bash
# See logs from the last run
journalctl -u tldr-recap.service --since "today" --no-pager

# Follow logs in real time (useful during a manual run)
journalctl -u tldr-recap.service -f

# Check when the next run is scheduled
systemctl list-timers tldr-recap.timer

# Trigger a manual run immediately
sudo systemctl start tldr-recap.service
```

## Changing the run time

Edit `systemd/tldr-recap.timer`:

```ini
[Timer]
OnCalendar=*-*-* 17:30:00 Europe/Madrid
```

Change `17:30:00` to whatever time you want (in `Europe/Madrid` local time). Then deploy to the server:

```bash
sudo cp systemd/tldr-recap.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart tldr-recap.timer
systemctl list-timers tldr-recap.timer  # verify next run
```

## Tuning over time

- **Spotted an ad that slipped through?** Add the destination domain to `data/sponsor-domains.txt` (one per line). Picked up next run, no redeploy.
- **TLDR added a new section?** The parser is permissive about section names — anything in ALL CAPS followed by a blank line counts. Should just work.
- **Want to switch models?** Change `ANTHROPIC_MODEL` in `.env` and restart (e.g. `claude-sonnet-5` for higher quality at higher cost).

## Cost

At ~50 items/day across all TLDR editions, batched into one Anthropic API call:
- Input: ~8k tokens
- Output: ~2k tokens
- Daily cost (Haiku 4.5): roughly €0.01
- Monthly: roughly **€0.30**

## Backups

The SQLite db at `data/state.db` holds dedup history and the sponsor blocklist. Worth backing up to Oracle Object Storage:

```bash
# in crontab or as a separate systemd timer
0 3 * * * /opt/tldr-recap/scripts/backup.sh
```

(See `scripts/backup.sh`.)
