import {createProgram, fitTexture, gridGeometry, gridPositions, uploadTexture} from './imageLayer.js';

// World files are written in EPSG:3857 (Web Mercator) meters.
const WORLD = 2 * Math.PI * 6378137;
const EXPORT_GRID = 256;
const MAX_PIXELS = 100e6;

const toMetersX = (x) => (x - 0.5) * WORLD;
const toMetersY = (y) => (0.5 - y) * WORLD;

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Lines: A, D, B, E, C, F where x = A·col + B·row + C and y = D·col + E·row + F (pixel centers).
function worldFile(A, D, B, E, C, F) {
    return new Blob([[A, D, B, E, C, F].map(String).join('\n') + '\n'], {type: 'text/plain'});
}

async function toPng(file, bitmap) {
    if (file.type === 'image/png') return file;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({type: 'image/png'});
}

/** The original image with a world file for its similarity transform. */
async function exportOriginal(file, source, {a, b}) {
    // x = a0·u − a1·v + b0, y = a1·u + a0·v + b1 in Mercator units
    const A = a[0] * WORLD;
    const B = -a[1] * WORLD;
    const D = -a[1] * WORLD;
    const E = -a[0] * WORLD;
    const C = toMetersX(a[0] * 0.5 - a[1] * 0.5 + b[0]);
    const F = toMetersY(a[1] * 0.5 + a[0] * 0.5 + b[1]);
    return {png: await toPng(file, source), world: worldFile(A, D, B, E, C, F)};
}

function outlineArea(mesh, n) {
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(i);
    for (let j = 0; j < n; j++) ring.push(j * (n + 1) + n);
    for (let i = n; i > 0; i--) ring.push(n * (n + 1) + i);
    for (let j = n; j > 0; j--) ring.push(j * (n + 1));
    let area = 0;
    for (let k = 0; k < ring.length; k++) {
        const p = ring[k] * 2;
        const q = ring[(k + 1) % ring.length] * 2;
        area += mesh[p] * mesh[q + 1] - mesh[q] * mesh[p + 1];
    }
    return Math.abs(area) / 2;
}

/** Warps the image into a north-up raster with an unrotated world file. */
async function exportWarped(source, transform) {
    const {width, height} = source;
    const mesh = gridPositions(transform, width, height, EXPORT_GRID);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < mesh.length; k += 2) {
        minX = Math.min(minX, mesh[k]); maxX = Math.max(maxX, mesh[k]);
        minY = Math.min(minY, mesh[k + 1]); maxY = Math.max(maxY, mesh[k + 1]);
    }

    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false});
    if (!gl) throw new Error('WebGL2 is not available');
    try {
        // Keep roughly the original resolution, within GPU and memory limits.
        const maxDim = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS), 16384);
        let px = Math.sqrt(outlineArea(mesh, EXPORT_GRID) / (width * height));
        px = Math.max(px, (maxX - minX) / maxDim, (maxY - minY) / maxDim, Math.sqrt((maxX - minX) * (maxY - minY) / MAX_PIXELS));
        canvas.width = Math.max(1, Math.ceil((maxX - minX) / px));
        canvas.height = Math.max(1, Math.ceil((maxY - minY) / px));
        // The browser may clamp the drawing buffer; derive pixel sizes from what we actually got.
        const outW = gl.drawingBufferWidth;
        const outH = gl.drawingBufferHeight;
        const spanX = canvas.width * px;
        const spanY = canvas.height * px;
        const pxX = spanX / outW;
        const pxY = spanY / outH;

        const program = createProgram(gl);
        const {uv, indices} = gridGeometry(EXPORT_GRID);
        const rel = new Float32Array(mesh.length);
        for (let k = 0; k < mesh.length; k += 2) {
            rel[k] = mesh[k] - minX;
            rel[k + 1] = mesh[k + 1] - minY;
        }
        const bind = (name, data) => {
            const loc = gl.getAttribLocation(program, name);
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        };
        gl.useProgram(program);
        bind('a_pos', rel);
        bind('a_uv', uv);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        uploadTexture(gl, gl.createTexture(), await fitTexture(source, gl.getParameter(gl.MAX_TEXTURE_SIZE)));
        gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), 1);
        // Mercator y grows southwards, clip y grows upwards: north ends up on the top row.
        gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, [
            2 / spanX, 0, 0, 0,
            0, -2 / spanY, 0, 0,
            0, 0, 1, 0,
            -1, 1, 0, 1,
        ]);

        gl.viewport(0, 0, outW, outH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);

        const png = await new Promise((resolve, reject) =>
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
        const A = pxX * WORLD;
        const E = -pxY * WORLD;
        return {png, world: worldFile(A, 0, 0, E, toMetersX(minX) + A / 2, toMetersY(minY) + E / 2)};
    } finally {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}

/**
 * Downloads a PNG and its .pgw world file (EPSG:3857).
 * Up to two anchors the original image is kept; with more it is resampled through the warp.
 */
export async function exportGeoreferenced(file, source, anchors) {
    const base = file.name.replace(/\.[^.]+$/, '') + '_georef';
    const {png, world} = anchors.anchors.length > 2
        ? await exportWarped(source, anchors.transform)
        : await exportOriginal(file, source, anchors.transform);
    download(png, `${base}.png`);
    download(world, `${base}.pgw`);
}
