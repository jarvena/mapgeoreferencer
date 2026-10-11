const MODE_LABELS = {
    placed: 'initial placement',
    translate: 'translate',
    similarity: 'similarity (scale + rotation)',
    affine: 'affine',
    tps: 'thin plate spline',
};

export function createPanel(container, {opacity, onOpacity, onClear, onExport, onOpenFiles}) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
        <div class="header">
            <button type="button" class="open" title="Or drop an image file onto the page">Open map image…</button>
            <button type="button" class="collapse" title="Hide controls" aria-expanded="true" hidden>▴</button>
        </div>
        <input type="file" class="file" accept="image/*" hidden>
        <div class="body">
        <p class="hint" hidden></p>
        <div class="controls" hidden>
            <label title="Image opacity while not dragging">Opacity <input type="range" class="static" min="0" max="1" step="0.01" value="${opacity.static}"></label>
            <label title="Image opacity while dragging an anchor">Dragging <input type="range" class="dynamic" min="0" max="1" step="0.01" value="${opacity.dynamic}"></label>
            <p class="status"></p>
            <div class="buttons">
                <button type="button" class="clear">Clear anchors</button>
                <button type="button" class="export" title="PNG + .pgw world file in EPSG:3857 (Web Mercator). With more than 2 anchors the image is resampled north-up.">Export PNG</button>
            </div>
        </div>
        </div>`;
    container.appendChild(panel);

    const hint = panel.querySelector('.hint');
    const controls = panel.querySelector('.controls');
    const status = panel.querySelector('.status');
    const clear = panel.querySelector('.clear');
    const exportButton = panel.querySelector('.export');
    const openButton = panel.querySelector('.open');
    const fileInput = panel.querySelector('.file');
    const collapse = panel.querySelector('.collapse');
    collapse.addEventListener('click', () => {
        const collapsed = panel.classList.toggle('collapsed');
        collapse.textContent = collapsed ? '▾' : '▴';
        collapse.title = collapsed ? 'Show controls' : 'Hide controls';
        collapse.setAttribute('aria-expanded', String(!collapsed));
    });
    openButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        onOpenFiles(fileInput.files);
        fileInput.value = '';
    });
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
            hint.hidden = false;
            collapse.hidden = false;
            openButton.textContent = 'Open another image…';
            hint.textContent = 'Drag on the image to add anchors · Space+drag to pan · right-click or tap an anchor to delete';
            const n = anchors.anchors.length;
            status.textContent = `${n} anchor${n === 1 ? '' : 's'} · ${MODE_LABELS[anchors.mode] ?? anchors.mode}`;
            clear.disabled = n === 0;
        },
    };
}
