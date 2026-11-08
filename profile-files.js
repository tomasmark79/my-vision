// Copyright (C) 2026 Tomáš Mark
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { MAX_BACKUP_BYTES, parseProfileBackup } from './profile-backup.js';

export async function readProfileBackup(file, cancellable) {
    Gio._promisify(Gio.File.prototype, 'read_async');
    Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
    Gio._promisify(Gio.InputStream.prototype, 'close_async');
    const stream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
    try {
        cancellable.set_error_if_cancelled();
        const chunks = [];
        let size = 0;
        while (size <= MAX_BACKUP_BYTES) {
            const bytes = await stream.read_bytes_async(Math.min(65536, MAX_BACKUP_BYTES + 1 - size), GLib.PRIORITY_DEFAULT, cancellable);
            cancellable.set_error_if_cancelled();
            const chunk = bytes.get_data();
            if (chunk.length === 0)
                break;
            size += chunk.length;
            chunks.push(chunk);
        }
        if (size > MAX_BACKUP_BYTES)
            throw new Error('The profile backup file is too large');
        const data = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return parseProfileBackup(new TextDecoder('utf-8', { fatal: true }).decode(data));
    } finally {
        // Closing the local stream must finish even when its read was cancelled.
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}

export async function writeProfileBackup(file, text, cancellable) {
    Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
    cancellable.set_error_if_cancelled();
    await file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(text)), null, false,
        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
    cancellable.set_error_if_cancelled();
}
