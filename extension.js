// SPDX-License-Identifier: GPL-3.0-only
// Based on Hide minimized by Daniel Garcia Moreno (danigm):
// https://github.com/danigm/hide-minimized
// Modified in 2026 to filter only the Overview and add a restore menu.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';

const ANIMATION_TIME = 300;
const WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.DIALOG,
];

export default class MinimizeTidy extends Extension {
    enable() {
        this._settings = this.getSettings();
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

        // GNOME connects bound callbacks to these signals at startup. Replacing
        // Main.wm._minimizeWindow alone would leave those callbacks untouched.
        this._shellwm = Main.wm._shellwm;
        this._minimizeHandler = GObject.signal_handler_find(this._shellwm, {
            signalId: 'minimize',
        });
        this._unminimizeHandler = GObject.signal_handler_find(this._shellwm, {
            signalId: 'unminimize',
        });
        this._animatedMinimizing = new Set();
        this._animatedUnminimizing = new Set();

        if (!this._minimizeHandler || !this._unminimizeHandler)
            throw new Error('GNOME Shell window animation handlers were not found');

        this._customMinimizeId = this._shellwm.connect('minimize',
            (shellwm, actor) => this._minimizeWindow(shellwm, actor));
        this._customUnminimizeId = this._shellwm.connect('unminimize',
            (shellwm, actor) => this._unminimizeWindow(shellwm, actor));
        GObject.signal_handler_block(this._shellwm, this._minimizeHandler);
        this._minimizeBlocked = true;
        GObject.signal_handler_block(this._shellwm, this._unminimizeHandler);
        this._unminimizeBlocked = true;
    }

    _destination(actor) {
        const monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor)
            return null;

        const inset = 16;
        switch (this._settings.get_string('animation-direction')) {
        case 'top-right':
            return [monitor.x + monitor.width - inset, monitor.y + inset];
        case 'bottom-left':
            return [monitor.x + inset, monitor.y + monitor.height - inset];
        case 'bottom-right':
            return [monitor.x + monitor.width - inset, monitor.y + monitor.height - inset];
        case 'center':
            return [monitor.x + monitor.width / 2, monitor.y + monitor.height / 2];
        default:
            return [monitor.x + inset, monitor.y + inset];
        }
    }

    _minimizeWindow(shellwm, actor) {
        if (!Main.wm._shouldAnimateActor(actor, WINDOW_TYPES) ||
            this._settings.get_string('animation-effect') === 'instant') {
            shellwm.completed_minimize(actor);
            return;
        }

        const effect = this._settings.get_string('animation-effect');
        const destination = effect === 'scale' ? this._destination(actor) : null;
        if (effect === 'scale' && !destination) {
            shellwm.completed_minimize(actor);
            return;
        }

        actor.set_scale(1, 1);
        actor.rotation_angle_y = 0;
        Main.wm._minimizing.add(actor);
        this._animatedMinimizing.add(actor);

        const animation = {
            opacity: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => {
                actor.rotation_angle_y = 0;
                this._animatedMinimizing.delete(actor);
                Main.wm._minimizeWindowDone(shellwm, actor);
            },
        };

        if (effect === 'scale') {
            Object.assign(animation, {
                scale_x: 0,
                scale_y: 0,
                x: destination[0],
                y: destination[1],
            });
        } else if (effect === 'flip') {
            actor.set_pivot_point(0.5, 0.5);
            animation.rotation_angle_y = 90;
        }
        actor.ease(animation);
    }

    _unminimizeWindow(shellwm, actor) {
        if (!Main.wm._shouldAnimateActor(actor, WINDOW_TYPES) ||
            this._settings.get_string('animation-effect') === 'instant') {
            shellwm.completed_unminimize(actor);
            return;
        }

        const effect = this._settings.get_string('animation-effect');
        const destination = effect === 'scale' ? this._destination(actor) : null;
        if (effect === 'scale' && !destination) {
            shellwm.completed_unminimize(actor);
            return;
        }

        const rect = actor.meta_window.get_buffer_rect();
        Main.wm._unminimizing.add(actor);
        this._animatedUnminimizing.add(actor);
        actor.set_position(rect.x, rect.y);
        actor.set_scale(1, 1);
        actor.opacity = 0;
        actor.rotation_angle_y = 0;

        const animation = {
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => {
                actor.rotation_angle_y = 0;
                this._animatedUnminimizing.delete(actor);
                Main.wm._unminimizeWindowDone(shellwm, actor);
            },
        };

        if (effect === 'scale') {
            actor.set_position(...destination);
            actor.set_scale(0, 0);
            Object.assign(animation, {x: rect.x, y: rect.y, scale_x: 1, scale_y: 1});
        } else if (effect === 'flip') {
            actor.set_pivot_point(0.5, 0.5);
            actor.rotation_angle_y = -90;
            animation.rotation_angle_y = 0;
        }

        actor.show();
        actor.ease(animation);
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
        } else {
            const tracker = Shell.WindowTracker.get_default();
            for (const window of windows) {
                const appName = tracker.get_window_app(window)?.get_name() ?? _('Window');
                const title = window.get_title();
                const label = title ? `${appName} — ${title}` : appName;
                menu.addAction(label, () => Main.activateWindow(window));
            }
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Animation settings'), () => this.openPreferences());
    }

    disable() {
        for (const actor of [...(this._animatedMinimizing ?? [])]) {
            actor.remove_all_transitions();
            actor.rotation_angle_y = 0;
            Main.wm._minimizeWindowDone(this._shellwm, actor);
        }
        for (const actor of [...(this._animatedUnminimizing ?? [])]) {
            actor.remove_all_transitions();
            actor.rotation_angle_y = 0;
            Main.wm._unminimizeWindowDone(this._shellwm, actor);
        }
        this._animatedMinimizing = null;
        this._animatedUnminimizing = null;

        if (this._customMinimizeId)
            this._shellwm.disconnect(this._customMinimizeId);
        if (this._customUnminimizeId)
            this._shellwm.disconnect(this._customUnminimizeId);
        if (this._minimizeBlocked)
            GObject.signal_handler_unblock(this._shellwm, this._minimizeHandler);
        if (this._unminimizeBlocked)
            GObject.signal_handler_unblock(this._shellwm, this._unminimizeHandler);
        this._shellwm = null;
        this._minimizeBlocked = false;
        this._unminimizeBlocked = false;
        this._settings = null;

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
