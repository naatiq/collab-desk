# Collab Desk

A creator business desk (brand collabs, calendar, content plan, payments, pitch list) that runs in the browser
on desktop and iPhone, works offline, and syncs through your own Google Drive.

- **Your data** is stored as one Markdown file per item in the `Collab Desk` folder of your Google Drive
  (`deals/`, `content/`, `brands/`, `profile.md`). You can open, edit, back up or move these files any time.
- **Offline:** everything is kept on the device too; edits made offline sync when you're back online.
  If the same item changed on two devices, the most recent save wins. Deleted items go to Drive's trash.
- **No server, no subscription.** The app is static files hosted on GitHub Pages.

## Files
| File | What it is |
| --- | --- |
| `index.html` | The app |
| `sync.js` | On-device storage (IndexedDB) and Google Drive sync, Markdown read/write |
| `config.js` | Your Google OAuth Client ID (not a secret) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the home-screen app |
| `jszip.min.js` | JSZip 3.10.1 (MIT), for .zip export/import |

## Setup
1. Repo Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
2. Google Cloud: create a project, enable the **Google Drive API**, set up the OAuth consent screen (External),
   and create an OAuth client of type **Web application** with
   - Authorized JavaScript origin: `https://<username>.github.io`
   - Authorized redirect URI: `https://<username>.github.io/collab-desk/`
3. Put the Client ID in `config.js` (or paste it in the app under **My profile → Google Drive sync**).
4. Open the site, go to **My profile**, tap **Connect Google Drive**.
5. iPhone: open the site in Safari → Share → **Add to Home Screen**.

The app only asks for the `drive.file` permission, so it can see only the files it created, nothing else in your Drive.
