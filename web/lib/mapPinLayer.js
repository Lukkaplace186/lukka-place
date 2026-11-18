/**
 * The /listings map's pins, as HTML over Google's map — one OverlayView
 * holding every pill, instead of one `google.maps.Marker` per listing with an
 * SVG image each (2026-09-23, "sleek map" pass). Why DOM:
 *
 * - the site's own font, crisp at any pixel ratio (the SVG images drew Arial);
 * - CSS transitions and an entrance (app/globals.css, `.lkp-pin`), so a pin
 *   that arrives with a new viewport fetch fades in instead of popping;
 * - no Map ID needed (AdvancedMarkerElement would force one, and a Map ID
 *   would retire the JSON basemap style in lib/mapStyle.js);
 * - and it leaves `google.maps.Marker`, which Google has deprecated.
 *
 * **Every listing shows its price, always.** A first version shrank
 * overlapping pills to dots (2026-09-23); it was removed the same day on
 * product direction — a dot said nothing to a visitor. Overlap is handled the
 * way the reference portals handle it: speech-bubble pills whose stem points
 * at the coordinate, a shadow that keeps stacked pills distinct, and
 * predictable stacking (higher price in front, the active pin above all).
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
      this.me = null;
      this.meEl = null;
      this.container = null;
    }

    onAdd() {
      this.container = document.createElement('div');
      this.container.className = 'lkp-layer';
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
    }

    /**
     * Replace the pin set. A pin whose key survives keeps its element, so a
     * pan never makes the whole map blink; a new one gets the entrance.
     *
     * @param {Array<{key: string, id: string|null, lat: number, lng: number,
     *   label: string, title: string, building: boolean,
     *   verified: boolean, zIndex: number, payload: any}>} pins
     */
    setPins(pins) {
      const previous = new Map(this.entries);
      const next = new Map();
      let arriving = 0;
      for (const pin of pins) {
        let entry = previous.get(pin.key);
        if (entry) {
          previous.delete(pin.key);
          if (entry.pin.label !== pin.label) entry.labelEl.textContent = pin.label;
          if (entry.pin.verified !== pin.verified) this.#setCheck(entry, pin.verified);
          entry.pin = pin;
        } else {
          // New pins drop in one after another, 28ms apart (capped), rather
          // than all popping at once when a new area loads.
          entry = this.#createEntry(pin, Math.min(arriving * 28, 420));
          arriving += 1;
          this.container?.appendChild(entry.el);
        }
        this.#applyState(entry);
        next.set(pin.key, entry);
      }
      for (const entry of previous.values()) entry.el.remove();
      this.entries = next;
      this.draw();
    }

    /** The active pin (hovered card, or the open preview): highlighted, above everything. */
    setActive(id) {
      const value = id == null ? null : String(id);
      if (value === this.activeId) return;
      this.activeId = value;
      for (const entry of this.entries.values()) {
        const wasActive = entry.el.dataset.active === 'true';
        this.#applyState(entry);
        // A small hop when a pin becomes the active one — a hovered card on
        // desktop, a swiped card on a phone — so the eye finds it.
        if (!wasActive && entry.el.dataset.active === 'true') this.#bounce(entry.el);
      }
    }

    #bounce(el) {
      el.classList.remove('is-bounce');
      // Restart the animation even if a bounce is still running.
      void el.offsetWidth;
      el.classList.add('is-bounce');
      el.addEventListener('animationend', () => el.classList.remove('is-bounce'), { once: true });
    }

    setVisited(ids) {
      this.visited = new Set([...ids].map(String));
      for (const entry of this.entries.values()) this.#applyState(entry);
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

    /** Where a listing's pin is drawn (its jittered/fanned point), or null. */
    positionOf(id) {
      const value = String(id);
      for (const entry of this.entries.values()) {
        if (!entry.pin.building && entry.pin.id === value) return { lat: entry.pin.lat, lng: entry.pin.lng };
      }
      return null;
    }

    destroy() {
      for (const entry of this.entries.values()) entry.el.remove();
      this.entries = new Map();
      this.setMap(null);
    }

    #createEntry(pin, delayMs = 0) {
      const el = document.createElement('div');
      el.className = 'lkp-pin is-new';
      el.style.setProperty('--lkp-delay', `${delayMs}ms`);
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.title = pin.title || '';
      const body = document.createElement('span');
      body.className = 'lkp-pin__body';
      const labelEl = document.createElement('span');
      labelEl.className = 'lkp-pin__label';
      labelEl.textContent = pin.label;
      body.appendChild(labelEl);
      el.appendChild(body);
      // Dropped once the entrance is over (a timer, not animationend: reduced
      // motion runs no animation and would never fire it).
      setTimeout(() => el.classList.remove('is-new'), delayMs + 450);

      const entry = { pin, el, body, labelEl, checkEl: null };
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
      } else if (!verified && entry.checkEl) {
        entry.checkEl.remove();
        entry.checkEl = null;
      }
    }

    #applyState(entry) {
      const { pin, el } = entry;
      const active = !pin.building && pin.id != null && pin.id === this.activeId;
      const visited = !active && !pin.building && this.visited.has(pin.id);
      el.dataset.active = String(active);
      el.dataset.visited = String(visited);
      el.dataset.building = String(Boolean(pin.building));
      if (el.title !== (pin.title || '')) el.title = pin.title || '';
      this.#applyZ(entry);
    }

    // Stacking: the active pin over everything, then the higher price in
    // front (the rule the SVG markers had).
    #applyZ(entry) {
      const z = entry.el.dataset.active === 'true' ? 3000000 : 1000 + (entry.pin.zIndex || 0);
      const value = String(z);
      if (entry.el.style.zIndex !== value) entry.el.style.zIndex = value;
    }
  }

  const layer = new PinLayer();
  layer.setMap(map);
  return layer;
}
