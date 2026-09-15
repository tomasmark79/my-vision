/* 
Copyright (C) 2024 Christophe Van den Abbeele, Tomáš Mark

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import GLib from 'gi://GLib';
import {ConfigIndex, matchesMonitorsConfig} from './config.js';

export const CONFIG_TYPE = '(sua(iiduba(ssa{sv}))a{sv}a(ss))';
export const LID_STATES = ['any', 'open', 'closed'];
export const unpack = value => {
    if (value instanceof GLib.Variant)
        return unpack(value.recursiveUnpack());
    if (Array.isArray(value))
        return value.map(unpack);
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, unpack(value[key])]));
    return value;
};
const stable = value => JSON.stringify(unpack(value));
const sorted = values => [...values].sort((a, b) => stable(a).localeCompare(stable(b)));

export function displayRecord(display) {
    return {connector: display.id[0], name: display.displayName,
        vendor: display.id[1] || '', product: display.id[2] || '', serial: display.id[3] || '',
        builtin: display.builtin === true};
}
export function displayIdentity(display) {
    if (display.builtin)
        return ['builtin', display.vendor, display.product, display.serial];
    if (display.vendor || display.product || display.serial)
        return ['hardware', display.vendor, display.product, display.serial];
    return ['legacy', display.name];
}
const hasIdentity = d => Boolean(d.vendor || d.product || d.serial || d.builtin);
const sameDisplay = (a, b) => hasIdentity(a) && hasIdentity(b)
    ? stable(displayIdentity(a)) === stable(displayIdentity(b))
    : Boolean(a.name) && a.name === b.name;

// One-to-one matching: never select the first of multiple identical candidates.
export function mapDisplays(saved, current) {
    const result = new Map();
    const used = new Set();
    for (const display of saved) {
        const candidates = current.filter(candidate => sameDisplay(display, candidate));
        if (candidates.length !== 1 || used.has(candidates[0].connector))
            throw new Error(`Monitor “${display.name}” is missing or cannot be identified uniquely`);
        result.set(display.connector, candidates[0].connector);
        used.add(candidates[0].connector);
    }
    return result;
}
export function remapLogical(logical, mapping) {
    return logical.map(m => [...m.slice(0, 5), m[5].map(([connector, mode, props]) => {
        if (!mapping.has(connector))
            throw new Error(`Unknown monitor ${connector}`);
        return [mapping.get(connector), mode, {...props}];
    })]);
}
function canonicalLogical(logical) {
    return sorted(logical.map(m => [...m.slice(0, 5), sorted(m[5])]));
}
export function sameConfiguration(a, b) {
    if (a.displays.length !== b.displays.length)
        return false;
    try {
        const logical = remapLogical(a.config[2], mapDisplays(a.displays, b.displays));
        return stable(canonicalLogical(logical)) === stable(canonicalLogical(b.config[2])) &&
            stable(a.config[3]) === stable(b.config[3]);
    } catch {
        return false;
    }
}
export function duplicateProfile(a, b) {
    return a.lid === b.lid && sameConfiguration(a, b);
}
export function contextKey(displays, lid) {
    return stable([lid, sorted(displays.map(displayIdentity))]);
}
export function profileLabel(profile) {
    const label = {any: 'any lid state', open: 'lid open', closed: 'lid closed'}[profile.lid];
    return `${profile.config[0]} · ${label}`;
}
export function profileRequest(profile, displays, lid) {
    if (lid === 'unknown')
        throw new Error('Waiting for the laptop lid state');
    if (profile.lid !== 'any' && profile.lid !== lid)
        throw new Error('This profile is saved for a different lid state');
    const logical = remapLogical(profile.config[2], mapDisplays(profile.displays, displays.map(displayRecord)));
    if (logical.length === 0)
        throw new Error('The profile does not enable any monitors');
    for (const monitor of logical) {
        for (const [connector, mode, props] of monitor[5]) {
            const display = displays.find(d => d.id[0] === connector);
            if (lid === 'closed' && display.builtin)
                throw new Error('Open the laptop lid to use this profile');
            const supported = display.modes.find(m => m[0] === mode);
            if (!supported || !supported[5].some(scale => Math.abs(scale - monitor[2]) < 0.000001))
                throw new Error(`The saved resolution, refresh rate or scale is unavailable on ${display.displayName}`);
            const color = unpack(props['color-mode']);
            if (color !== undefined && display.supportedColorModes && !display.supportedColorModes.includes(color))
                throw new Error(`The saved color mode is unavailable on ${display.displayName}`);
        }
    }
    return logical;
}
export function activeProfile(profile, displays, lid, currentConfig) {
    try {
        return matchesMonitorsConfig(profileRequest(profile, displays, lid), profile.config[3], currentConfig);
    } catch {
        return false;
    }
}
export function selectProfile(profiles, lastId, legacyId, lid, isActive) {
    return profiles.find(p => p.id === lastId) ??
        profiles.find(p => p.lid === lid && isActive(p)) ??
        profiles.find(p => p.lid === lid) ??
        profiles.find(p => p.id === legacyId) ??
        profiles.find(isActive) ?? profiles[0] ?? null;
}

export class ProfileStore {
    constructor(settings) {
        this.settings = settings;
        this.reload();
    }
    reload() {
        const json = this.settings.get_string('profiles-v2');
        if (json) {
            const data = JSON.parse(json);
            if (data.version !== 2 || !Array.isArray(data.profiles))
                throw new Error('Unsupported My Vision profile format');
            this.profiles = data.profiles.map(p => {
                if (!p.id || !LID_STATES.includes(p.lid) || !Array.isArray(p.displays))
                    throw new Error('Invalid My Vision profile');
                return {...p, config: GLib.Variant.parse(new GLib.VariantType(CONFIG_TYPE), p.config, null, null).deepUnpack()};
            });
            this.last = data.last ?? {};
            this.legacyId = data.legacyId ?? null;
        } else {
            // Legacy keys remain untouched, including the original selection.
            this.profiles = this.settings.get_value('configs').deepUnpack().map(config => ({
                id: GLib.uuid_string_random(), lid: 'any', config,
                displays: config[ConfigIndex.PHYSICAL_DISPLAYS].map(([connector, name]) =>
                    ({connector, name, vendor: '', product: '', serial: '', builtin: false})),
            }));
            this.last = {};
            this.legacyId = this.profiles[this.settings.get_uint('last-config-index')]?.id ?? null;
            this.save();
        }
    }
    save() {
        const profiles = this.profiles.map(p => ({...p, config: new GLib.Variant(CONFIG_TYPE, p.config).print(true)}));
        this.settings.set_string('profiles-v2', JSON.stringify({version: 2, profiles, last: this.last, legacyId: this.legacyId}));
    }
    enrich(displays) {
        const current = displays.map(displayRecord);
        let changed = false;
        for (const p of this.profiles) {
            for (const d of p.displays) {
                if (hasIdentity(d))
                    continue;
                const candidates = current.filter(c => sameDisplay(d, c));
                if (candidates.length === 1) {
                    Object.assign(d, {...candidates[0], connector: d.connector});
                    changed = true;
                }
            }
        }
        if (changed)
            this.save();
    }
    remember(key, id) {
        if (this.last[key] !== id) {
            this.last[key] = id;
            this.save();
        }
    }
    add(profile) {
        const existing = this.profiles.find(p => duplicateProfile(p, profile));
        if (existing)
            return existing; // An accidental duplicate must not rename or overwrite anything.
        this.profiles.push(profile);
        this.save();
        return profile;
    }
    remove(id) {
        this.profiles = this.profiles.filter(p => p.id !== id);
        this.last = Object.fromEntries(Object.entries(this.last).filter(([, value]) => value !== id));
        if (this.legacyId === id)
            this.legacyId = null;
        this.save();
    }
    setLid(id, lid) {
        const profile = this.profiles.find(p => p.id === id);
        if (!profile || !LID_STATES.includes(lid))
            return false;
        if (this.profiles.some(p => p.id !== id && duplicateProfile(p, {...profile, lid})))
            return false;
        profile.lid = lid;
        this.save();
        return true;
    }
}
