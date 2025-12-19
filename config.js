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
    const physicalDisplays1 = config1[ConfigIndex.PHYSICAL_DISPLAYS];
    const physicalDisplays2 = config2[ConfigIndex.PHYSICAL_DISPLAYS];
    
    // Must have same number of displays
    if (physicalDisplays1.length !== physicalDisplays2.length) {
        return false;
    }
    
    // Check if all displays in config1 match displays in config2 (order-independent)
    const allDisplaysMatch = physicalDisplays1.every(display1 =>
        physicalDisplays2.some(display2 => comparePhysicalDisplays(display1, display2))
    );
    
    if (!allDisplaysMatch) {
        return false;
    }
    
    // Compare logical monitor properties (position, scale, rotation, primary)
    const logicalMonitors1 = config1[ConfigIndex.LOGICAL_MONITORS];
    const logicalMonitors2 = config2[ConfigIndex.LOGICAL_MONITORS];
    
    if (logicalMonitors1.length !== logicalMonitors2.length) {
        return false;
    }
    
    // Create sorted copies for comparison (by position)
    const sorted1 = [...logicalMonitors1].sort((a, b) => {
        if (a[0] !== b[0]) return a[0] - b[0]; // x
        return a[1] - b[1]; // y
    });
    const sorted2 = [...logicalMonitors2].sort((a, b) => {
        if (a[0] !== b[0]) return a[0] - b[0]; // x
        return a[1] - b[1]; // y
    });
    
    // Compare each logical monitor (x, y, scale, transform, primary)
    for (let i = 0; i < sorted1.length; i++) {
        const lm1 = sorted1[i];
        const lm2 = sorted2[i];
        
        // Compare: x, y, scale, transform, primary
        if (lm1[0] !== lm2[0] || // x
            lm1[1] !== lm2[1] || // y
            lm1[2] !== lm2[2] || // scale
            lm1[3] !== lm2[3] || // transform
            lm1[4] !== lm2[4]) { // primary
            return false;
        }
    }
    
    return true;
}

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