const assert = require('node:assert/strict');
const {glassesPose} = require('./tryon-geometry');
const {tryOnAnchors} = require('./tryon-data');
assert.equal(Object.keys(tryOnAnchors).length, 20);
for (const anchor of Object.values(tryOnAnchors)) {
    assert.ok(anchor.left[0] < anchor.bridge[0] && anchor.bridge[0] < anchor.right[0]);
    assert.ok([anchor.left, anchor.right, anchor.bridge].flat().every(value => value >= 0 && value <= 1));
    assert.ok(anchor.crop[0] < anchor.left[0] && anchor.right[0] < anchor.crop[1]);
    assert.equal((anchor.templePaths || anchor.paleTempleRegions).length, 2);
    for (const [width, ...points] of anchor.templePaths || []) {
        assert.ok(width > 0 && points.length >= 2 && points.flat().every(Number.isFinite));
    }
}
const landmarks = Array.from({length: 468}, () => ({x: 0.5, y: 0.5}));
landmarks[33] = {x: 0.3, y: 0.5};
landmarks[133] = {x: 0.4, y: 0.5};
landmarks[362] = {x: 0.6, y: 0.5};
landmarks[263] = {x: 0.7, y: 0.5};
const anchors = {left: [0.3, 0.5], right: [0.7, 0.5], bridge: [0.5, 0.5]};
const pose = glassesPose(landmarks, 640, 480, 500, 200, anchors);
assert.equal(pose.x, 320);
assert.equal(pose.y, 240);
assert.ok(Math.abs(pose.scale - 0.96) < 1e-10);
assert.equal(pose.angle, 0);
const adjusted = glassesPose(landmarks, 640, 480, 500, 200, anchors, {size: 0.96, y: 0.03});
assert.ok(adjusted.scale < pose.scale && adjusted.y > pose.y);
const wideFace = landmarks.map(point => ({...point}));
wideFace[234].x = 0.15; wideFace[454].x = 0.85;
const widePose = glassesPose(wideFace, 640, 480, 500, 200, {...anchors, crop: [0.1, 0.9]});
assert.ok(widePose.scale > pose.scale && widePose.scale <= pose.scale * 1.25);
wideFace[234].x = 0.01; wideFace[454].x = 0.99;
assert.equal(glassesPose(wideFace, 640, 480, 500, 200, {...anchors, crop: [0.1, 0.9]}).scale, pose.scale);
const closer = landmarks.map(point => ({...point}));
closer[33].x = 0.2; closer[133].x = 0.3;
closer[362].x = 0.7; closer[263].x = 0.8;
assert.ok(glassesPose(closer, 640, 480, 500, 200, anchors).scale > pose.scale);
const moved = landmarks.map(point => ({x: point.x + 0.1, y: point.y}));
assert.ok(glassesPose(moved, 640, 480, 500, 200, anchors).x > pose.x);
landmarks[33].y = landmarks[133].y = 0.45;
landmarks[362].y = landmarks[263].y = 0.55;
assert.ok(glassesPose(landmarks, 640, 480, 500, 200, anchors).angle > 0);
assert.equal(glassesPose(landmarks, 0, 480, 500, 200, anchors), null);
landmarks[33].x = NaN;
assert.equal(glassesPose(landmarks, 640, 480, 500, 200, anchors), null);
console.log('tryon geometry: OK');
