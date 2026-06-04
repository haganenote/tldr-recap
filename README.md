# tldr-recap
Daily ad-free TLDR newsletter recap — deduped, categorized, and delivered to Gmail via OpenRouter

Personal automation script that fetches TLDR newsletter emails from Gmail, filters out sponsors and duplicated rticles across editions, categorizes and summarizes items via an LLM (OpenRouter), and sends a clean daily digest back to Gmail. 
Built with Bun + TypeScript + SQLite. Runs on a Hetzner VPS via systemd timer at 17:30 Europe/Madrid.
