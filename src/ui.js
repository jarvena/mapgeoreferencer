const MODE_LABELS = {
    placed: 'initial placement',
    translate: 'translate',
    similarity: 'similarity (scale + rotation)',
    affine: 'affine',
    tps: 'thin plate spline',
};

export function createPanel(container, {opacity, onOpacity, onClear, onExport}) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
        <p class="hint">Drop a map image onto the page</p>
        <div class="controls" hidden>
            <label title="Image opacity while not dragging">Opacity <input type="range" class="static" min="0" max="1" step="0.01" value="${opacity.static}"></label>
            <label title="Image opacity while dragging an anchor">Dragging <input type="range" class="dynamic" min="0" max="1" step="0.01" value="${opacity.dynamic}"></label>
            <p class="status"></p>
            <div class="buttons">
                <button type="button" class="clear">Clear anchors</button>
                <button type="button" class="export" title="PNG + .pgw world file in EPSG:3857 (Web Mercator). With more than 2 anchors the image is resampled north-up.">Export PNG</button>
            </div>
        </div>`;
    container.appendChild(panel);

    const hint = panel.querySelector('.hint');
    const controls = panel.querySelector('.controls');
    const status = panel.querySelector('.status');
    const clear = panel.querySelector('.clear');
    const exportButton = panel.querySelector('.export');
    for (const state of ['static', 'dynamic']) {
        panel.querySelector(`input.${state}`).addEventListener('input', (e) => onOpacity(state, Number(e.target.value)));
    }
    clear.addEventListener('click', onClear);
    exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        exportButton.textContent = 'Exporting…';
        try {
            await onExport();
        } catch (err) {
            console.error(err);
            alert(`Export failed: ${err.message}`);
        } finally {
            exportButton.disabled = false;
            exportButton.textContent = 'Export PNG';
        }
    });

    return {
        update(anchors) {
            controls.hidden = false;
            hint.textContent = 'Drag on the image to add anchors · Space+drag to pan · right-click an anchor to delete';
            const n = anchors.anchors.length;
            status.textContent = `${n} anchor${n === 1 ? '' : 's'} · ${MODE_LABELS[anchors.mode] ?? anchors.mode}`;
            clear.disabled = n === 0;
        },
    };
}
