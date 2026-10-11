import {Marker, MercatorCoordinate} from 'maplibre-gl';
import {similarity, solveTransform} from './transform.js';

// Anchors tie an image pixel to a Mercator target; dragging them warps the image.
export class Anchors {
    constructor(map, layer, onChange = () => {}, onDrag = () => {}) {
        this.map = map;
        this.layer = layer;
        this.onChange = onChange;
        this.onDrag = onDrag; // called with true/false when an anchor drag starts/ends
        this.anchors = [];
        this.base = null;
        this.selected = null;
        this.mode = null;
        this.spaceDown = false;

        map.on('mousedown', (e) => this.onMouseDown(e));
        map.on('mousemove', (e) => this.updateCursor(e));
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') this.spaceDown = false;
        });
        window.addEventListener('blur', () => { this.spaceDown = false; });
    }

    reset(base) {
        for (const anchor of this.anchors) anchor.marker.remove();
        this.anchors = [];
        this.selected = null;
        this.base = base;
        this.update();
    }

    clear() {
        if (this.base) this.reset(this.base);
    }

    update() {
        const transform = solveTransform(this.base, this.anchors);
        // Remember the latest similarity so removing anchors keeps scale and rotation.
        if (transform.a) this.base = similarity(transform.a, transform.b);
        this.transform = transform;
        this.mode = transform.mode;
        this.layer.setTransform(transform);
        this.anchors.forEach((anchor, i) => {
            anchor.marker.getElement().textContent = String(i + 1);
            anchor.marker.getElement().classList.toggle('selected', anchor === this.selected);
        });
        this.onChange(this);
    }

    add(pixel, target) {
        const el = document.createElement('div');
        el.className = 'anchor-marker';
        const marker = new Marker({element: el, draggable: true})
            .setLngLat(new MercatorCoordinate(...target).toLngLat())
            .addTo(this.map);
        const anchor = {pixel, target, marker};

        // Tapping an anchor (touch, without dragging it) deletes it.
        let tap = null;
        el.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            tap = e.touches.length === 1 ? {x: t.clientX, y: t.clientY} : null;
        }, {passive: true});
        el.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            if (tap && Math.hypot(t.clientX - tap.x, t.clientY - tap.y) < 10) {
                e.preventDefault(); // no emulated mouse events / click
                this.remove(anchor);
            }
            tap = null;
        });

        marker.on('dragstart', () => {
            tap = null;
            this.select(anchor);
            this.onDrag(true);
        });
        marker.on('dragend', () => this.onDrag(false));
        marker.on('drag', () => {
            const m = MercatorCoordinate.fromLngLat(marker.getLngLat());
            anchor.target = [m.x, m.y];
            this.update();
        });
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) this.select(anchor);
        });
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.remove(anchor);
        });

        this.anchors.push(anchor);
        this.selected = anchor;
        this.update();
        return anchor;
    }

    remove(anchor) {
        anchor.marker.remove();
        this.anchors = this.anchors.filter(a => a !== anchor);
        if (this.selected === anchor) this.selected = this.anchors.at(-1) ?? null;
        this.update();
    }

    select(anchor) {
        this.selected = anchor;
        this.update();
    }

    imagePixelAt(lngLat) {
        if (!this.base) return null;
        const m = MercatorCoordinate.fromLngLat(lngLat);
        return this.layer.pixelAt(m.x, m.y);
    }

    onMouseDown(e) {
        // Marker presses bubble up to the map too; only presses on the canvas create anchors.
        if (this.spaceDown || e.originalEvent.button !== 0 || e.originalEvent.target !== this.map.getCanvas()) return;
        const pixel = this.imagePixelAt(e.lngLat);
        if (!pixel) return;
        e.preventDefault(); // stop drag-pan

        const m = MercatorCoordinate.fromLngLat(e.lngLat);
        const anchor = this.add(pixel, [m.x, m.y]);
        this.onDrag(true);
        const canvas = this.map.getCanvasContainer();

        const onMove = (ev) => {
            const rect = canvas.getBoundingClientRect();
            const lngLat = this.map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
            const t = MercatorCoordinate.fromLngLat(lngLat);
            anchor.target = [t.x, t.y];
            anchor.marker.setLngLat(lngLat);
            this.update();
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            this.onDrag(false);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    updateCursor(e) {
        const overImage = !this.spaceDown && this.imagePixelAt(e.lngLat);
        this.map.getCanvas().style.cursor = overImage ? 'crosshair' : '';
    }

    onKeyDown(e) {
        if (e.target instanceof HTMLInputElement) return;
        if (e.code === 'Space') {
            this.spaceDown = true;
            this.map.getCanvas().style.cursor = '';
            e.preventDefault();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
            this.remove(this.selected);
            e.preventDefault();
        }
    }
}
