// Image pixel (u, v) -> Mercator unit (x, y) transforms.
// A similarity is stored in complex form z' = a·z + b, with z = u + iv.

export function similarity(a, b) {
    return {
        mode: 'similarity',
        a,
        b,
        forward(u, v) {
            return [a[0] * u - a[1] * v + b[0], a[1] * u + a[0] * v + b[1]];
        },
    };
}

function cmul(p, q) {
    return [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
}

function cdiv(p, q) {
    const d = q[0] * q[0] + q[1] * q[1];
    return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d];
}

function sub(p, q) {
    return [p[0] - q[0], p[1] - q[1]];
}

function translateBase(base, anchor) {
    return similarity(base.a, sub(anchor.target, cmul(base.a, anchor.pixel)));
}

// Least-squares similarity; falls back to translation when pixels coincide.
function fitSimilarity(base, anchors) {
    const n = anchors.length;
    const cp = [0, 0];
    const ct = [0, 0];
    for (const {pixel, target} of anchors) {
        cp[0] += pixel[0] / n; cp[1] += pixel[1] / n;
        ct[0] += target[0] / n; ct[1] += target[1] / n;
    }
    let num = [0, 0];
    let den = 0;
    for (const {pixel, target} of anchors) {
        const p = sub(pixel, cp);
        const t = sub(target, ct);
        num = [num[0] + p[0] * t[0] + p[1] * t[1], num[1] + p[0] * t[1] - p[1] * t[0]];
        den += p[0] * p[0] + p[1] * p[1];
    }
    if (den < 1e-9) return translateBase(base, {pixel: cp, target: ct});
    const a = [num[0] / den, num[1] / den];
    return similarity(a, sub(ct, cmul(a, cp)));
}

function normalizer(points) {
    const n = points.length;
    let cx = 0, cy = 0;
    for (const [x, y] of points) { cx += x / n; cy += y / n; }
    let s = 0;
    for (const [x, y] of points) s += Math.hypot(x - cx, y - cy) / n;
    s = s || 1;
    return {
        to: (x, y) => [(x - cx) / s, (y - cy) / s],
        from: (x, y) => [x * s + cx, y * s + cy],
    };
}

function kernel(r2) {
    return r2 > 0 ? 0.5 * r2 * Math.log(r2) : 0; // r² log r
}

// Solves A·X = B in place (B has two columns). Returns null if singular.
function solve(A, B) {
    const n = A.length;
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        if (Math.abs(A[p][c]) < 1e-10) return null;
        [A[c], A[p]] = [A[p], A[c]];
        [B[c], B[p]] = [B[p], B[c]];
        for (let r = c + 1; r < n; r++) {
            const f = A[r][c] / A[c][c];
            if (f === 0) continue;
            for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
            B[r][0] -= f * B[c][0];
            B[r][1] -= f * B[c][1];
        }
    }
    for (let r = n - 1; r >= 0; r--) {
        for (let k = r + 1; k < n; k++) {
            B[r][0] -= A[r][k] * B[k][0];
            B[r][1] -= A[r][k] * B[k][1];
        }
        B[r][0] /= A[r][r];
        B[r][1] /= A[r][r];
    }
    return B;
}

function fitTps(anchors) {
    const n = anchors.length;
    const np = normalizer(anchors.map(a => a.pixel));
    const nt = normalizer(anchors.map(a => a.target));
    const P = anchors.map(a => np.to(...a.pixel));
    const T = anchors.map(a => nt.to(...a.target));

    const m = n + 3;
    const A = Array.from({length: m}, () => new Array(m).fill(0));
    const B = Array.from({length: m}, () => [0, 0]);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const dx = P[i][0] - P[j][0];
            const dy = P[i][1] - P[j][1];
            A[i][j] = kernel(dx * dx + dy * dy);
        }
        A[i][n] = A[n][i] = 1;
        A[i][n + 1] = A[n + 1][i] = P[i][0];
        A[i][n + 2] = A[n + 2][i] = P[i][1];
        B[i] = [T[i][0], T[i][1]];
    }
    const W = solve(A, B);
    if (!W) return null;

    return {
        mode: n === 3 ? 'affine' : 'tps',
        forward(u, v) {
            const [x, y] = np.to(u, v);
            let ox = W[n][0] + W[n + 1][0] * x + W[n + 2][0] * y;
            let oy = W[n][1] + W[n + 1][1] * x + W[n + 2][1] * y;
            for (let i = 0; i < n; i++) {
                const dx = x - P[i][0];
                const dy = y - P[i][1];
                const k = kernel(dx * dx + dy * dy);
                ox += W[i][0] * k;
                oy += W[i][1] * k;
            }
            return nt.from(ox, oy);
        },
    };
}

/**
 * @param base similarity used for the initial placement
 * @param anchors [{pixel: [u, v], target: [x, y]}] with targets in Mercator units
 */
export function solveTransform(base, anchors) {
    if (anchors.length === 0) return {...base, mode: 'placed'};
    if (anchors.length === 1) return {...translateBase(base, anchors[0]), mode: 'translate'};
    if (anchors.length === 2) {
        const [p, q] = anchors;
        const dp = sub(q.pixel, p.pixel);
        if (Math.hypot(dp[0], dp[1]) < 1e-6) return {...translateBase(base, p), mode: 'translate'};
        const a = cdiv(sub(q.target, p.target), dp);
        return similarity(a, sub(p.target, cmul(a, p.pixel)));
    }
    return fitTps(anchors) ?? fitSimilarity(base, anchors);
}
