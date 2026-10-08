// SPDX-License-Identifier: GPL-3.0-only
// Based on Hide minimized by Daniel Garcia Moreno (danigm):
// https://github.com/danigm/hide-minimized
// Modified in 2026 to filter only the Overview and add a restore menu.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
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

        this._indicator = new PanelMenu.Button(0.0, _('Minimized windows'), false);
        const indicatorContent = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });
        indicatorContent.add_child(new St.Icon({
            icon_name: 'view-list-symbolic',
            style_class: 'system-status-icon',
        }));
        indicatorContent.add_child(new St.Label({
            text: _('Minimized'),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._indicator.add_child(indicatorContent);

        this._menuOpenId = this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshMenu();
        });

        this._refreshMenu();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _refreshMenu() {
        const menu = this._indicator.menu;
        menu.removeAll();

        const windows = global.display.list_all_windows()
            .filter(window => window.minimized && !window.is_skip_taskbar())
            .sort((a, b) => b.get_user_time() - a.get_user_time());

        if (windows.length === 0) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(_('No minimized windows'), {
                reactive: false,
                can_focus: false,
            }));
            return;
        }

        const tracker = Shell.WindowTracker.get_default();
        for (const window of windows) {
            const appName = tracker.get_window_app(window)?.get_name() ?? _('Window');
            const title = window.get_title();
            const label = title ? `${appName} — ${title}` : appName;
            menu.addAction(label, () => Main.activateWindow(window));
        }
    }

    disable() {
        if (this._menuOpenId)
            this._indicator.menu.disconnect(this._menuOpenId);
        this._menuOpenId = null;

        this._indicator?.destroy();
        this._indicator = null;

        // Avoid overwriting a hook installed by another extension after ours.
        if (Workspace.prototype._isOverviewWindow === this._isOverviewWindow)
            Workspace.prototype._isOverviewWindow = this._originalIsOverviewWindow;

        this._isOverviewWindow = null;
        this._originalIsOverviewWindow = null;
    }
}
