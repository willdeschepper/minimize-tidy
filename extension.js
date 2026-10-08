// SPDX-License-Identifier: GPL-3.0-only
// Based on Hide minimized by Daniel Garcia Moreno (danigm):
// https://github.com/danigm/hide-minimized
// Modified in 2026: overview-only filtering, restore menu and custom animations.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';

const WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.DIALOG,
];
const MAX_LABEL_CHARS = 60;

const minimizedWindows = () => global.display.list_all_windows()
    .filter(w => w.minimized && !w.is_skip_taskbar())
    .sort((a, b) => b.get_user_time() - a.get_user_time());

export default class MinimizeTidy extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._shellwm = global.window_manager;
        this._animatedMinimizing = new Set();
        this._animatedUnminimizing = new Set();

        this._patchOverview();
        this._buildIndicator();
        this._takeOverAnimations();

        // Mantém contador e visibilidade do botão em dia
        const queue = () => this._queueUpdate();
        this._wmIds = ['minimize', 'unminimize', 'destroy', 'map']
            .map(sig => this._shellwm.connect_after(sig, queue));
        this._settingsId = this._settings.connect('changed', queue);
        // Janela minimizada fechada por outro lugar (dock, kill etc.)
        this._tracker = Shell.WindowTracker.get_default();
        this._trackerId = this._tracker.connect('tracked-windows-changed', queue);
        this._update();
    }

    /* --------------------------------------------------------- Overview */

    _patchOverview() {
        const original = Workspace.prototype._isOverviewWindow;
        if (typeof original !== 'function') {
            console.warn('[minimize-tidy] Workspace._isOverviewWindow not found; overview filtering disabled');
            return;
        }
        const settings = this._settings;
        this._originalIsOverviewWindow = original;
        this._isOverviewWindow = function (window) {
            if (!original.call(this, window))
                return false;
            if (!settings.get_boolean('hide-in-overview'))
                return true;
            const metaWindow = window.get_meta_window?.() ?? window;
            return !metaWindow.minimized;
        };
        Workspace.prototype._isOverviewWindow = this._isOverviewWindow;
    }

    _unpatchOverview() {
        // Não sobrescreve um patch que outra extensão tenha feito depois do nosso
        if (this._isOverviewWindow && Workspace.prototype._isOverviewWindow === this._isOverviewWindow)
            Workspace.prototype._isOverviewWindow = this._originalIsOverviewWindow;
        this._isOverviewWindow = null;
        this._originalIsOverviewWindow = null;
    }

    /* ------------------------------------------------------------- Menu */

    _buildIndicator() {
        this._indicator = new PanelMenu.Button(0.0, _('Minimized windows'), false);
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({
            icon_name: 'view-list-symbolic',
            style_class: 'system-status-icon',
        }));
        this._count = new St.Label({
            style_class: 'minimize-tidy-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._count);
        this._indicator.add_child(box);

        this._menuOpenId = this._indicator.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshMenu();
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    _queueUpdate() {
        if (this._updateId)
            return;
        this._updateId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._updateId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _update() {
        if (!this._indicator)
            return;
        const n = minimizedWindows().length;
        this._count.text = String(n);
        this._count.visible = n > 0 && this._settings.get_boolean('show-count');
        const visible = n > 0 || this._settings.get_string('indicator-mode') === 'always';
        this._indicator.container.visible = visible;
        if (!visible)
            this._indicator.menu.close();
        // O PopupMenu se recusa a abrir quando está vazio, então a lista
        // precisa estar montada antes do clique, não só na abertura
        this._refreshMenu();
    }

    _refreshMenu() {
        const menu = this._indicator.menu;
        menu.removeAll();

        const windows = minimizedWindows();
        if (!windows.length) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(_('No minimized windows'), {
                reactive: false,
                can_focus: false,
            }));
        } else {
            const tracker = Shell.WindowTracker.get_default();
            for (const window of windows) {
                const app = tracker.get_window_app(window);
                const appName = app?.get_name() ?? _('Window');
                let title = window.get_title() || appName;
                if (title.length > MAX_LABEL_CHARS)
                    title = `${title.slice(0, MAX_LABEL_CHARS - 1)}…`;

                const item = new PopupMenu.PopupImageMenuItem(title, app?.get_icon() ?? 'application-x-executable-symbolic');
                item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                if (title !== appName)
                    item.add_child(new St.Label({
                        text: appName,
                        style_class: 'minimize-tidy-app popup-inactive-menu-item',
                        y_align: Clutter.ActorAlign.CENTER,
                    }));
                item.connect('activate', () => Main.activateWindow(window));
                menu.addMenuItem(item);
            }

            if (windows.length > 1) {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                menu.addAction(_('Restore all'), () => {
                    const time = global.get_current_time();
                    for (const w of [...windows].reverse())
                        w.unminimize(time);
                    Main.activateWindow(windows[0]);
                });
            }
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Settings'), () => this.openPreferences());
    }

    /* -------------------------------------------------------- Animações */

    // O GNOME conecta callbacks próprios a minimize/unminimize na inicialização.
    // Bloqueamos esses handlers e conectamos os nossos; no modo "system" chamamos
    // os originais, então o comportamento padrão continua disponível.
    _takeOverAnimations() {
        const minimize = GObject.signal_handler_find(this._shellwm, {signalId: 'minimize'});
        const unminimize = GObject.signal_handler_find(this._shellwm, {signalId: 'unminimize'});
        if (!minimize || !unminimize) {
            console.warn('[minimize-tidy] window animation handlers not found; custom animations disabled');
            return;
        }
        this._minimizeHandler = minimize;
        this._unminimizeHandler = unminimize;
        this._customMinimizeId = this._shellwm.connect('minimize', (wm, actor) => this._minimizeWindow(wm, actor));
        this._customUnminimizeId = this._shellwm.connect('unminimize', (wm, actor) => this._unminimizeWindow(wm, actor));
        GObject.signal_handler_block(this._shellwm, minimize);
        GObject.signal_handler_block(this._shellwm, unminimize);
    }

    _releaseAnimations() {
        for (const actor of this._animatedMinimizing ?? []) {
            actor.remove_all_transitions();
            actor.rotation_angle_y = 0;
            Main.wm._minimizeWindowDone(this._shellwm, actor);
        }
        for (const actor of this._animatedUnminimizing ?? []) {
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
        if (this._minimizeHandler)
            GObject.signal_handler_unblock(this._shellwm, this._minimizeHandler);
        if (this._unminimizeHandler)
            GObject.signal_handler_unblock(this._shellwm, this._unminimizeHandler);
        this._customMinimizeId = this._customUnminimizeId = 0;
        this._minimizeHandler = this._unminimizeHandler = 0;
    }

    // Retângulo de destino: ícone na dock/barra de tarefas ou um canto do monitor
    _target(actor) {
        const window = actor.meta_window;
        if (this._settings.get_string('animation-direction') === 'icon') {
            const [ok, geom] = window.get_icon_geometry();
            if (ok && geom.width > 0)
                return {x: geom.x, y: geom.y, w: geom.width, h: geom.height};
        }
        const monitor = Main.layoutManager.monitors[window.get_monitor()];
        if (!monitor)
            return null;
        const inset = 16;
        let x = monitor.x + inset, y = monitor.y + inset;
        switch (this._settings.get_string('animation-direction')) {
        case 'top-center':
            x = monitor.x + monitor.width / 2;
            break;
        case 'top-right':
            x = monitor.x + monitor.width - inset;
            break;
        case 'bottom-left':
            y = monitor.y + monitor.height - inset;
            break;
        case 'bottom-center':
            x = monitor.x + monitor.width / 2;
            y = monitor.y + monitor.height - inset;
            break;
        case 'bottom-right':
            x = monitor.x + monitor.width - inset;
            y = monitor.y + monitor.height - inset;
            break;
        case 'center':
            x = monitor.x + monitor.width / 2;
            y = monitor.y + monitor.height / 2;
            break;
        }
        return {x, y, w: 0, h: 0};
    }

    _effectFor(actor) {
        const effect = this._settings.get_string('animation-effect');
        if (effect === 'system' || effect === 'instant')
            return effect;
        if (!Main.wm._shouldAnimateActor(actor, WINDOW_TYPES))
            return 'instant';
        return effect;
    }

    _minimizeWindow(shellwm, actor) {
        const effect = this._effectFor(actor);
        if (effect === 'system') {
            Main.wm._minimizeWindow(shellwm, actor);
            return;
        }
        const target = effect === 'scale' ? this._target(actor) : null;
        if (effect === 'instant' || (effect === 'scale' && !target)) {
            shellwm.completed_minimize(actor);
            return;
        }

        Main.wm._minimizing.add(actor);
        this._animatedMinimizing.add(actor);
        actor.set_pivot_point(0, 0);
        actor.set_scale(1, 1);
        actor.rotation_angle_y = 0;

        const animation = {
            opacity: 0,
            duration: this._settings.get_int('animation-duration'),
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => {
                actor.rotation_angle_y = 0;
                this._animatedMinimizing?.delete(actor);
                Main.wm._minimizeWindowDone(shellwm, actor);
            },
        };
        if (effect === 'scale') {
            Object.assign(animation, {
                x: target.x,
                y: target.y,
                scale_x: actor.width ? target.w / actor.width : 0,
                scale_y: actor.height ? target.h / actor.height : 0,
            });
        } else if (effect === 'flip') {
            actor.set_pivot_point(0.5, 0.5);
            animation.rotation_angle_y = 90;
        }
        actor.ease(animation);
    }

    _unminimizeWindow(shellwm, actor) {
        const effect = this._effectFor(actor);
        if (effect === 'system') {
            Main.wm._unminimizeWindow(shellwm, actor);
            return;
        }
        const target = effect === 'scale' ? this._target(actor) : null;
        if (effect === 'instant' || (effect === 'scale' && !target)) {
            shellwm.completed_unminimize(actor);
            return;
        }

        const rect = actor.meta_window.get_buffer_rect();
        Main.wm._unminimizing.add(actor);
        this._animatedUnminimizing.add(actor);
        actor.set_pivot_point(0, 0);
        actor.set_position(rect.x, rect.y);
        actor.set_scale(1, 1);
        actor.rotation_angle_y = 0;
        actor.opacity = 0;

        const animation = {
            opacity: 255,
            duration: this._settings.get_int('animation-duration'),
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => {
                actor.rotation_angle_y = 0;
                this._animatedUnminimizing?.delete(actor);
                Main.wm._unminimizeWindowDone(shellwm, actor);
            },
        };
        if (effect === 'scale') {
            actor.set_position(target.x, target.y);
            actor.set_scale(rect.width ? target.w / rect.width : 0, rect.height ? target.h / rect.height : 0);
            Object.assign(animation, {x: rect.x, y: rect.y, scale_x: 1, scale_y: 1});
        } else if (effect === 'flip') {
            actor.set_pivot_point(0.5, 0.5);
            actor.rotation_angle_y = -90;
            animation.rotation_angle_y = 0;
        }
        actor.show();
        actor.ease(animation);
    }

    /* ----------------------------------------------------------- Limpeza */

    disable() {
        this._releaseAnimations();

        if (this._updateId)
            GLib.source_remove(this._updateId);
        this._updateId = 0;
        for (const id of this._wmIds ?? [])
            this._shellwm.disconnect(id);
        this._wmIds = null;
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        if (this._trackerId)
            this._tracker.disconnect(this._trackerId);
        this._trackerId = 0;
        this._tracker = null;

        if (this._menuOpenId)
            this._indicator.menu.disconnect(this._menuOpenId);
        this._menuOpenId = 0;
        this._indicator?.destroy();
        this._indicator = null;
        this._count = null;

        this._unpatchOverview();
        this._shellwm = null;
        this._settings = null;
    }
}
