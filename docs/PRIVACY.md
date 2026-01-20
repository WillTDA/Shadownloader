# 🔒 Privacy and Logging

Dropgate is built to be **privacy-first** and **transparent**.
That means: logs exist for diagnostics, but they’re designed to be **minimal**, **non-identifying**, and **optional**.

Logging is controlled by the `LOG_LEVEL` environment variable (default: `INFO`).
The current log level is also exposed to clients via `GET /api/info` so users can see what they’re interacting with.

---

## ✅ What Dropgate does *not* log

Dropgate is intentionally opinionated about avoiding identifying data.
By design, it does **not** log:

- File contents
- Encryption keys / URL fragments
- Upload session IDs
- File IDs
- Client IP addresses
- Per-request identifiers or headers

If you’re running a public instance, this is one of the key ways the project tries to reduce “paper trails”.

---

## 🧾 What Dropgate *may* log

Depending on your `LOG_LEVEL`, you may see:

- Startup configuration (feature flags, limits, and server name)
- Storage usage summaries (useful for capacity limits)
- Rate limit warnings
- Internal errors and exceptions (from Node.js / the OS)

At `DEBUG` level you may also see:

- Upload/download lifecycle events (init/chunk/complete/download)
- Chunk counts and chunk sizes
- Cleanup of expired or incomplete uploads

File sizes and capacity values may appear in logs because they’re necessary for understanding limits and diagnosing issues.

---

## 📊 Log levels

- **`NONE`**
  - Disables all server logging

- **`ERROR`**
  - Startup/config failures
  - File I/O errors and unexpected exceptions

- **`WARN`**
  - Security/config warnings
  - Rate limit triggers

- **`INFO`**
  - Startup and configuration summary
  - Feature flags and size/retention limits
  - Storage usage summaries

- **`DEBUG`**
  - Detailed transfer flow logs
  - Cleanup events
  - Helpful for diagnosing tricky upload/download issues

---

## ✅ Recommended defaults

- Run with **`LOG_LEVEL=INFO`** for normal use.
- Temporarily switch to **`LOG_LEVEL=DEBUG`** when diagnosing an issue, then turn it back down.
- If you’re extremely sensitive about logging, use **`LOG_LEVEL=NONE`**.
