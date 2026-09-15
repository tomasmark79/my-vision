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

export const ConfigIndex = Object.freeze(
    {
        "NAME": 0,
        "HASH": 1,
        "LOGICAL_MONITORS": 2,
        "PROPERTIES": 3,
        "PHYSICAL_DISPLAYS": 4
    }
)

export function updateConfigHash(config) {
    // Use GVariant string representation for generating hash
    // Note: PHYSICAL_DISPLAYS format changed from a(ssss) to a(ss) - [connector, displayName]
    const tempVariant = new GLib.Variant('(a(iiduba(ssa{sv}))a{sv}a(ss))', [
        config[ConfigIndex.LOGICAL_MONITORS],
        config[ConfigIndex.PROPERTIES],
        config[ConfigIndex.PHYSICAL_DISPLAYS]
    ]);
    config[ConfigIndex.HASH] = (new GLib.String(tempVariant.print(false))).hash();
}

/**
 * Compare physical display properties
 * Supports both old format [connector, vendor, product, serial] and new format [connector, displayName]
 * to determine if two displays are the same hardware, regardless of connector
 */
export function comparePhysicalDisplays(display1, display2) {
    // New format: [connector, displayName]
    if (display1.length === 2 && display2.length === 2) {
        return display1[1] === display2[1];  // compare displayName
    }
    // Old format: [connector, vendor, product, serial]
    if (display1.length === 4 && display2.length === 4) {
        return display1[1] === display2[1] &&  // vendor
               display1[2] === display2[2] &&  // product
               display1[3] === display2[3];    // serial
    }
    // Mixed formats - try displayName from new vs concatenated from old
    const name1 = display1.length === 2 ? display1[1] : (display1[1] || display1[2] || display1[3] || "");
    const name2 = display2.length === 2 ? display2[1] : (display2[1] || display2[2] || display2[3] || "");
    return name1 === name2;
}

/**
 * Compare two configurations based on physical displays and logical monitor properties
 * Returns true if configs represent the same physical setup (ignoring connector names)
 */
export function compareConfigsByPhysicalProperties(config1, config2) {
    const a = config1[ConfigIndex.PHYSICAL_DISPLAYS];
    const b = config2[ConfigIndex.PHYSICAL_DISPLAYS];
    if (a.length !== b.length)
        return false;
    const mapping = new Map();
    const used = new Set();
    for (const display of a) {
        const matches = b.filter(candidate => comparePhysicalDisplays(display, candidate));
        if (matches.length !== 1 || used.has(matches[0][0]))
            return false;
        mapping.set(display[0], matches[0][0]);
        used.add(matches[0][0]);
    }
    const logical = config1[ConfigIndex.LOGICAL_MONITORS].map(m => [...m.slice(0, 5),
        m[5].map(([connector, mode, props]) => [mapping.get(connector), mode, props])]);
    // Equality is symmetric; a missing property is not an explicit saved value.
    const remapped = [...config1];
    remapped[ConfigIndex.LOGICAL_MONITORS] = logical;
    return matchesMonitorsConfig(logical, config1[ConfigIndex.PROPERTIES], config2) &&
        matchesMonitorsConfig(config2[ConfigIndex.LOGICAL_MONITORS], config2[ConfigIndex.PROPERTIES], remapped);
}

// Compare the effective request, independently of array/dictionary ordering and
// without a hash collision risk. Omitted properties leave Mutter's values alone.
export function matchesMonitorsConfig(logicalMonitors, properties, currentConfig) {
    if (currentConfig === null)
        return false;

    const unpack = value => value instanceof GLib.Variant ? value.recursiveUnpack() : value;
    const propertiesMatch = (requested, current) => Object.entries(requested).every(
        ([key, value]) => unpack(value) === unpack(current[key])
    );
    const sortMonitors = monitors => [...monitors].sort((a, b) => a[0].localeCompare(b[0]));
    const sortLogical = monitors => [...monitors].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const requested = sortLogical(logicalMonitors);
    const current = sortLogical(currentConfig[ConfigIndex.LOGICAL_MONITORS]);
    if (requested.length !== current.length ||
        !propertiesMatch(properties, currentConfig[ConfigIndex.PROPERTIES]))
        return false;

    return requested.every((logical, index) => {
        const active = current[index];
        if (!logical.slice(0, 5).every((value, i) => value === active[i]))
            return false;
        const monitors = sortMonitors(logical[5]);
        const activeMonitors = sortMonitors(active[5]);
        return monitors.length === activeMonitors.length && monitors.every((monitor, i) =>
            monitor[0] === activeMonitors[i][0] &&
            monitor[1] === activeMonitors[i][1] &&
            propertiesMatch(monitor[2], activeMonitors[i][2])
        );
    });
}
