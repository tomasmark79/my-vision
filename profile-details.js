// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import { displayRecord, mapDisplays, profileRequest, unpack } from './profiles.js';

export function profileStatus(profile, displays, lid) {
    if (displays === null)
        return { available: false, reason: 'Waiting for display information' };
    try {
        profileRequest(profile, displays, lid);
        return { available: true, reason: null };
    } catch (error) {
        return { available: false, reason: error.message };
    }
}

export function profileMonitorDetails(profile, displays = []) {
    const current = (displays ?? []).map(displayRecord);
    return profile.displays.map(saved => {
        const logical = profile.config[2].find(m => m[5].some(([connector]) => connector === saved.connector));
        const detail = { name: saved.name || saved.product || saved.connector, enabled: Boolean(logical) };
        if (!logical)
            return detail;
        const [, mode] = logical[5].find(([connector]) => connector === saved.connector);
        let liveMode;
        try {
            const connector = mapDisplays([saved], current).get(saved.connector);
            liveMode = displays.find(d => d.id[0] === connector).modes.find(m => m[0] === mode);
        } catch {
            // Disconnected or ambiguous hardware cannot supply mode metadata.
        }
        // Mutter mode IDs are opaque. Only decode the familiar complete form;
        // otherwise show the stored ID instead of guessing offline parameters.
        const parsed = /^(\d+)x(\d+)@(\d+(?:\.\d+)?)(\+vrr)?$/.exec(mode);
        return {
            ...detail, mode, scale: logical[2], primary: logical[4], x: logical[0], y: logical[1], transform: logical[3],
            width: liveMode?.[1] ?? (parsed ? Number(parsed[1]) : null),
            height: liveMode?.[2] ?? (parsed ? Number(parsed[2]) : null),
            refresh: liveMode?.[3] ?? (parsed ? Number(parsed[3]) : null),
            vrr: parsed?.[4] === '+vrr' || unpack(liveMode?.[6]?.['refresh-rate-mode']) === 'variable',
        };
    });
}

export function formatProfileDetails(profile, displays, lid, translate = text => text) {
    const status = profileStatus(profile, displays, lid);
    const lines = [status.available ? translate('Available for the current setup') : `${translate('Unavailable')}: ${status.reason}`];
    const rounded = value => String(Number(value.toFixed(3)));
    for (const monitor of profileMonitorDetails(profile, displays)) {
        lines.push('', monitor.name);
        if (!monitor.enabled) {
            lines.push(translate('Off'));
            continue;
        }
        const mode = monitor.width === null
            ? `${translate('Saved mode')}: ${monitor.mode}`
            : `${monitor.width} × ${monitor.height} · ${rounded(monitor.refresh)} Hz`;
        lines.push(`${translate('On')} · ${mode}${monitor.vrr ? ' · VRR' : ''}`);
        lines.push(`${translate('Scale')}: ${rounded(monitor.scale * 100)}%${monitor.primary ? ` · ${translate('Primary display')}` : ''}`);
        lines.push(`${translate('Position')}: ${monitor.x}, ${monitor.y}`);
        const orientations = ['Normal', '90°', '180°', '270°', 'Flipped', 'Flipped 90°', 'Flipped 180°', 'Flipped 270°'];
        if (monitor.transform !== 0)
            lines.push(`${translate('Orientation')}: ${translate(orientations[monitor.transform])}`);
    }
    return lines.join('\n');
}
