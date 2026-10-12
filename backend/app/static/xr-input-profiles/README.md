# Local WebXR input profiles

Minimal, self-hosted generic controller layouts so `@react-three/xr` never needs the
jsdelivr CDN (TDS is local-first and headsets may be on an offline LAN).

Only button/axis mappings are provided (xr-standard gamepad mapping). Controller
models are disabled in the XR store, so no `.glb` assets are required. Unknown
runtime profile ids (for example a Steam Frame controller id that is not in this
list) fall back to `generic-trigger-squeeze-thumbstick`.
