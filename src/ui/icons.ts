import type { BuildingKind, Cost, ResKey } from '../game/config';

/**
 * Hand-built SVG icon set. Emoji render differently on every OS version and
 * read as placeholder art; these keep the HUD consistent and on-theme.
 * All icons use a 24×24 grid, flat fills and a dark outline.
 */
const O = 'stroke="#141510" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"';

const PATHS: Record<string, string> = {
  wood: `<rect x="2.5" y="12" width="16" height="6" rx="3" fill="#9a6435" ${O}/><circle cx="18.5" cy="15" r="3" fill="#e3b47c" ${O}/><circle cx="18.5" cy="15" r="1.1" fill="#a87442"/>
         <rect x="5.5" y="6" width="14" height="6" rx="3" fill="#b5773f" ${O}/><circle cx="19.5" cy="9" r="3" fill="#ecc28c" ${O}/><circle cx="19.5" cy="9" r="1.1" fill="#b07a45"/>`,
  scrap: `<circle cx="12" cy="12" r="7.6" fill="none" stroke="#141510" stroke-width="5.6" stroke-dasharray="3.2 2.4"/><circle cx="12" cy="12" r="7.6" fill="none" stroke="#a8b2ba" stroke-width="3.6" stroke-dasharray="3.2 2.4"/>
          <circle cx="12" cy="12" r="5.8" fill="#8d979f" ${O}/><circle cx="12" cy="12" r="2.2" fill="#2b2e2a" ${O}/>`,
  food: `<path d="M6 6.5v11c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-11" fill="#b9c0c4" ${O}/><path d="M6 9.5h12v6H6z" fill="#c4473a"/><path d="M6 9.5h12M6 15.5h12" stroke="#141510" stroke-width="1"/>
         <ellipse cx="12" cy="6.5" rx="6" ry="2.4" fill="#dfe4e6" ${O}/><path d="M9 12.5h6" stroke="#f2c94c" stroke-width="1.6" stroke-linecap="round"/>`,
  pop: `<circle cx="9" cy="8" r="3.2" fill="#e0b48a" ${O}/><path d="M3.5 19.5c0-3.6 2.4-6 5.5-6s5.5 2.4 5.5 6z" fill="#3f6ea8" ${O}/>
        <circle cx="16.5" cy="9" r="2.7" fill="#d29f74" ${O}/><path d="M13 19.5c.3-3 1.6-5 3.5-5 2.6 0 4.5 2 4.5 5z" fill="#4b6b3a" ${O}/>`,
  sun: `<g stroke="#f2c94c" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g><circle cx="12" cy="12" r="4.8" fill="#f6d465" ${O}/>`,
  dusk: `<path d="M3 16.5h18" stroke="#ff8a3a" stroke-width="2" stroke-linecap="round"/><path d="M6.5 16.5a5.5 5.5 0 0 1 11 0z" fill="#ff9a4a" ${O}/><path d="M5 20h14" stroke="#c4473a" stroke-width="2" stroke-linecap="round"/>`,
  moon: `<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.5 7 7 0 0 1-5-13.5z" fill="#cdd3ff" ${O}/><circle cx="10" cy="13" r="1.2" fill="#9aa2dd"/><circle cx="13" cy="17" r=".9" fill="#9aa2dd"/>`,
  hammer: `<path d="M10.5 9.5l8.5 8.5-2 2-8.5-8.5z" fill="#9a6435" ${O}/><path d="M4 7.5l5-5 3.5 3.5-2 2 1.5 1.5-2 2-1.5-1.5-2 2z" fill="#a8b2ba" ${O}/>`,
  worker: `<circle cx="12" cy="10" r="4" fill="#e0b48a" ${O}/><path d="M7.4 9a4.6 4.6 0 0 1 9.2 0z" fill="#f2c94c" ${O}/><path d="M6.5 9h11" stroke="#141510" stroke-width="1.4" stroke-linecap="round"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5z" fill="#3f6ea8" ${O}/>`,
  bolt: `<path d="M13.5 2.5L5 13.5h6l-1.5 8 9-11.5h-6z" fill="#f2c94c" ${O}/>`,
  home: `<path d="M3.5 11.5L12 4l8.5 7.5" fill="none" stroke="#141510" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 11.5L12 4l8.5 7.5" fill="none" stroke="#e5483a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
         <path d="M6 11v9h12v-9" fill="#6a6f60" ${O}/><path d="M10 20v-5h4v5" fill="#f2c94c" ${O}/>`,
  play: `<path d="M8 5.5v13l10.5-6.5z" fill="#ece6d6" ${O}/>`,
  fast: `<path d="M3.5 6v12l8.5-6zM12 6v12l8.5-6z" fill="#f2c94c" ${O}/>`,
  pause: `<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="#ece6d6" ${O}/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="#ece6d6" ${O}/>`,
  menu: `<path d="M5 7h14M5 12h14M5 17h14" stroke="#ece6d6" stroke-width="2.2" stroke-linecap="round"/>`,
  wall: `<g fill="#8a5d33" ${O}><path d="M3 21V7l2-2.5L7 7v14zM8.5 21V6l2-2.5 2 2.5v15zM14 21V7l2-2.5L18 7v14z"/></g><path d="M2 11.5h18M2 16.5h18" stroke="#141510" stroke-width="3.4"/><path d="M2 11.5h18M2 16.5h18" stroke="#5a3a1c" stroke-width="1.8"/><path d="M19.5 21V8l1.5-1.5" fill="none" stroke="#141510" stroke-width="1.4"/>`,
  steelwall: `<rect x="2.5" y="5" width="19" height="15" rx="1" fill="#7d848a" ${O}/><path d="M2.5 10h19M2.5 15h19M8 5v5M16 5v5M12 10v5M6 15v5M17 15v5" stroke="#141510" stroke-width="1.2"/>
              <g fill="#c9cfd3"><circle cx="5" cy="7.5" r=".8"/><circle cx="19" cy="7.5" r=".8"/><circle cx="9.5" cy="12.5" r=".8"/><circle cx="14.5" cy="12.5" r=".8"/></g>`,
  tower: `<path d="M7 21l2-10h6l2 10" fill="none" stroke="#141510" stroke-width="3"/><path d="M7 21l2-10h6l2 10M9.5 15h5" fill="none" stroke="#7a5530" stroke-width="1.6"/>
          <rect x="5.5" y="7.5" width="13" height="4" fill="#86603a" ${O}/><path d="M4.5 7.5L12 2.5l7.5 5z" fill="#4b6b3a" ${O}/><path d="M18 9.5l4-1.5" stroke="#141510" stroke-width="1.8" stroke-linecap="round"/>`,
  house: `<path d="M5 11v9.5h14V11" fill="#8a6440" ${O}/><path d="M2.5 12L12 3.5l9.5 8.5z" fill="#b2462f" ${O}/><rect x="10" y="14.5" width="4" height="6" fill="#3a2614" ${O}/>
          <rect x="6.5" y="13" width="2.5" height="2.5" fill="#ffcf5a" ${O}/><rect x="15" y="13" width="2.5" height="2.5" fill="#ffcf5a" ${O}/><rect x="15.5" y="4.5" width="2" height="4" fill="#5a5f52" ${O}/>`,
  farm: `<path d="M12 21.5V9" stroke="#4a7a2a" stroke-width="2" stroke-linecap="round"/><path d="M12 14c-3.5 0-6-2-6.5-5 3.2 0 5.5 1.5 6.5 5zM12 17c3.5 0 6-2 6.5-5-3.2 0-5.5 1.5-6.5 5z" fill="#7fb24a" ${O}/>
         <path d="M12 2.5c-2 1.5-2.5 4.5 0 7 2.5-2.5 2-5.5 0-7z" fill="#f2c94c" ${O}/>`,
  barracks: `<path d="M2 20.5L12 4l10 16.5z" fill="#5f6b3e" ${O}/><path d="M12 4v16.5" stroke="#141510" stroke-width="1.2"/><path d="M12 20.5l-3-6h6z" fill="#2b2e22" ${O}/><path d="M12 4l7 11.5" stroke="#4f5a34" stroke-width="1.4"/>
             <path d="M17 7.5l.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z" fill="#f2c94c"/>`,
  trap: `<path d="M2.5 19.5h19" stroke="#141510" stroke-width="3.2" stroke-linecap="round"/><path d="M2.5 19.5h19" stroke="#5a5040" stroke-width="1.6" stroke-linecap="round"/>
         <g fill="#c9cfd3" ${O}><path d="M4 19l2-8 2 8zM10 19l2-11 2 11zM16 19l2-8 2 8z"/></g>`,
  axe: `<path d="M14.5 4.5L5 20" stroke="#141510" stroke-width="3.6" stroke-linecap="round"/><path d="M14.5 4.5L5 20" stroke="#9a6435" stroke-width="2" stroke-linecap="round"/><path d="M12 3.5c3-1.5 7-.5 8.5 3l-4.5 2.5z" fill="#c9cfd3" ${O}/>`,
  wrench: `<path d="M14.5 3.5a5 5 0 0 0-5 6.3L3.5 15.8a2 2 0 0 0 2.8 2.8l6-6A5 5 0 0 0 19 7.5l-3 3-2.5-.5-.5-2.5 3-3a5 5 0 0 0-1.5-1z" fill="#a8b2ba" ${O}/>`,
  crate: `<path d="M3.5 8.5L12 4.5l8.5 4v9l-8.5 4-8.5-4z" fill="#a87a42" ${O}/><path d="M3.5 8.5l8.5 4 8.5-4M12 12.5v9" fill="none" ${O}/><path d="M7.5 6.5l8.5 4v4" fill="none" stroke="#e8d9b0" stroke-width="1.6"/>`,
  blast: `<path d="M12 1.5l2.2 5.6 5.6-2.4-2.4 5.6 5.1 1.7-5.1 1.7 2.4 5.6-5.6-2.4L12 22.5l-2.2-5.6-5.6 2.4 2.4-5.6L1.5 12l5.1-1.7-2.4-5.6 5.6 2.4z" fill="#ff8a3a" ${O}/><circle cx="12" cy="12" r="4" fill="#ffe08a"/>`,
  medal: `<path d="M7 2.5h4l2 6h-4zM17 2.5h-4l-2 6h4z" fill="#c4473a" ${O}/><circle cx="12" cy="15" r="6" fill="#f2c94c" ${O}/><path d="M12 11.5l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="#b8901f"/>`,
  target: `<circle cx="12" cy="12" r="9" fill="#c4473a" ${O}/><circle cx="12" cy="12" r="6" fill="#ece6d6"/><circle cx="12" cy="12" r="3" fill="#c4473a"/>`,
  lock: `<path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#141510" stroke-width="3.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="#a8b2ba" stroke-width="1.8"/><rect x="5.5" y="10.5" width="13" height="10" rx="2" fill="#f2c94c" ${O}/>`,
  gun: `<path d="M2.5 9.5h15l1-1.5h3v3.5h-3l-3 1h-4l-2 6h-4l2-6h-5z" fill="#3a3d36" ${O}/><path d="M6 9.5V8h3v1.5" fill="#6b4a2a" ${O}/>`,
  idle: `<circle cx="12" cy="7" r="3.5" fill="#e0b48a" ${O}/><path d="M7 21v-6c0-2.5 2-4.5 5-4.5s5 2 5 4.5v6z" fill="#8d8a7c" ${O}/>`,
  ruin: `<path d="M3 21V8l4-3v5l3-2v13zM12 21V11l3-1v-3l6 3v11z" fill="#6e6a62" ${O}/><path d="M5 12h2M5 16h2M15 14h2M15 18h3" stroke="#2b2925" stroke-width="1.6"/>`,
  repair: `<path d="M14.5 3.5a5 5 0 0 0-5 6.3L3.5 15.8a2 2 0 0 0 2.8 2.8l6-6A5 5 0 0 0 19 7.5l-3 3-2.5-.5-.5-2.5 3-3a5 5 0 0 0-1.5-1z" fill="#7fcf6b" ${O}/>`,
  upgrade: `<path d="M12 3l7.5 8H15v9H9v-9H4.5z" fill="#7fcf6b" ${O}/>`,
  skull: `<path d="M12 3c-4.7 0-8 3-8 7 0 2.5 1.3 4.2 3 5v3h10v-3c1.7-.8 3-2.5 3-5 0-4-3.3-7-8-7z" fill="#ece6d6" ${O}/><circle cx="9" cy="10.5" r="2" fill="#141510"/><circle cx="15" cy="10.5" r="2" fill="#141510"/><path d="M10 18v2.5M14 18v2.5M12 13l-1 2h2z" stroke="#141510" stroke-width="1.2" fill="#141510"/>`,
  zombie: `<circle cx="12" cy="9" r="5.5" fill="#6b8f4e" ${O}/><circle cx="9.8" cy="8.5" r="1.1" fill="#ffdf5a"/><circle cx="14.2" cy="8.5" r="1.1" fill="#ffdf5a"/><path d="M9.5 12h5" stroke="#141510" stroke-width="1.2"/><path d="M5 21c0-4 3-6 7-6s7 2 7 6z" fill="#4e5a3e" ${O}/>`,
  shield: `<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" fill="#4b6b3a" ${O}/><path d="M12 6l4.5 1.7v4c0 3-2 5.2-4.5 6.2z" fill="#7fb24a"/>`,
};

export function ico(name: string, cls = ''): string {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}

export const RES_ICO: Record<ResKey, string> = { wood: 'wood', scrap: 'scrap', food: 'food' };

export const BUILDING_ICO: Record<BuildingKind, string> = {
  hq: 'home', house: 'house', farm: 'farm', wall: 'wall', steelwall: 'steelwall', tower: 'tower', barracks: 'barracks', trap: 'trap',
};

export function costHtml(cost: Cost): string {
  return (Object.keys(cost) as ResKey[]).map((k) => `<span class="c">${ico(RES_ICO[k])}${cost[k]}</span>`).join('');
}
