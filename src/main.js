import {Map, setWorkerUrl} from 'maplibre-gl';
import './style.css'
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {ImageLayer} from './imageLayer.js';
import {Anchors} from './anchors.js';
import {setupDrop, loadImageFile, initialPlacement} from './dropImage.js';
import {createPanel} from './ui.js';
import {exportGeoreferenced} from './exportImage.js';

setWorkerUrl(workerUrl);

const map = new Map({
    container: 'map', // container id
    style: {
        version: 8,
        projection: {type: 'mercator'},
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
            // Finnish Mapant; tiles are only requested within Finland's bounds.
            mapantFi: {
                type: 'raster',
                tiles: ['https://wmts.mapant.fi/wmts_EPSG3857.php?z={z}&y={y}&x={x}'],
                tileSize: 256,
                bounds: [19.0, 59.7, 31.7, 70.2],
                minzoom: 5,
                attribution: '&copy; <a href="https://mapant.fi">Mapant.fi</a>',
            },
            mapant: {
                type: 'raster',
                tiles: ['https://jarvena.github.io/smkeskaripullautus/{z}/{x}/{y}.png'],
                tileSize: 256,
            }
        },
        layers: [{id: 'osm', type: 'raster', source: 'osm'}, {id: 'mapantFi', type: 'raster', source: 'mapantFi'}, {id: 'mapant', type: 'raster', source: 'mapant'}],
    },
    center: [0, 0], // starting position [lng, lat]
    zoom: 1 // starting zoom
});

map.on('load', () => {
    const layer = new ImageLayer();
    map.addLayer(layer);

    // Separate image opacities for the static view and while an anchor is dragged.
    const opacity = {static: 1, dynamic: 0.5};
    let dragging = false;
    const applyOpacity = () => layer.setOpacity(dragging ? opacity.dynamic : opacity.static);
    applyOpacity();

    const anchors = new Anchors(map, layer, (a) => panel.update(a), (active) => {
        dragging = active;
        applyOpacity();
    });
    const panel = createPanel(document.body, {
        opacity,
        onOpacity: (state, value) => {
            opacity[state] = value;
            applyOpacity();
        },
        onClear: () => anchors.clear(),
        onExport: () => exportGeoreferenced(file, layer.image.source, anchors),
        onOpenFiles: (files) => loadImageFile(files, onImage),
    });

    let file = null;

    async function onImage(bitmap, imageFile) {
        file = imageFile;
        await layer.setImage(bitmap);
        anchors.reset(initialPlacement(map, bitmap.width, bitmap.height));
    }

    setupDrop(document.body, onImage);
});
