# 24/7 Videos

A self-hosted linear web TV channel. Viewers open the front page and immediately join the program that should be on-air at that exact moment. They cannot pause, seek, change playback speed, or restart a program from the viewer UI.

## What it does

- Full-screen 24/7 viewer at `/`
- Password-protected control room at `/admin`
- Drag/drop multi-video uploads with progress
- Exact playlist ordering
- Every active video airs once before the playlist loops
- Server-time synchronization so viewers joining later land at the same point
- Automatic recovery after tab sleep, refreshes, network interruption, or attempted seeking
- Admin controls to reorder, rename, enable/disable, delete, and restart the channel from program #1
- Current-program preview and "up next" display
- Persistent JSON channel metadata plus persistent video files
- HTTP byte-range video delivery for seeking to the correct live offset
- Mobile-responsive viewer and admin UI

## How the live behavior works

This is linear TV built from your uploaded on-demand files. The server stores a playlist start timestamp. Every viewer calculates the same position from:

```
(server time - playlist start time) % total playlist duration
```

That identifies the current program and the exact second that should be on-air. A viewer who refreshes does **not** restart the video. A viewer who opens the site later joins the current program in progress.

Playlist changes intentionally restart the rotation from item #1 so there is one unambiguous schedule after every edit.

## Local setup

Requires Node.js 20+.

```bash
npm install
export ADMIN_PASSWORD="your-strong-admin-password"
export SESSION_SECRET="a-long-random-secret"
npm start
```

Open:

- Viewer: http://localhost:3000/
- Admin: http://localhost:3000/admin
- Health: http://localhost:3000/health

## Environment variables

Copy `.env.example` as a reference.

- `PORT` - web server port, default 3000
- `ADMIN_PASSWORD` - required, minimum 8 characters
- `SESSION_SECRET` - recommended long random value for signing admin sessions
- `DATA_DIR` - where channel metadata and uploaded video files are stored, default `./data`
- `MAX_UPLOAD_BYTES` - per-video upload ceiling, default 8 GiB
- `SESSION_HOURS` - admin login duration, default 12 hours

## Railway deployment

1. Create a Railway service from this GitHub repository.
2. Add `ADMIN_PASSWORD` and `SESSION_SECRET` variables.
3. Add a Railway persistent volume.
4. Mount the volume at `/data`.
5. Add `DATA_DIR=/data`.
6. Deploy. `railway.json` already defines the start command and health check.
7. Open the generated domain for the viewer and append `/admin` for the control room.

**The persistent volume is required for production uploads.** Without it, uploaded files can disappear when the service is redeployed or moved.

Use one application replica when storing videos on a local Railway volume. A future multi-replica version should move media to object storage and metadata to a shared database.

## Video format recommendation

For the broadest compatibility across Chrome, Edge, Safari, iPhone, Android, and smart-TV browsers, upload:

- Container: MP4
- Video: H.264/AVC
- Audio: AAC

The admin accepts MP4, M4V, WebM, MOV, OGG/OGV, and MKV, but browser codec support varies.

## Viewer restrictions

The viewer intentionally exposes no timeline and no native video controls. The player also:

- hides native controls
- ignores pause attempts
- restores playback rate to 1x
- rejects off-schedule seeks by resynchronizing
- re-syncs every second
- re-syncs after returning to a sleeping/background tab
- re-fetches server schedule state every 30 seconds
- allows only sound on/off and fullscreen

As with any browser-based video site, a technically advanced user with developer tools controls their own browser. The app enforces true-live behavior in the product UI and continuously corrects playback to the live schedule.

## Storage layout

```
DATA_DIR/
  channel.json
  videos/
    <generated-id>.mp4
    ...
```

`channel.json` is written atomically to reduce corruption risk.
