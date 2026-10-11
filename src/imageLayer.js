// Custom MapLibre layer drawing an image warped through a pixel -> Mercator transform.

const GRID = 64;

const VERTEX_SOURCE = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    v_uv = a_uv;
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D u_image;
uniform float u_opacity;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    fragColor = texture(u_image, v_uv) * u_opacity;
}`;

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
}

export function createProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
}

/** Texture coordinates and triangle indices of an n × n cell grid. */
export function gridGeometry(n) {
    const uv = new Float32Array((n + 1) * (n + 1) * 2);
    const indices = new Uint32Array(n * n * 6);
    for (let j = 0, k = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++, k += 2) {
            uv[k] = i / n;
            uv[k + 1] = j / n;
        }
    }
    for (let j = 0, k = 0; j < n; j++) {
        for (let i = 0; i < n; i++, k += 6) {
            const v = j * (n + 1) + i;
            indices.set([v, v + 1, v + n + 1, v + 1, v + n + 2, v + n + 1], k);
        }
    }
    return {uv, indices};
}

/** Absolute Mercator positions of the grid vertices under a transform. */
export function gridPositions(transform, width, height, n) {
    const mesh = new Float64Array((n + 1) * (n + 1) * 2);
    for (let j = 0, k = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++, k += 2) {
            const [x, y] = transform.forward(i / n * width, j / n * height);
            mesh[k] = x;
            mesh[k + 1] = y;
        }
    }
    return mesh;
}

/** Downscales a bitmap to fit maxSize if needed. */
export async function fitTexture(bitmap, maxSize) {
    if (bitmap.width <= maxSize && bitmap.height <= maxSize) return bitmap;
    const s = maxSize / Math.max(bitmap.width, bitmap.height);
    return createImageBitmap(bitmap, {
        resizeWidth: Math.floor(bitmap.width * s),
        resizeHeight: Math.floor(bitmap.height * s),
        resizeQuality: 'high',
    });
}

/** Uploads a bitmap as a premultiplied, mipmapped texture. */
export function uploadTexture(gl, texture, bitmap) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export class ImageLayer {
    constructor(id = 'georef-image') {
        this.id = id;
        this.type = 'custom';
        this.renderingMode = '2d';
        this.opacity = 1;
        this.image = null; // {bitmap (texture), source (full resolution), width, height}
        this.mesh = null; // Float64Array of absolute Mercator vertex positions
        this.origin = [0, 0];
        this.dirty = false;
    }

    onAdd(map, gl) {
        this.map = map;
        this.gl = gl;
        const program = createProgram(gl);
        this.program = program;
        this.uMatrix = gl.getUniformLocation(program, 'u_matrix');
        this.uImage = gl.getUniformLocation(program, 'u_image');
        this.uOpacity = gl.getUniformLocation(program, 'u_opacity');

        this.posBuffer = gl.createBuffer();
        this.uvBuffer = gl.createBuffer();
        this.indexBuffer = gl.createBuffer();
        this.texture = gl.createTexture();

        const {uv, indices} = gridGeometry(GRID);
        this.indices = indices;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        if (this.image) this.uploadTexture();
    }

    onRemove(map, gl) {
        gl.deleteProgram(this.program);
        gl.deleteBuffer(this.posBuffer);
        gl.deleteBuffer(this.uvBuffer);
        gl.deleteBuffer(this.indexBuffer);
        gl.deleteTexture(this.texture);
    }

    async setImage(source) {
        const max = this.gl ? this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) : 4096;
        const bitmap = await fitTexture(source, max);
        this.image = {bitmap, source, width: source.width, height: source.height};
        this.mesh = null;
        if (this.gl) this.uploadTexture();
    }

    uploadTexture() {
        uploadTexture(this.gl, this.texture, this.image.bitmap);
    }

    setTransform(transform) {
        const {width, height} = this.image;
        const mesh = gridPositions(transform, width, height, GRID);
        this.mesh = mesh;
        this.dirty = true;
        this.map?.triggerRepaint();
    }

    setOpacity(opacity) {
        this.opacity = opacity;
        this.map?.triggerRepaint();
    }

    // Vertices are uploaded relative to an origin to keep float32 precision at high zoom.
    uploadMesh() {
        const mesh = this.mesh;
        const ox = mesh[0];
        const oy = mesh[1];
        const rel = new Float32Array(mesh.length);
        for (let k = 0; k < mesh.length; k += 2) {
            rel[k] = mesh[k] - ox;
            rel[k + 1] = mesh[k + 1] - oy;
        }
        this.origin = [ox, oy];
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, rel, gl.DYNAMIC_DRAW);
        this.dirty = false;
    }

    render(gl, options) {
        if (!this.image || !this.mesh) return;
        if (this.dirty) this.uploadMesh();

        // matrix · translate(origin), computed in float64
        const m = options.defaultProjectionData.mainMatrix;
        const [ox, oy] = this.origin;
        const matrix = new Float32Array(m);
        for (let r = 0; r < 4; r++) matrix[12 + r] = m[r] * ox + m[4 + r] * oy + m[12 + r];

        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uMatrix, false, matrix);
        gl.uniform1f(this.uOpacity, this.opacity);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.uImage, 0);

        const aPos = gl.getAttribLocation(this.program, 'a_pos');
        const aUv = gl.getAttribLocation(this.program, 'a_uv');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        gl.enableVertexAttribArray(aUv);
        gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
    }

    /** Image pixel [u, v] under a Mercator point, or null if outside the image. */
    pixelAt(x, y) {
        const mesh = this.mesh;
        if (!mesh) return null;
        const {width, height} = this.image;
        const idx = this.indices;
        for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
            const x0 = mesh[a], y0 = mesh[a + 1];
            const e1x = mesh[b] - x0, e1y = mesh[b + 1] - y0;
            const e2x = mesh[c] - x0, e2y = mesh[c + 1] - y0;
            const det = e1x * e2y - e1y * e2x;
            if (det === 0) continue;
            const px = x - x0, py = y - y0;
            const s = (px * e2y - py * e2x) / det;
            const q = (e1x * py - e1y * px) / det;
            if (s < 0 || q < 0 || s + q > 1) continue;
            const gi = (k) => (k / 2) % (GRID + 1);
            const gj = (k) => Math.floor(k / 2 / (GRID + 1));
            const i = gi(a) + s * (gi(b) - gi(a)) + q * (gi(c) - gi(a));
            const j = gj(a) + s * (gj(b) - gj(a)) + q * (gj(c) - gj(a));
            return [i / GRID * width, j / GRID * height];
        }
        return null;
    }
}
