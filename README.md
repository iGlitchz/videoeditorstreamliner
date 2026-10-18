# Video Editor Streamliner

An upload-first video editor: bring a talking-head recording from OBS, get a transcript-timed first draft, then review B-roll, animation, or your own footage for each section. Existing script, recording, voiceover, visual-library, and advanced timeline tools remain available in the Tools menu.

## Start

```powershell
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge. The API runs on `127.0.0.1:4300`. Restart any existing development session after installing Phase 2 dependencies. The dev script builds shared schemas before starting both apps.

Node.js 22+ is required. Windows x64 uses FFmpeg and FFprobe included with the pinned Remotion renderer. Other platforms need compatible media tools on PATH. Optional overrides are documented in `.env.example`. Rendering detects standard Windows Chrome/Edge installations; set `REMOTION_BROWSER_EXECUTABLE` for another installation. If none is found, Remotion may download its supported headless browser on the first export.

Data defaults to `./data`; set `STUDIO_DATA_DIR` to configure storage. Additive, versioned migrations run automatically for existing Phase 1 databases. Do not substitute `db:push` for the built-in migrations.

## Upload-first workflow

1. Click **Upload recording** to create a project from an OBS video (MP4, MKV, MOV, WebM, M4V, or AVI; up to 2 GB and two hours).
2. The app transcribes the recording locally, divides it into contiguous timed sections, and assembles a first draft. Speech and pauses are preserved.
3. Review the three suggestion lanes: **B-roll**, **Animation**, and **My footage**. Approve each section or approve all. Unapproved suggestions are still visible in preview and export.
4. Search for alternate stock clips or pictures, create or revise vector animations with prompts, upload a replacement, or restore the original camera shot. Replacement audio is muted; the original narration stays separate underneath. Short replacements return to the camera for the remaining section time.
5. **Tools** keeps the original script/storyboard, visual library, advanced timeline, recording studio, voiceover studio, and AI settings accessible. Voiceover takes can replace overlapping narration without changing the visuals. Switching a section's visual rebuilds only that section's managed visual clips; independent advanced edits remain.

Automatic transcription requires Python 3.10+ and the dependencies in `apps/transcription-worker/requirements.txt`. See [the worker setup](apps/transcription-worker/README.md); point `PYTHON_EXECUTABLE` in `.env` to that environment. Whisper downloads its speech model on first use. If transcription fails, retry or import timed SRT/VTT subtitles. Imported subtitle words use their cue timing, not independent word alignment.

Local transcript-based suggestions and vector animation work without an AI key. Configure a project AI model through **Tools → Project settings & AI model** for semantic visual planning and more complex animation changes. Model calls may use credits and send transcript excerpts/design prompts to the selected provider. Stock requires Pexels/Pixabay keys; failures retain the camera shot and show a review warning. Originals stay local and are never overwritten by draft assembly. Replacing an existing timeline requires confirmation and preserves undo history.

`node --import tsx --test tests/*.test.ts` runs the regression suite. `node tests/draft-smoke.mjs --transcribe --render` verifies the upload-first flow using generated speech and an isolated database on Windows, including real local transcription and a short MP4 export. No physical camera/microphone or paid AI is used. Add `--stock` to exercise live stock-provider requests.

## Search and credentials

Copy `.env.example` to the root `.env` and put credentials only in `.env` (ignored by Git). The server loads this explicit root path even when started from its npm workspace. Restart the API after changing credentials. Do not put real credentials in the example or any `VITE_` variables.

`WEB_SEARCH_API_KEY` uses `WEB_SEARCH_PROVIDER=tavily`; `WEB_SEARCH_API_KEY_BACKUP` uses `WEB_SEARCH_BACKUP_PROVIDER=serper`. Named `TAVILY_API_KEY`/`SERPER_API_KEY` variables are also supported. Primary failures, timeouts, exhausted quotas, and unusable results automatically try the backup. `WEB_SEARCH_TIMEOUT_MS` bounds each attempt (default 12 seconds). Tavily uses basic search with automatic parameter escalation disabled; requests can consume credits on either provider.

In a project, open **Research** below the producer conversation to search and save source cards for the selected section. Saved excerpts are provided to AI chat as untrusted, unverified evidence; no full-page extraction or independent fact checking is claimed. Check **Search web before replying** to request fresh search results with a chat message. Search failures are reported without blocking offline editing. **Settings → Server integrations** shows key presence and lets you test each search connection separately.

Web search does not replace an AI model: configure an OpenRouter key or a running Ollama instance, then choose a provider and model in project settings. Pexels and Pixabay photo/video search and selection are available on **Visuals**, using server-only credentials. Runware cinematic image/video generation is not implemented. No paid image generation is performed automatically.

Verification: `node_modules/.bin/tsx --test tests/search.test.ts` runs isolated search/failover tests. With the development app running, `node tests/integration-smoke.mjs` verifies the proxy, live search, saved section-scoped research, offline chat, and live backup. It creates/removes a temporary verification project and makes two search requests; project deletion deliberately retains empty media directories for recovery.

`node_modules/.bin/tsx --test tests/api.test.ts` covers empty-body and upload headers. Optional `node tests/ai-smoke.mjs` checks the full research-to-chat path against the smallest identifiable installed Ollama model. It makes one search request and creates/removes a temporary project; it does not call paid AI/image providers.

## Recording and editing

1. Open a project, write the continuous script in **Storyboard**, using paragraph breaks for structure, and click **Record video**. This saves pending script changes before opening the recording studio.
2. Choose a scene and camera/microphone, then **Preview inputs**. Camo appears as a normal virtual camera. Configure exposure/focus/image settings in Camo itself.
3. For a screen scene, click **Choose screen / window** and use the native browser picker. The source status reports whether audio was actually shared.
4. Adjust the layout or drag/resize the camera. Camera, screen, audio, and layout controls are grouped into collapsible panels. The teleprompter starts scrolling when recording starts, stops when recording stops, and has live speed adjustment in pixels per second. Pause/resume is available, with text size, mirroring, and positioning under **Options**.
5. Click **Record video**, then **Stop & save take**. Wait for the server take state to become `completed`, review it, and choose **Use as full video** to replace the active footage, or **Append take** to build the edit from smaller takes. Original recordings and undo history are preserved.
6. In the editor, select camera clips to edit their transform directly or through **Clip controls**. Audio sources have independent volume, mute, and fades. Linked take tracks move/trim/split together; uncheck **Link take tracks** for independent edits.
7. Add **Scene at playhead** to switch layouts after capture. Scene clips use the existing graphics track; move/trim them to change boundaries. The latest-starting active scene wins; at equal starts, the latest inserted scene wins. Transitions interpolate the saved layout.
8. Use **Media gallery → Upload media** on **Timeline** to import local video, images, music, or sound effects. Chosen stock visuals and animations also appear here. Drag an item onto a compatible track, or add it at the playhead. Drag across empty timeline space to select multiple clips, then move them together. **Layout & text → Text overlay** adds an editable name/title graphic (formerly called a lower third).
9. Use **Record voiceover** to record audio at the playhead without replacing existing video. **Recording studio** opens camera/screen capture.
10. Click **Export**, queue a render, then **Save MP4 as…** when it finishes. Chromium can show a save-file picker; other browsers use a download. Canceled partial renders are removed; originals and completed exports are retained. A completed H.264 file is checked for expected dimensions and positive duration before being offered as a finished export. Canceling is idempotent and waits for the renderer to stop before closing its browser.

Undo/redo (`Ctrl+Z`, `Ctrl+Shift+Z`) persists timeline commands. Deleting a take requires confirmation and keeps its original media; undo can restore its metadata and timeline clips.

### Continuous storyboard and animations

The top navigation separates **Storyboard**, **Visuals**, and **Timeline**. Storyboard has the AI producer and script on the left, and paragraph-based visual planning on the right. Both producer and planning panels are collapsible. Script edits save automatically; there are no manual Save or Lock script controls.

Storyboard is one full-video script; paragraph breaks replace the old section cards. You can record the entire script in one go with the teleprompter or append multiple shorter takes. Existing projects are migrated non-destructively: legacy script sections, stable IDs, footage, research, and timing references remain stored, while their script paragraphs are copied into a new full-video workspace.

In **Visuals → Animation**, describe objects, colors, and movement: a bouncing red ball, a rocket crossing stars, an orbiting planet, a waving robot, or flowing ribbons. **Local builder** creates a deterministic scene without a model or API charge. **AI model** uses the selected project provider/model to design validated object layers and custom vector paths, not executable code. Text-based layouts are used when explicitly requested, rather than for every prompt. AI calls may consume model credits. This creates editable vector animation, not cinematic text-to-video footage.

Generated designs are saved in the project's animation library. Preview a design, choose **Add to gallery**, then drag it from Timeline's media gallery onto **Motion graphics**. Select a clip to edit its design and timing. Animations can be removed from the gallery or deleted from the library without breaking already-inserted timeline instances. Preview and MP4 export use the same deterministic renderer. Library designs stay unchanged when editing a timeline instance.

Search Pexels or Pixabay photos/videos on **Visuals**, choose the results you want, and search again for more. Chosen media is downloaded into the local project and includes creator/provider credit. Search-result previews can be dismissed; chosen stock can be deleted from the visual library without deleting its local media or breaking existing timeline clips.

`node --import tsx --test tests/motion.test.ts` checks prompts, schema safety, and migration preservation. With the app running, `node tests/motion-smoke.mjs --render` checks library persistence, insertion, split/trim bounds, ownership, locks, undo/redo, and a short MP4 export using temporary projects. It does not use paid providers or capture devices.

`node --import tsx --test tests/*.test.ts` runs the full regression suite. `node tests/workspace-smoke.mjs --render` uses an isolated database to verify gallery selection/deletion, grouped edits, synthetic voiceover saving, and canceling an active render followed by a successful MP4 export. Add `--stock` to test live Pexels/Pixabay search and a selected stock import; it consumes provider requests but does not use paid AI.

## Formats and recovery

Runtime codec checks select WebM/VP9, WebM/VP8, generic WebM, or MP4 for video; Opus/WebM, WebM, Opus/Ogg, or MP4 for audio. Separate mode records camera, screen, microphone, and available screen audio as distinct streams. Camera/screen video streams are silent. The explicit composited fallback produces one flattened video with mixed audio and is labeled accordingly.

Recording proxies use the project's frame rate, H.264 video, and AAC audio in an explicitly selected MP4 container (including `.m4a` audio files). The bundled compact FFmpeg does not include `pad`; even-sized video is left unscaled and odd dimensions are enlarged by at most one pixel with its supported `scale` filter. Originals are preserved. Conversion output is probed for expected codecs and positive duration before atomic finalization. If a take failed processing, **Recover take** retries its already-saved chunks without recording again. `node_modules/.bin/tsx --test tests/media-commands.test.ts` checks command compatibility regressions.

Chunks go to IndexedDB first, then upload in order to durable UUID-scoped files under `data/recovery`. Originals live in `data/projects/<project-id>/recordings`; compatible H.264/AAC editing copies live in `proxies`. Conversion never replaces originals. Recorded clock offsets and encoded durations are retained; large duration discrepancies produce synchronization warnings.

If saving fails, keep the page open and use **Retry save**. After a reload, **Resume saved chunks** restores browser recovery data. **Recover take** retries processing server chunks. Headerless/corrupt media or the last chunk lost before the browser emits it may be unrecoverable. Recovery files are retained until an explicit cleanup feature is added.

## Limitations

- Chromium on localhost/HTTPS is the primary target. Screen audio depends on the selected source, browser, and OS. Native permission prompts and source pickers are always required.
- Timing offsets are frame-aligned browser timestamps, not a hardware sample clock. Long takes may drift; inspect warnings and unlink/reposition audio if needed. Automatic drift resampling and voice-following scrolling are future work.
- A full-camera take cannot reveal a screen that was never captured. Use a camera-and-screen scene to keep both. Composited fallback footage has no independently editable camera layer.
- Microphone originals are preserved without automatic destructive processing. Headphones help avoid acoustic duplication between microphone and shared system audio.
- Conversion/export use software H.264/AAC. External imports are limited to 2 GB per file; browser recording saves smaller chunks. Large files take time to process.
- Project backup/restore remains outside this implementation. Pexels/Pixabay stock and Tavily/Serper web research are connected. Vector animations depend on the local builder or the quality of the selected AI model; arbitrary photorealistic video generation is not supported.
- Acceptance and physical-device tests are left for the user, as requested. Details are in [docs/PHASE-2.md](docs/PHASE-2.md).

Provider credentials remain on the server. The optional faster-whisper worker setup is in `apps/transcription-worker/README.md`.
