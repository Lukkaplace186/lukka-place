import { declutterPins, orderForLabels } from './mapDeclutter';

/**
 * The /listings map's pins, as HTML over Google's map — one OverlayView
 * holding every pill, instead of one `google.maps.Marker` per listing with an
 * SVG image each (2026-09-23, "sleek map" pass). Why DOM:
 *
 * - the site's own font, crisp at any pixel ratio (the SVG images drew Arial);
 * - CSS transitions and an entrance (app/globals.css, `.lkp-pin`), so a pin
 *   that arrives with a new viewport fetch fades in instead of popping;
 * - measurable boxes, which is what lets lib/mapDeclutter.js shrink
 *   overlapping pills to dots — the fix for the stacked blue blob a city-wide
 *   view used to be;
 * - no Map ID needed (AdvancedMarkerElement would force one, and a Map ID
 *   would retire the JSON basemap style in lib/mapStyle.js);
 * - and it leaves `google.maps.Marker`, which Google has deprecated.
 *
 * Elements keep `role="button"` and `title` = the listing title, the handle
 * the live-site pin test uses (memory: map-pin-click-testing).
 *
 * Built by a factory because `google.maps.OverlayView` only exists once the
 * Maps JS API has loaded. Call only in the browser.
 *
 * @param {google.maps.Map} map
 * @param {{onClick: (pin) => void, onHover: (pin|null) => void}} handlers
 */
export function createPinLayer(map, handlers) {
  class PinLayer extends google.maps.OverlayView {
    constructor() {
      super();
      /** key -> { pin, el, labelEl, checkEl, width } */
      this.entries = new Map();
      this.activeId = null;
      this.visited = new Set();
      this.pageIds = new Set();
      this.labelZoom = null;
      this.me = null;
      this.meEl = null;
      this.container = null;
    }

    onAdd() {
      this.container = document.createElement('div');
      this.container.style.position = 'absolute';
      this.container.style.left = '0';
      this.container.style.top = '0';
      this.getPanes().overlayMouseTarget.appendChild(this.container);
      for (const entry of this.entries.values()) this.container.appendChild(entry.el);
      if (this.meEl) this.container.appendChild(this.meEl);
    }

    onRemove() {
      this.container?.remove();
      this.container = null;
    }

    draw() {
      const projection = this.getProjection();
      if (!projection) return;
      for (const entry of this.entries.values()) {
        const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(entry.pin.lat, entry.pin.lng));
        if (!point) continue;
        entry.x = point.x;
        entry.y = point.y;
        entry.el.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
      }
      if (this.meEl && this.me) {
        const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.me.lat, this.me.lng));
        if (point) this.meEl.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
      }
      const zoom = this.getMap()?.getZoom();
      if (zoom !== this.labelZoom) this.relabel();
    }

    /**
     * Replace the pin set. A pin whose key survives keeps its element, so a
     * pan never makes the whole map blink; a new one gets the entrance.
     *
     * @param {Array<{key: string, id: string|null, lat: number, lng: number,
     *   label: string, title: string, building: boolean, approximate: boolean,
     *   verified: boolean, zIndex: number, payload: any}>} pins
     */
    setPins(pins) {
      const previous = new Map(this.entries);
      const next = new Map();
      for (const pin of pins) {
        let entry = previous.get(pin.key);
        if (entry) {
          previous.delete(pin.key);
          if (entry.pin.label !== pin.label) {
            entry.labelEl.textContent = pin.label;
            entry.width = null;
          }
          if (entry.pin.verified !== pin.verified) this.#setCheck(entry, pin.verified);
          entry.pin = pin;
        } else {
          entry = this.#createEntry(pin);
          this.container?.appendChild(entry.el);
        }
        this.#applyState(entry);
        next.set(pin.key, entry);
      }
      for (const entry of previous.values()) entry.el.remove();
      this.entries = next;
      this.draw();
      this.relabel();
    }

    /** The pinned pin: highlighted, always labelled, above everything. */
    setActive(id) {
      const value = id == null ? null : String(id);
      if (value === this.activeId) return;
      this.activeId = value;
      for (const entry of this.entries.values()) this.#applyState(entry);
      this.relabel();
    }

    setVisited(ids) {
      this.visited = new Set([...ids].map(String));
      for (const entry of this.entries.values()) this.#applyState(entry);
    }

    /** Listings on the list page beside the map win label collisions. */
    setPageIds(ids) {
      this.pageIds = new Set([...ids].map(String));
      this.relabel();
    }

    setUserLocation(position) {
      this.me = position;
      if (!position) {
        this.meEl?.remove();
        this.meEl = null;
        return;
      }
      if (!this.meEl) {
        this.meEl = document.createElement('div');
        this.meEl.className = 'lkp-me';
        this.meEl.style.zIndex = '1';
        this.container?.appendChild(this.meEl);
      }
      this.draw();
    }

    /** Decide label vs dot for every pin at the current zoom. */
    relabel() {
      if (!this.container || !this.getProjection()) return;
      this.labelZoom = this.getMap()?.getZoom() ?? null;

      // Measure first (one layout for every unmeasured pill), then decide.
      const all = [...this.entries.values()];
      for (const entry of all) {
        if (entry.width == null) {
          const wasDot = entry.el.dataset.mode === 'dot';
          if (wasDot) entry.el.dataset.mode = 'label';
          entry.width = entry.body.offsetWidth || 48;
          if (wasDot) entry.el.dataset.mode = 'dot';
        }
      }

      const byId = new Map(all.map((entry) => [entry.pin.key, entry]));
      const ordered = orderForLabels(
        all.map((entry) => ({ id: entry.pin.key, listingId: entry.pin.id, approximate: entry.pin.approximate })),
        { pinnedId: this.#activeKey(), pageIds: this.#pageKeys() },
      );
      const labelled = declutterPins(
        ordered.map(({ id }) => {
          const entry = byId.get(id);
          return { id, x: entry.x, y: entry.y, w: entry.width, h: 24 };
        }),
        { always: this.#activeKey() },
      );
      for (const entry of all) {
        const mode = labelled.has(entry.pin.key) ? 'label' : 'dot';
        if (entry.el.dataset.mode !== mode) entry.el.dataset.mode = mode;
        this.#applyZ(entry);
      }
    }

    destroy() {
      for (const entry of this.entries.values()) entry.el.remove();
      this.entries = new Map();
      this.setMap(null);
    }

    #activeKey() {
      if (this.activeId == null) return null;
      for (const entry of this.entries.values()) {
        if (!entry.pin.building && entry.pin.id === this.activeId) return entry.pin.key;
      }
      return null;
    }

    #pageKeys() {
      const keys = new Set();
      for (const entry of this.entries.values()) {
        if (!entry.pin.building && this.pageIds.has(entry.pin.id)) keys.add(entry.pin.key);
      }
      return keys;
    }

    #createEntry(pin) {
      const el = document.createElement('div');
      el.className = 'lkp-pin is-new';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.title = pin.title || '';
      el.dataset.mode = 'label';
      const body = document.createElement('span');
      body.className = 'lkp-pin__body';
      const labelEl = document.createElement('span');
      labelEl.className = 'lkp-pin__label';
      labelEl.textContent = pin.label;
      body.appendChild(labelEl);
      el.appendChild(body);
      el.addEventListener('animationend', () => el.classList.remove('is-new'), { once: true });
      // Browsers that never run the animation (reduced motion) never fire
      // animationend; drop the class anyway so a later relabel cannot replay it.
      setTimeout(() => el.classList.remove('is-new'), 400);

      const entry = { pin, el, body, labelEl, checkEl: null, width: null, x: NaN, y: NaN };
      this.#setCheck(entry, pin.verified);

      // Clicks stop at the pin (the map's own click closes the preview), but
      // drags do not: on a phone a pan that starts on a pill still pans.
      google.maps.OverlayView.preventMapHitsFrom(el);
      el.addEventListener('click', () => handlers.onClick(entry.pin));
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handlers.onClick(entry.pin);
        }
      });
      el.addEventListener('mouseenter', () => handlers.onHover(entry.pin));
      el.addEventListener('mouseleave', () => handlers.onHover(null));
      return entry;
    }

    // "Vérifié par Lukka Place" (properties.verified_at): a small check in
    // the pill. Only a human verification sets it, so on today's data it is
    // rare, and that is what makes it mean something.
    #setCheck(entry, verified) {
      if (verified && !entry.checkEl) {
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('class', 'lkp-pin__check');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('fill', 'currentColor');
        path.setAttribute('d', 'M8 0.8l1.9 1.4 2.3-.1.8 2.2 1.9 1.3-.7 2.3.7 2.3-1.9 1.3-.8 2.2-2.3-.1L8 15.2l-1.9-1.4-2.3.1-.8-2.2-1.9-1.3.7-2.3-.7-2.3 1.9-1.3.8-2.2 2.3.1zM6.9 10.6l4.4-4.4-1-1-3.4 3.4-1.6-1.6-1 1z');
        svg.appendChild(path);
        entry.body.insertBefore(svg, entry.labelEl);
        entry.checkEl = svg;
        entry.width = null;
      } else if (!verified && entry.checkEl) {
        entry.checkEl.remove();
        entry.checkEl = null;
        entry.width = null;
      }
    }

    #applyState(entry) {
      const { pin, el } = entry;
      const active = !pin.building && pin.id != null && pin.id === this.activeId;
      const visited = !active && !pin.building && this.visited.has(pin.id);
      el.dataset.active = String(active);
      el.dataset.visited = String(visited);
      el.dataset.approximate = String(Boolean(pin.approximate));
      el.dataset.building = String(Boolean(pin.building));
      if (el.title !== (pin.title || '')) el.title = pin.title || '';
      this.#applyZ(entry);
    }

    // Stacking: the active pin over everything, labels over dots, and among
    // labels the higher price in front (the rule the SVG markers had).
    #applyZ(entry) {
      let z;
      if (entry.el.dataset.active === 'true') z = 3000000;
      else if (entry.el.dataset.mode === 'dot') z = 10;
      else z = 1000 + (entry.pin.zIndex || 0);
      const value = String(z);
      if (entry.el.style.zIndex !== value) entry.el.style.zIndex = value;
    }
  }

  const layer = new PinLayer();
  layer.setMap(map);
  return layer;
}
