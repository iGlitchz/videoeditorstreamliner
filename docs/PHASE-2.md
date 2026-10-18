# Phase 2 implementation notes

## Implemented

- Integrated Recording Studio for the active project/section, real devices and permission-based names, remembered device choices, microphone test and clipping meter, camera/screen previews, and native display-source selection.
- Session state machine, runtime codec selection, separate camera/screen/microphone/system-audio streams, common clock reference, per-stream offsets, and a clearly labeled composited fallback.
- Ordered durable uploads, IndexedDB recovery, atomic writes, original retention, FFprobe inspection, FFmpeg H.264/AAC copies, and thumbnails.
- Seven editable persisted scenes, normalized layouts, camera drag/resize, crop/scale/rotation/opacity/border/shadow controls, and adjustable teleprompter.
- Section-bound take review, naming, approval/replacement, confirmed recoverable deletion, and interrupted-take recovery.
- Approval creates ordinary media clips and a scene clip on the existing tracks. Existing narration approval also imports an audio asset and adds a narration clip.
- The existing master composition now reads timeline media, camera overlays, split layouts, images, audio, graphics, and scene transitions. Preview and export use that component.
- Timeline moves, source-bounded trims, splits, track changes, duplication/deletion, linked edits, snapping, zoom, hide/mute/lock, and persistent undo/redo.
- Media/OBS import, independent audio volume/fades, and a local render queue with progress, cancellation, immutable snapshots, validated MP4 files, atomic finalization, and destination selection/download.

## Files changed

Shared models: `packages/shared/src/index.ts`, `packages/shared/src/recording.ts`, and shared package exports.

Database/API: `apps/server/src/db/{schema,index,migrations}.ts`, `apps/server/src/index.ts`, and new `capture.ts`, `media.ts`, `timeline.ts`, `narration.ts`, `exports.ts`.

Video: `packages/video/src/index.tsx` and the new Remotion entry `packages/video/src/root.tsx`.

Frontend: `apps/web/src/{App,main}.tsx`, `lib/api.ts`, and new `recording/{api,recovery,session,RecordingStudio,LiveScene,TransformControls,EditingTools,Timeline,recording.css}`.

Configuration: root/server manifests, lockfile, `.gitignore`, `.env.example`, and `README.md`.

## Verification

The production build compiles the shared package, video package, server, and frontend. The bundled Windows media binary's encoder inventory contains `libx264` and `aac`.

No acceptance test, simulated capture, microphone permission test, screen-share test, or final export was run by the implementation agent, per the user's instruction. Runtime export validation is implemented; this is not a claim that an export was produced during implementation.

## Remaining work

Exercise actual camera/Camo and screen sources, check representative recordings for audio synchronization, and run the acceptance scenario. Hardware-specific browser behavior remains to be established through the user's feedback. Automatic drift correction, retention/cleanup tools, broader browser support, and project backup/restore can be added later.
