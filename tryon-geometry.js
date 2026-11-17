// Face Mesh: 33/133 và 362/263 là góc mắt; 6 là sống mũi. Không dùng điểm mống mắt.
function glassesPose(landmarks, videoWidth, videoHeight, imageWidth, imageHeight, anchors, adjustment = {}) {
    if (!landmarks || !videoWidth || !videoHeight || !imageWidth || !imageHeight || !anchors) return null;
    const point = (index) => ({x: landmarks[index]?.x * videoWidth, y: landmarks[index]?.y * videoHeight});
    const midpoint = (a, b) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
    const left = midpoint(point(33), point(133));
    const right = midpoint(point(362), point(263));
    const nose = point(6);
    const cheekLeft = point(234), cheekRight = point(454);
    const values = [left.x, left.y, right.x, right.y, nose.x, nose.y, ...anchors.left, ...anchors.right, ...anchors.bridge];
    if (!values.every(Number.isFinite)) return null;
    const dx = right.x - left.x, dy = right.y - left.y;
    const faceSpan = Math.hypot(dx, dy);
    const imageDx = (anchors.right[0] - anchors.left[0]) * imageWidth;
    const imageDy = (anchors.right[1] - anchors.left[1]) * imageHeight;
    const imageSpan = Math.hypot(imageDx, imageDy);
    if (faceSpan < 8 || imageSpan < 8 || faceSpan > videoWidth * 0.8) return null;
    const size = adjustment.size ?? 1;
    const eyeScale = faceSpan / imageSpan;
    const faceWidth = Math.hypot(cheekRight.x - cheekLeft.x, cheekRight.y - cheekLeft.y);
    const frameWidth = ((anchors.crop?.[1] ?? 1) - (anchors.crop?.[0] ?? 0)) * imageWidth;
    const faceScale = faceWidth > faceSpan && faceWidth < videoWidth * 0.9 && frameWidth > 8
        ? faceWidth * 0.98 / frameWidth : eyeScale;
    const scale = Math.max(eyeScale, Math.min(faceScale, eyeScale * 1.25)) * size;
    const angle = Math.atan2(dy, dx) - Math.atan2(imageDy, imageDx) + (adjustment.angle ?? 0) * Math.PI / 180;
    const imageMid = midpoint({x: anchors.left[0] * imageWidth, y: anchors.left[1] * imageHeight},
        {x: anchors.right[0] * imageWidth, y: anchors.right[1] * imageHeight});
    const bridgeOffset = {x: anchors.bridge[0] * imageWidth - imageMid.x, y: anchors.bridge[1] * imageHeight - imageMid.y};
    const center = midpoint(left, right);
    const bridgeX = center.x + scale * (bridgeOffset.x * Math.cos(angle) - bridgeOffset.y * Math.sin(angle));
    const bridgeY = center.y + scale * (bridgeOffset.x * Math.sin(angle) + bridgeOffset.y * Math.cos(angle));
    const bridgeCorrectionX = Math.max(-faceSpan * 0.08, Math.min(faceSpan * 0.08, (nose.x - bridgeX) * 0.25));
    const bridgeCorrectionY = Math.max(-faceSpan * 0.08, Math.min(faceSpan * 0.08, (nose.y - bridgeY) * 0.25));
    const x = center.x + bridgeCorrectionX + (adjustment.x ?? 0) * faceSpan;
    const y = center.y + bridgeCorrectionY + (adjustment.y ?? 0) * faceSpan;
    return [x, y, scale, angle].every(Number.isFinite) ? {x, y, scale, angle, imageMid} : null;
}

if (typeof module !== 'undefined') module.exports = {glassesPose};
