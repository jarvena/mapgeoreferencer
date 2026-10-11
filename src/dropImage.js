import {MercatorCoordinate} from 'maplibre-gl';
import {similarity} from './transform.js';

/** Calls onImage(bitmap, file) for the first image file dropped onto the page. */
export function setupDrop(target, onImage) {
    let depth = 0;
    const highlight = (on) => target.classList.toggle('dragging', on);

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        depth++;
        highlight(true);
    });
    window.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) highlight(false);
    });
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', async (e) => {
        e.preventDefault();
        depth = 0;
        highlight(false);
        await loadImageFile([...e.dataTransfer.files], onImage);
    });
}

/** Decodes the first image file in files and calls onImage(bitmap, file). */
export async function loadImageFile(files, onImage) {
    const file = [...files].find(f => f.type.startsWith('image/'));
    if (!file) return;
    try {
        onImage(await createImageBitmap(file, {imageOrientation: 'from-image'}), file);
    } catch (err) {
        console.error(`Could not decode ${file.name}`, err);
    }
}

/** North-up similarity fitting a width × height image into 80% of the current view. */
export function initialPlacement(map, width, height) {
    const {clientWidth: w, clientHeight: h} = map.getContainer();
    const center = MercatorCoordinate.fromLngLat(map.unproject([w / 2, h / 2]));
    const right = MercatorCoordinate.fromLngLat(map.unproject([w / 2 + 1, h / 2]));
    const mercPerScreenPx = Math.hypot(right.x - center.x, right.y - center.y);
    const k = Math.min(w / width, h / height) * 0.8 * mercPerScreenPx;
    return similarity([k, 0], [center.x - k * width / 2, center.y - k * height / 2]);
}
