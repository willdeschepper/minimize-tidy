// SPDX-License-Identifier: GPL-3.0-only
// Based on Hide minimized by Daniel Garcia Moreno (danigm):
// https://github.com/danigm/hide-minimized
// Modified in 2026 to filter only the Activities Overview.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';

export default class MinimizeTidy extends Extension {
    enable() {
        const original = Workspace.prototype._isOverviewWindow;
        this._originalIsOverviewWindow = original;

        this._isOverviewWindow = function (window) {
            if (!original.call(this, window))
                return false;

            const metaWindow = window.get_meta_window?.() ?? window;
            return !metaWindow.minimized;
        };

        Workspace.prototype._isOverviewWindow = this._isOverviewWindow;
    }

    disable() {
        // Avoid overwriting a hook installed by another extension after ours.
        if (Workspace.prototype._isOverviewWindow === this._isOverviewWindow)
            Workspace.prototype._isOverviewWindow = this._originalIsOverviewWindow;

        this._isOverviewWindow = null;
        this._originalIsOverviewWindow = null;
    }
}
