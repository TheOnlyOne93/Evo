// Stand-in Evo.poseOf and Evo.CreatureArt for the world lab (dev only), so the lab runs without
// the simulation's creatures. Like the real art (DESIGN.md §8) it draws each creature's ground
// shadow and focus ring from the pose. install() defines each only if it is missing, so the real
// ones win whenever they are loaded first.
(function (Evo) {
  'use strict';
  const TAU = Math.PI * 2;

  // DESIGN.md §7, filled from the mock creature's fields
  function mockPoseOf(c) {
    const calling = c.calling > 0;
    return {
      id: c.id, x: c.x, y: c.y, facing: c.facing, size: c.size, stage: c.stage, sex: c.sex, looks: c.traits,
      motion: { vx: c.vx, airborne: !c.onGround, walkPhase: c.walkPhase, lying: c.asleep ? 1 : 0 },
      face: { eyesClosed: c.asleep ? 1 : 0, pupilX: c.facing * 0.5, pupilY: 0, mouthOpen: calling ? 0.8 : 0, smile: 0.5, earDroop: 0, blush: 0 },
      state: {
        asleep: c.asleep, held: false, dead: false, eating: false, calling: calling ? 1 : 0, flinch: 0, fear: 0, anger: 0,
        sick: 0, cold: 0, hot: 0, wet: 0, pregnant: 0, inHeat: false,
      },
      focused: false, hovered: false,
    };
  }

  const hsl = (h, s, l) => `hsl(${h},${s}%,${l}%)`;

  // On the ground under the creature (pose.groundY, filled in by the WorldView): its shadow and,
  // when focused, a glowing ring whose back half goes behind the body and front half in front
  function drawGround(g, pose, t, back) {
    const s = pose.size, x = pose.x, gy = pose.groundY;
    if (back) {
      const gap = gy - pose.y;
      if (gap <= 120 && gap >= -20) {
        const k = 1 - Math.max(0, Math.min(1, gap / 120)), rx = s * (0.3 + 0.28 * k);
        g.fillStyle = 'rgba(28,20,36,0.2)';
        g.beginPath(); g.ellipse(x, gy, rx, rx * 0.26, 0, 0, TAU); g.fill();
      }
    }
    if (!pose.focused) return;
    const rx = s * 0.55 + 6, ry = rx * 0.28;
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(155,227,200,' + (0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3))).toFixed(3) + ')';
    g.beginPath(); g.ellipse(x, gy, rx, ry, 0, back ? Math.PI : 0, back ? TAU : Math.PI); g.stroke();
    if (back) {
      g.fillStyle = 'rgba(155,227,200,0.14)';
      g.beginPath(); g.ellipse(x, gy, rx, ry, 0, 0, TAU); g.fill();
    }
  }

  // A round-bodied critter: body, head, ears, tail and legs from pose.looks and pose.motion
  function draw(g, pose, t) {
    drawGround(g, pose, t, true);
    drawBody(g, pose, t);
    drawGround(g, pose, t, false);
  }

  function drawBody(g, pose, t) {
    const s = pose.size, L = pose.looks || {}, m = pose.motion || {}, face = pose.face || {};
    const hue = L.hue || 30, acc = L.accentHue === undefined ? hue + 180 : L.accentHue;
    const lying = m.lying || 0;
    const legLen = s * (0.16 + 0.14 * (L.legLength || 0.5)) * (1 - lying * 0.8);
    const bw = s * (0.36 + 0.08 * (L.plumpness || 0.5)), bh = s * (0.24 + 0.05 * (L.plumpness || 0.5)) * (1 - lying * 0.15);
    const phase = m.walkPhase || 0;
    const stride = m.airborne ? 0.6 : Math.min(1, Math.abs(m.vx || 0) * 2);
    const bob = Math.abs(Math.sin(phase)) * s * 0.03 * stride + (pose.state && pose.state.asleep ? Math.sin(t * 1.6) * s * 0.01 : 0);
    g.save();
    g.translate(pose.x, pose.y);
    g.scale(pose.facing < 0 ? -1 : 1, 1);
    const by = -legLen - bh * 0.8 - bob;
    const outline = hsl(hue, 30, 24);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Legs (far pair darker)
    g.lineWidth = s * 0.075;
    for (let k = 0; k < 2; k++) {
      g.strokeStyle = k ? hsl(hue, 40, 42) : hsl(hue, 35, 30);
      const sw = Math.sin(phase + k * Math.PI) * s * 0.12 * stride;
      g.beginPath();
      g.moveTo(-bw * 0.45, by + bh * 0.4); g.lineTo(-bw * 0.45 + sw, -1);
      g.moveTo(bw * 0.4, by + bh * 0.4); g.lineTo(bw * 0.4 - sw, -1);
      g.stroke();
    }
    // Tail
    const tl = s * (0.25 + 0.4 * (L.tailLength || 0.5));
    g.strokeStyle = hsl(hue, 45, 45);
    g.lineWidth = s * 0.08;
    g.beginPath();
    g.moveTo(-bw * 0.85, by);
    g.quadraticCurveTo(-bw - tl * 0.6, by - tl * 0.1, -bw - tl * 0.7, by - tl * 0.6 + Math.sin(t * 3 + pose.id) * s * 0.05);
    g.stroke();
    // Body
    g.fillStyle = hsl(hue, 55, 60);
    g.strokeStyle = outline;
    g.lineWidth = Math.max(1, s * 0.035);
    g.beginPath(); g.ellipse(0, by, bw, bh, 0, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = hsl(hue, 60, 78);
    g.beginPath(); g.ellipse(bw * 0.1, by + bh * 0.35, bw * 0.6, bh * 0.45, 0, 0, TAU); g.fill();
    if (L.pattern) { // stripes / spots / patches in the accent colour
      g.fillStyle = hsl(acc, 45, 45);
      g.globalAlpha = 0.55;
      g.beginPath();
      for (let k = 0; k < 3; k++) {
        const x = -bw * 0.5 + k * bw * 0.45;
        if (L.pattern === 1) g.ellipse(x, by - bh * 0.35, bw * 0.08, bh * 0.45, 0.2, 0, TAU);
        else g.ellipse(x, by - bh * 0.4, bw * (L.pattern === 2 ? 0.1 : 0.2), bh * (L.pattern === 2 ? 0.12 : 0.25), 0, 0, TAU);
      }
      g.fill();
      g.globalAlpha = 1;
    }
    // Head
    const hr = s * 0.24, hx = bw * 0.85, hy = by - bh * 0.75 + lying * s * 0.2;
    const ear = s * (0.1 + 0.16 * (L.earSize || 0.5));
    g.fillStyle = hsl(hue, 50, 52);
    g.beginPath();
    g.ellipse(hx - hr * 0.5, hy - hr * 0.8, ear * 0.35, ear, -0.4 - (face.earDroop || 0), 0, TAU);
    g.fill(); g.stroke();
    g.fillStyle = hsl(hue, 55, 62);
    g.beginPath(); g.arc(hx, hy, hr, 0, TAU); g.fill(); g.stroke();
    // Eye
    const er = hr * (0.28 + 0.18 * (L.eyeSize || 0.5));
    const ex = hx + hr * 0.35, ey = hy - hr * 0.12;
    if ((face.eyesClosed || 0) > 0.5) {
      g.strokeStyle = outline;
      g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath(); g.arc(ex, ey, er * 0.8, 0.2, Math.PI - 0.2); g.stroke();
    } else {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
      g.fillStyle = '#1d1a24';
      g.beginPath(); g.arc(ex + er * 0.35 * Math.abs(face.pupilX || 0.5), ey + er * 0.1, er * 0.55, 0, TAU); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(ex + er * 0.1, ey - er * 0.3, er * 0.2, 0, TAU); g.fill();
    }
    // Mouth
    g.strokeStyle = outline;
    g.lineWidth = Math.max(0.8, s * 0.025);
    g.beginPath();
    if ((face.mouthOpen || 0) > 0.3) { g.fillStyle = '#6b2d3a'; g.ellipse(hx + hr * 0.62, hy + hr * 0.35, hr * 0.16, hr * 0.2, 0, 0, TAU); g.fill(); }
    else g.arc(hx + hr * 0.5, hy + hr * 0.2, hr * 0.22, 0.2, 1.4);
    g.stroke();
    // Zz while asleep
    if (pose.state && pose.state.asleep) {
      g.scale(pose.facing < 0 ? -1 : 1, 1);
      g.fillStyle = 'rgba(230,240,255,0.8)';
      g.font = `${Math.round(s * 0.3)}px sans-serif`;
      const u = (t * 0.5 + pose.id * 0.3) % 1;
      g.globalAlpha = 1 - u;
      g.fillText('z', (pose.facing < 0 ? -1 : 1) * hx, hy - hr - u * s * 0.5);
    }
    g.restore();
  }

  function bounds(pose) {
    const s = pose.size;
    return { x0: pose.x - s * 0.75, y0: pose.y - s * 1.05, x1: pose.x + s * 0.75, y1: pose.y + 2 };
  }

  function drawPortrait(g, pose, w, h, t) {
    const s = pose.size;
    g.save();
    const k = Math.min(w, h) / (s * 1.8);
    g.translate(w / 2, h * 0.8);
    g.scale(k, k);
    drawBody(g, Object.assign({}, pose, { x: 0, y: 0 }), t);
    g.restore();
  }

  const MockCreatureArt = { draw, bounds, drawPortrait };

  function install() {
    if (!Evo.poseOf) Evo.poseOf = mockPoseOf;
    if (!Evo.CreatureArt) Evo.CreatureArt = MockCreatureArt;
  }

  Evo.MockCreatures = { install, poseOf: mockPoseOf, art: MockCreatureArt };
})(globalThis.Evo);
