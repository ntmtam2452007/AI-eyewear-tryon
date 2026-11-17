const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const btnScan = document.getElementById('btn-scan');
const resultText = document.getElementById('face-shape-result');
const productList = document.getElementById('product-list');
const cameraStatus = document.getElementById('camera-status');
const removeButton = document.getElementById('btn-remove');
const showMesh = document.getElementById('show-mesh');
const faceGuide = document.getElementById('face-guide');
const anchorPreview = document.getElementById('anchor-preview');
const calibrationName = document.getElementById('calibration-name');
const calibrationOutput = document.getElementById('calibration-output');
const adjustmentInputs = [...document.querySelectorAll('[data-adjust]')];

let currentLandmarks = null;
let selectedGlass = null;
let selectedImage = null;
let selectedOverlay = null;
let smoothedPose = null;
let selectionVersion = 0;
const imageCache = new Map();
const adjustments = {};

function loadGlassImage(glass) {
    if (!imageCache.has(glass.image)) {
        imageCache.set(glass.image, new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('Ảnh kính rỗng'));
            image.onerror = () => reject(new Error('Không tải được ảnh kính'));
            image.src = glass.image;
        }));
    }
    return imageCache.get(glass.image);
}

function prepareTryOnImage(image, anchor) {
    const output = document.createElement('canvas');
    output.width = image.naturalWidth;
    output.height = image.naturalHeight;
    const context = output.getContext('2d');
    context.drawImage(image, 0, 0);
    if (anchor.paleTempleRegions) {
        const pixels = context.getImageData(0, 0, output.width, output.height);
        for (const [left, top, right, bottom] of anchor.paleTempleRegions) {
            for (let y = top; y < bottom; y++) {
                for (let x = left; x < right; x++) {
                    const i = (y * output.width + x) * 4;
                    const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
                    if (r > 190 && g > 185 && b > 170 && Math.abs(r - g) < 45 && g - b < 50) pixels.data[i + 3] = 0;
                }
            }
        }
        context.putImageData(pixels, 0, 0);
    }
    const mask = document.createElement('canvas');
    mask.width = output.width;
    mask.height = output.height;
    const pen = mask.getContext('2d');
    pen.strokeStyle = '#fff';
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    for (const [width, ...points] of anchor.templePaths || []) {
        pen.beginPath();
        pen.moveTo(...points[0]);
        for (const point of points.slice(1)) pen.lineTo(...point);
        pen.lineWidth = width * 1.3;
        pen.stroke();
    }
    if (anchor.tintSamples) {
        const pixels = context.getImageData(0, 0, output.width, output.height);
        const original = pixels.data.slice();
        const maskData = pen.getImageData(0, 0, output.width, output.height).data;
        for (let y = 0; y < output.height; y++) {
            for (let x = 0; x < output.width; x++) {
                const i = (y * output.width + x) * 4;
                const amount = maskData[i + 3] / 255;
                if (!amount || !original[i + 3] || original[i] > original[i + 1] + 25) continue;
                const lensX = x < output.width / 2 ? 135 : 365;
                const insideLens = ((x - lensX) / 88) ** 2 + ((y - 252) / 77) ** 2 < 1;
                if (insideLens) {
                    const reference = (y * output.width + anchor.tintSamples[x < output.width / 2 ? 0 : 1]) * 4;
                    for (let channel = 0; channel < 4; channel++) {
                        pixels.data[i + channel] = original[i + channel] * (1 - amount) + original[reference + channel] * amount;
                    }
                } else pixels.data[i + 3] = original[i + 3] * (1 - amount);
            }
        }
        context.putImageData(pixels, 0, 0);
    } else {
        context.globalCompositeOperation = 'destination-out';
        context.drawImage(mask, 0, 0);
    }
    return output;
}

function updateSelectedCard() {
    productList.querySelectorAll('.product-card').forEach(card => {
        const active = Number(card.dataset.glassId) === selectedGlass?.id;
        card.classList.toggle('selected', active);
        const button = card.querySelector('button');
        button.textContent = active ? 'Đang thử' : 'Thử kính (AR)';
        button.setAttribute('aria-pressed', String(active));
    });
    removeButton.hidden = !selectedGlass;
    faceGuide.hidden = Boolean(selectedGlass);
}

function showAnchorPreview() {
    anchorPreview.replaceChildren();
    if (!selectedGlass) {
        calibrationName.textContent = 'Chọn mẫu kính để hiệu chỉnh.';
        return;
    }
    const anchor = tryOnAnchors[selectedGlass.id];
    const image = document.createElement('img');
    image.src = selectedGlass.image;
    image.alt = selectedGlass.name;
    image.style.clipPath = `inset(0 ${100 * (1 - anchor.crop[1])}% 0 ${100 * anchor.crop[0]}%)`;
    anchorPreview.appendChild(image);
    for (const [name, label] of [['left', 'T'], ['right', 'P'], ['bridge', 'C']]) {
        const dot = document.createElement('span');
        dot.className = 'anchor-dot';
        dot.textContent = label;
        dot.style.left = `${anchor[name][0] * 100}%`;
        dot.style.top = `${anchor[name][1] * 100}%`;
        anchorPreview.appendChild(dot);
    }
    calibrationName.textContent = `${selectedGlass.name}: T/P theo phía ảnh; C là cầu kính. ${anchor.note || 'Điểm neo ước lượng từ ảnh; chưa xác minh bằng webcam thật.'}`;
}

async function selectGlass(glass) {
    const version = ++selectionVersion;
    selectedGlass = glass;
    selectedImage = null;
    selectedOverlay = null;
    smoothedPose = null;
    updateSelectedCard();
    showAnchorPreview();
    adjustmentInputs.forEach(input => { input.value = (adjustments[glass.id] || tryOnAnchors[glass.id].adjustment)?.[input.dataset.adjust] ?? (input.dataset.adjust === 'size' ? 1 : 0); });
    cameraStatus.textContent = `Đang tải ${glass.name}...`;
    try {
        const image = await loadGlassImage(glass);
        if (version !== selectionVersion) return;
        selectedImage = image;
        selectedOverlay = prepareTryOnImage(image, tryOnAnchors[glass.id]);
        anchorPreview.querySelector('img').src = selectedOverlay.toDataURL('image/png');
        cameraStatus.textContent = `Đang thử ${glass.name}. Giữ mặt trước camera.`;
    } catch (error) {
        if (version !== selectionVersion) return;
        imageCache.delete(glass.image);
        selectedGlass = null;
        updateSelectedCard();
        showAnchorPreview();
        cameraStatus.textContent = `Không tải được ảnh ${glass.name}. Hãy thử lại.`;
    }
}

removeButton.addEventListener('click', () => {
    ++selectionVersion;
    selectedGlass = selectedImage = selectedOverlay = smoothedPose = null;
    updateSelectedCard();
    showAnchorPreview();
    cameraStatus.textContent = 'Đã bỏ kính. Camera vẫn đang hoạt động.';
});

adjustmentInputs.forEach(input => input.addEventListener('input', () => {
    if (!selectedGlass) return;
    adjustments[selectedGlass.id] ??= {size: 1, x: 0, y: 0, angle: 0, ...tryOnAnchors[selectedGlass.id].adjustment};
    adjustments[selectedGlass.id][input.dataset.adjust] = Number(input.value);
    smoothedPose = null;
}));

document.getElementById('btn-reset').addEventListener('click', () => {
    if (!selectedGlass) return;
    delete adjustments[selectedGlass.id];
    adjustmentInputs.forEach(input => { input.value = tryOnAnchors[selectedGlass.id].adjustment?.[input.dataset.adjust] ?? (input.dataset.adjust === 'size' ? 1 : 0); });
    calibrationOutput.hidden = true;
    smoothedPose = null;
});

document.getElementById('btn-export').addEventListener('click', () => {
    if (!selectedGlass) return;
    calibrationOutput.value = JSON.stringify({id: selectedGlass.id, image: selectedGlass.image,
        anchors: tryOnAnchors[selectedGlass.id], adjustment: adjustments[selectedGlass.id] || tryOnAnchors[selectedGlass.id].adjustment || {size: 1, x: 0, y: 0, angle: 0}}, null, 2);
    calibrationOutput.hidden = false;
    calibrationOutput.select();
});

const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });

faceMesh.onResults((results) => {
    if (!videoElement.videoWidth || !videoElement.videoHeight) return;
    if (canvasElement.width !== videoElement.videoWidth || canvasElement.height !== videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        smoothedPose = null;
    }
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        currentLandmarks = results.multiFaceLandmarks[0];
        if (!selectedGlass || showMesh.checked) {
            drawConnectors(canvasCtx, currentLandmarks, FACEMESH_TESSELATION, {color: '#ffffff80', lineWidth: 1});
        }
        if (selectedGlass && selectedImage) {
            const pose = glassesPose(currentLandmarks, canvasElement.width, canvasElement.height,
                selectedImage.naturalWidth, selectedImage.naturalHeight, tryOnAnchors[selectedGlass.id], adjustments[selectedGlass.id] || tryOnAnchors[selectedGlass.id].adjustment);
            if (pose) {
                if (smoothedPose) {
                    const a = 0.4;
                    const angleDiff = Math.atan2(Math.sin(pose.angle - smoothedPose.angle), Math.cos(pose.angle - smoothedPose.angle));
                    smoothedPose = {x: smoothedPose.x + a * (pose.x - smoothedPose.x),
                        y: smoothedPose.y + a * (pose.y - smoothedPose.y),
                        scale: smoothedPose.scale + a * (pose.scale - smoothedPose.scale),
                        angle: smoothedPose.angle + a * angleDiff, imageMid: pose.imageMid};
                } else smoothedPose = pose;
                canvasCtx.translate(smoothedPose.x, smoothedPose.y);
                canvasCtx.rotate(smoothedPose.angle);
                canvasCtx.scale(smoothedPose.scale, smoothedPose.scale);
                const crop = tryOnAnchors[selectedGlass.id].crop;
                canvasCtx.beginPath();
                canvasCtx.rect(crop[0] * selectedImage.naturalWidth - pose.imageMid.x, -pose.imageMid.y,
                    (crop[1] - crop[0]) * selectedImage.naturalWidth, selectedImage.naturalHeight);
                canvasCtx.clip();
                canvasCtx.drawImage(selectedOverlay || selectedImage, -pose.imageMid.x, -pose.imageMid.y);
            } else smoothedPose = null;
        }
    } else {
        currentLandmarks = null;
        smoothedPose = null;
    }
    canvasCtx.restore();
});

btnScan.disabled = true;
async function startCamera() {
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}});
        videoElement.srcObject = stream;
        await videoElement.play();
        btnScan.disabled = false;
        cameraStatus.textContent = 'Camera sẵn sàng. Đưa mặt vào khung và bấm Quét.';
        async function processFrame() {
            try {
                if (videoElement.readyState >= 2) await faceMesh.send({image: videoElement});
                requestAnimationFrame(processFrame);
            } catch (error) {
                cameraStatus.textContent = 'Không theo dõi được khuôn mặt. Hãy tải lại trang.';
            }
        }
        requestAnimationFrame(processFrame);
    } catch (error) {
        stream?.getTracks().forEach(track => track.stop());
        cameraStatus.textContent = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
            ? 'Camera bị từ chối. Hãy cấp quyền trong trình duyệt rồi tải lại trang.'
            : 'Không mở được camera. Hãy kiểm tra thiết bị và tải lại trang.';
    }
}
startCamera();

// 2. Hàm trích xuất 7 đặc trưng khuôn mặt (Dựa theo model của TV1 & TV2)
// HÀM HỖ TRỢ 1: Tính khoảng cách Euclidean có nhân chuẩn hóa Width/Height (Theo đúng lưu ý của TV1)
function calcDistance(p1, p2, width, height) {
    const x1 = p1.x * width;
    const y1 = p1.y * height;
    const x2 = p2.x * width;
    const y2 = p2.y * height;
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// HÀM HỖ TRỢ 2: Tính góc (độ) tại đỉnh p2 tạo bởi 3 điểm p1 - p2 - p3
function calcAngle(p1, p2, p3, width, height) {
    // Chuẩn hóa tọa độ
    const p1x = p1.x * width, p1y = p1.y * height;
    const p2x = p2.x * width, p2y = p2.y * height;
    const p3x = p3.x * width, p3y = p3.y * height;

    // Tạo vector A (p2 -> p1) và vector B (p2 -> p3)
    const v1 = { x: p1x - p2x, y: p1y - p2y };
    const v2 = { x: p3x - p2x, y: p3y - p2y };

    // Tính Tích vô hướng (Dot Product) và Độ lớn (Magnitude)
    const dotProduct = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    // Tính cos(góc) và đổi ra radian rồi sang độ
    let cosTheta = dotProduct / (mag1 * mag2);
    // Xử lý sai số dấu phẩy động
    cosTheta = Math.max(-1.0, Math.min(1.0, cosTheta));
    const angleRad = Math.acos(cosTheta);
    
    return angleRad * (180 / Math.PI);
}

// HÀM CHÍNH: Trích xuất 7 đặc trưng khuôn mặt chuẩn xác từ TV1
function extractFeatures(landmarks, width, height) {
    // Tính các khoảng cách nền tảng
    const dist_10_152 = calcDistance(landmarks[10], landmarks[152], width, height); // Dài mặt
    const dist_234_454 = calcDistance(landmarks[234], landmarks[454], width, height); // Rộng gò má
    const dist_54_284 = calcDistance(landmarks[54], landmarks[284], width, height); // Rộng trán
    const dist_58_288 = calcDistance(landmarks[58], landmarks[288], width, height); // Rộng hàm

    // 1. ratio_length_cheek
    const ratio_length_cheek = dist_10_152 / dist_234_454;
    
    // 2. ratio_forehead_cheek
    const ratio_forehead_cheek = dist_54_284 / dist_234_454;
    
    // 3. ratio_jaw_cheek
    const ratio_jaw_cheek = dist_58_288 / dist_234_454;
    
    // 4. ratio_forehead_jaw
    const ratio_forehead_jaw = dist_54_284 / dist_58_288;
    
    // 5. jaw_angle (Góc tại đỉnh 152 tạo bởi 58 - 152 - 288)
    const jaw_angle = calcAngle(landmarks[58], landmarks[152], landmarks[288], width, height);
    
    // 6. cheek_angle (Góc tại đỉnh 58 tạo bởi 234 - 58 - 152)
    const cheek_angle = calcAngle(landmarks[234], landmarks[58], landmarks[152], width, height);
    
    // 7. jaw_taper_ratio
    const jaw_taper_ratio = (1 - ratio_jaw_cheek) / ratio_length_cheek;

    // Xuất ra mảng 7 biến theo ĐÚNG THỨ TỰ file CSV
    return [
        ratio_length_cheek,
        ratio_forehead_cheek,
        ratio_jaw_cheek,
        ratio_forehead_jaw,
        jaw_angle,
        cheek_angle,
        jaw_taper_ratio
    ];
} 

// 3. Hàm xử lý logic khi bấm nút Quét
btnScan.addEventListener('click', () => {
    if (!currentLandmarks) {
        cameraStatus.textContent = 'Chưa nhận diện được mặt. Vui lòng đưa mặt vào giữa khung.';
        return;
    }

    btnScan.innerText = "Đang xử lý AI...";
    btnScan.disabled = true;

    // a. Trích xuất đặc trưng
    const vWidth = videoElement.videoWidth;
    const vHeight = videoElement.videoHeight;
    const features = extractFeatures(currentLandmarks, vWidth, vHeight);
    if (!vWidth || !vHeight || !features.every(Number.isFinite)) {
        cameraStatus.textContent = 'Dữ liệu khuôn mặt chưa ổn định. Vui lòng quét lại.';
        btnScan.innerText = 'Quét lại';
        btnScan.disabled = false;
        return;
    }

    // b. Gọi mô hình Machine Learning thực tế từ file model.js
    const predictionArray = score(features); // Trả về mảng ví dụ [0, 1, 0, 0, 0]
    
    // c. Tìm dáng mặt có xác suất cao nhất
    // Giả sử danh sách class của TV2 là:
    const classNames = ["diamond", "heart", "oblong", "round", "square"];
    const maxIndex = predictionArray.indexOf(Math.max(...predictionArray));
    const predictedShape = classNames[maxIndex];
    if (!predictedShape) {
        cameraStatus.textContent = 'Chưa phân tích được dáng mặt. Vui lòng quét lại.';
        btnScan.innerText = 'Quét lại';
        btnScan.disabled = false;
        return;
    }

    // d. Cập nhật UI
    resultText.innerText = `Mặt ${predictedShape}`;
    btnScan.innerText = "Quét lại";
    btnScan.disabled = false;
    cameraStatus.textContent = `Đã quét mặt ${predictedShape}. Chọn kính để thử.`;

    // e. Render kính từ realGlassesData (file data.js của TV4)
    productList.innerHTML = "";
    // Lọc các kính có suitableFor chứa predictedShape
    const matchingGlasses = realGlassesData.filter(glass => glass.suitableFor.includes(predictedShape));

    if (matchingGlasses.length === 0) {
        productList.innerHTML = "<p style='color:gray; padding:10px;'>Hệ thống hiện chưa có gọng kính chuyên dụng cho dáng mặt này.</p>";
        return;
    }

    matchingGlasses.forEach(glass => {
        const card = document.createElement('div');
        card.className = 'product-card';
        card.dataset.glassId = glass.id;
        card.innerHTML = `
            <div class="product-image">
                <img src="${glass.image}" alt="${glass.name}" style="width:100%; height:100%; object-fit:contain;">
            </div>
            <div class="product-info">
                <h4>${glass.name}</h4>
                <p>${glass.reason}</p>
                <span class="price">${glass.price}</span><br>
                <button class="cta-btn secondary" type="button" aria-pressed="false">Thử kính (AR)</button>
            </div>
        `;
        card.querySelector('button').addEventListener('click', () => selectGlass(glass));
        productList.appendChild(card);
    });
    updateSelectedCard();
});
