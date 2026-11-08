// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import { CONFIG_TYPE, LID_STATES, duplicateProfile } from './profiles.js';

const FORMAT = 'my-vision-profiles';
const VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_PROFILES = 1000;
const encoder = new TextEncoder();

function requireValid(condition, message) {
    if (!condition)
        throw new Error(`Invalid My Vision profile backup: ${message}`);
}

function string(value, label, allowEmpty = false) {
    requireValid(typeof value === 'string' && value.length <= 4096 && !value.includes('\0') && (allowEmpty || value.trim().length > 0), label);
}

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function propertyType(properties, name, type) {
    const value = properties[name];
    if (value !== undefined)
        requireValid(value.get_type_string() === type, `invalid ${name} property type`);
}

function parseProfile(profile, ids) {
    requireValid(object(profile), 'expected a profile');
    string(profile.id, 'missing or invalid profile ID');
    requireValid(!ids.has(profile.id), 'duplicate profile ID');
    ids.add(profile.id);
    requireValid(LID_STATES.includes(profile.lid), 'unknown lid condition');
    requireValid(Array.isArray(profile.displays) && profile.displays.length > 0, 'missing physical monitors');
    const connectors = new Set();
    const displays = profile.displays.map(display => {
        requireValid(object(display), 'invalid monitor identity');
        string(display.connector, 'invalid monitor connector');
        string(display.name, 'invalid monitor name', true);
        for (const field of ['vendor', 'product', 'serial'])
            string(display[field], `invalid monitor ${field}`, true);
        requireValid(typeof display.builtin === 'boolean', 'invalid built-in monitor identity');
        requireValid(!connectors.has(display.connector), 'duplicate monitor connector');
        connectors.add(display.connector);
        const { connector, name, vendor, product, serial, builtin } = display;
        return { connector, name, vendor, product, serial, builtin };
    });
    requireValid(typeof profile.config === 'string' && profile.config.length <= MAX_CONFIG_BYTES &&
        encoder.encode(profile.config).length <= MAX_CONFIG_BYTES, 'configuration is missing or too large');
    const config = GLib.Variant.parse(new GLib.VariantType(CONFIG_TYPE), profile.config, null, null).deepUnpack();
    string(config[0], 'invalid profile name');
    propertyType(config[3], 'layout-mode', 'u');
    if (config[3]['layout-mode'] !== undefined)
        requireValid([1, 2].includes(config[3]['layout-mode'].get_uint32()), 'invalid layout mode');
    const physical = new Set();
    for (const [connector, name] of config[4]) {
        string(connector, 'invalid physical connector');
        string(name, 'invalid physical monitor name', true);
        requireValid(connectors.has(connector) && !physical.has(connector), 'inconsistent physical monitor context');
        physical.add(connector);
    }
    requireValid(physical.size === connectors.size, 'incomplete physical monitor context');
    requireValid(config[2].length > 0, 'no active monitors');
    let primary = 0;
    const active = new Set();
    for (const [, , scale, transform, isPrimary, monitors] of config[2]) {
        requireValid(Number.isFinite(scale) && scale > 0, 'invalid monitor scale');
        requireValid(transform >= 0 && transform <= 7, 'invalid monitor transform');
        primary += Number(isPrimary);
        requireValid(monitors.length > 0, 'empty logical monitor');
        for (const [connector, mode, properties] of monitors) {
            requireValid(connectors.has(connector) && !active.has(connector), 'unknown or repeated active monitor');
            string(mode, 'invalid monitor mode');
            propertyType(properties, 'underscanning', 'b');
            propertyType(properties, 'color-mode', 'u');
            active.add(connector);
        }
    }
    requireValid(primary === 1, 'expected exactly one primary logical monitor');
    // Mode availability depends on the connected hardware and is checked by profileRequest.
    return { id: profile.id, lid: profile.lid, displays, config };
}

export function parseProfileBackup(text) {
    requireValid(typeof text === 'string' && text.length <= MAX_BACKUP_BYTES && encoder.encode(text).length <= MAX_BACKUP_BYTES, 'file is missing or too large');
    const backup = JSON.parse(text);
    requireValid(object(backup) && backup.format === FORMAT, 'unsupported format');
    requireValid(backup.version === VERSION, 'unsupported version');
    requireValid(Array.isArray(backup.profiles) && backup.profiles.length <= MAX_PROFILES, 'invalid profile collection');
    const ids = new Set();
    return backup.profiles.map(profile => parseProfile(profile, ids));
}

export function exportProfiles(profiles) {
    requireValid(Array.isArray(profiles) && profiles.length <= MAX_PROFILES, 'invalid profile collection');
    const serialized = profiles.map(profile => ({
        id: profile.id, lid: profile.lid, displays: profile.displays,
        config: new GLib.Variant(CONFIG_TYPE, profile.config).print(true),
    }));
    const text = JSON.stringify({ format: FORMAT, version: VERSION, profiles: serialized }, null, 2);
    // Export and direct merge callers receive the same validation as file imports.
    parseProfileBackup(text);
    return text;
}

export function mergeProfiles(existing, imported) {
    const validated = parseProfileBackup(exportProfiles(imported));
    const profiles = [...existing];
    const ids = new Set(existing.map(profile => profile.id));
    const reserved = new Set([...ids, ...validated.map(profile => profile.id)]);
    let added = 0;
    let skipped = 0;
    for (const profile of validated) {
        if (profiles.some(current => duplicateProfile(current, profile))) {
            skipped++;
            continue;
        }
        if (ids.has(profile.id)) {
            let id;
            do {
                id = GLib.uuid_string_random();
            } while (reserved.has(id));
            profile.id = id;
        }
        ids.add(profile.id);
        reserved.add(profile.id);
        profiles.push(profile);
        added++;
    }
    return { profiles, added, skipped };
}
