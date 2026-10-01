

const CACHE_NAME = 'kart-c15a7f2-20261001T0704Z';
const PRECACHE = ["./NOTICE","./audio/engine.js","./core/aids.js","./core/drivetrain.js","./core/equilibrium.js","./core/model.js","./core/params.js","./core/sim.js","./core/track.js","./data/garage_table.json","./data/sectors.json","./data/tracks/index.json","./data/tracks/wakefield.json","./data/tracks/winton-club.json","./data/tracks/winton-national.json","./icons/icon.svg","./index.html","./input/input.js","./input/shaping.js","./input/tilt.js","./main.js","./manifest.webmanifest","./modes/garage.js","./modes/replay.js","./modes/scoring.js","./modes/session.js","./modes/storage.js","./render/chaseCamera.js","./render/cinematicCameras.js","./render/helmetCamera.js","./render/kartPose.js","./render/scene.js","./rig.html","./rig.js","./shared/canvasVisibility.js","./shared/debugLog.js","./shared/diagnostics.js","./shared/inputDebug.js","./shared/runState.js","./shared/versions.js","./style.css","./track/mesh.js","./track/spatialIndex.js","./track/track.js","./ui/driveUi.js","./ui/format.js","./ui/garageTurntable.js","./ui/garageUi.js","./ui/onboarding.js","./ui/rig.css","./ui/rigSession.js","./ui/rigUi.js","./ui/settingsUi.js","./ui/titleHome.js","./vendor/three/LICENSE","./vendor/three/three.core.min.js","./vendor/three/three.module.min.js"];
const PRECACHE_PATHS = new Set(PRECACHE.map((p) => { try { return new URL(p, self.location.href).pathname; } catch { return null; } }).filter(Boolean));

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (!PRECACHE_PATHS.size) return;
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE);
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!PRECACHE_PATHS.has(url.pathname)) return;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
