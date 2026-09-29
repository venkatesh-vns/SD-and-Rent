import React from 'react';

// A small city of office towers standing on a grid, drawn with CSS 3D
// transforms (no WebGL, no libraries) and slowly rotating. Decorative only.
// Each tower: position on the ground (x, z), footprint (w x d) and height h, in px.
const TOWERS = [
  { x: -95, z: -70, w: 64, d: 64, h: 200, tone: 'a' },
  { x: 10, z: -95, w: 56, d: 56, h: 150, tone: 'b' },
  { x: 85, z: -20, w: 70, d: 62, h: 250, tone: 'c' },
  { x: -40, z: 45, w: 78, d: 58, h: 120, tone: 'b' },
  { x: 70, z: 85, w: 52, d: 52, h: 95, tone: 'a' },
  { x: -120, z: 70, w: 48, d: 48, h: 75, tone: 'c' },
  { x: 0, z: -15, w: 44, d: 44, h: 175, tone: 'hero' },
];

export default function Scene3D() {
  return (
    <div className="scene3d" aria-hidden="true">
      <div className="scene3d-world">
        <div className="scene3d-ground" />
        {TOWERS.map((t, i) => (
          <div
            key={i}
            className={`tower tower-${t.tone}`}
            style={{ '--x': `${t.x}px`, '--z': `${t.z}px`, '--w': `${t.w}px`, '--d': `${t.d}px`, '--h': `${t.h}px` }}
          >
            <span className="face face-front" />
            <span className="face face-back" />
            <span className="face face-left" />
            <span className="face face-right" />
            <span className="face face-top" />
          </div>
        ))}
      </div>
    </div>
  );
}
