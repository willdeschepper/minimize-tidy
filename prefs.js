// SPDX-License-Identifier: GPL-3.0-only

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function addChoice(group, settings, key, title, subtitle, choices) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });
    const selected = choices.findIndex(([value]) => value === settings.get_string(key));
    row.selected = selected < 0 ? 0 : selected;
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    group.add(row);
    return row;
}

export default class MinimizeTidyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const effects = [
            ['scale', _('Shrink to a point')],
            ['fade', _('Fade out')],
            ['flip', _('Flip away')],
            ['instant', _('Disappear instantly')],
        ];
        const directions = [
            ['top-left', _('Top left')],
            ['top-right', _('Top right')],
            ['bottom-left', _('Bottom left')],
            ['bottom-right', _('Bottom right')],
            ['center', _('Center')],
        ];

        const page = new Adw.PreferencesPage({
            title: _('Animations'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Window animation'),
            description: _('Choose how windows minimize and return.'),
        });
        page.add(group);

        const effect = addChoice(group, settings, 'animation-effect',
            _('Effect'), _('Applied when minimizing and restoring a window'), effects);
        const direction = addChoice(group, settings, 'animation-direction',
            _('Destination'), _('Where the window shrinks to'), directions);

        const updateDirection = () => {
            direction.sensitive = effects[effect.selected]?.[0] === 'scale';
        };
        effect.connect('notify::selected', updateDirection);
        updateDirection();
    }
}
