const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const MessageTray = imports.ui.messageTray;
const Settings = imports.ui.settings;
const St = imports.gi.St;

const UUID = "notifications-extra-options@martinille";
const URGENCY_NORMAL = 1;
const STATE_HIDING = 3;
const ANIMATION_TIME = 200;

let fixer = null;

function init(metadata) {
    fixer = new NotificationFixer(metadata.uuid);
}

function enable() {
    fixer.enable();
}

function disable() {
    fixer.disable();
}

class NotificationFixer {
    constructor(uuid) {
        this.uuid = uuid || UUID;
        this.timeoutSeconds = 10;
        this.deleteAfterTimeout = true;
        this.normalizeCritical = true;
        this.highlightApps = "";
        this.highlightEffect = "red-flash";
        this.position = "top-right";

        this._enabled = false;
        this._settings = new Settings.ExtensionSettings(this, this.uuid);
        this._settings.bind("timeout-seconds", "timeoutSeconds", this._onSettingsChanged);
        this._settings.bind("delete-after-timeout", "deleteAfterTimeout", this._onSettingsChanged);
        this._settings.bind("normalize-critical", "normalizeCritical", this._onSettingsChanged);
        this._settings.bind("highlight-apps", "highlightApps", this._onSettingsChanged);
        this._settings.bind("highlight-effect", "highlightEffect", this._onSettingsChanged);
        this._settings.bind("position", "position", this._onSettingsChanged);

        this._originals = {};
        this._timers = [];
        this._effectTimers = [];
        this._popups = [];
    }

    enable() {
        if (this._enabled) {
            return;
        }

        this._patchNotificationDaemon();
        this._patchMessageTray();
        this._enabled = true;
    }

    disable() {
        if (!this._enabled) {
            return;
        }

        this._restore();
        this._clearAllTimers();
        this._clearAllEffectTimers();
        this._clearPopups();
        this._enabled = false;
    }

    _onSettingsChanged() {
        this._repositionCurrent();
    }

    _patchNotificationDaemon() {
        const daemon = Main.notificationDaemon;

        if (!daemon || !daemon.NotifyAsync || this._originals.notifyAsync) {
            return;
        }

        this._originals.notifyAsync = daemon.NotifyAsync;
        const self = this;

        daemon.NotifyAsync = function(params, invocation) {
            return self._originals.notifyAsync.call(this, self._normalizeParams(params), invocation);
        };
    }

    _patchMessageTray() {
        const tray = Main.messageTray;

        if (!tray || this._originals.trayOnNotify) {
            return;
        }

        this._originals.trayOnNotify = tray._onNotify;
        this._originals.trayShowNotification = tray._showNotification;
        this._originals.trayShowNotificationCompleted = tray._showNotificationCompleted;
        this._originals.trayHideNotification = tray._hideNotification;
        this._originals.trayHideNotificationCompleted = tray._hideNotificationCompleted;

        const self = this;

        tray._onNotify = function(source, notification) {
            self._prepareNotification(source, notification);
            self._showPopup(this, source, notification);
        };

        tray._showNotification = function() {
            self._originals.trayShowNotification.call(this);
            self._applyPosition(this);
        };

        tray._showNotificationCompleted = function() {
            self._originals.trayShowNotificationCompleted.call(this);

            if (this._notification) {
                this._updateNotificationTimeout(self._timeoutMs());
                self._scheduleDelete(this._notification);
            }
        };

        tray._hideNotification = function() {
            self._hideNotification(this);
        };

        tray._hideNotificationCompleted = function() {
            const notification = this._notification;

            self._originals.trayHideNotificationCompleted.call(this);

            if (self.deleteAfterTimeout && notification && !notification._destroyed) {
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            }
        };
    }

    _normalizeParams(params) {
        if (!params || params.length < 8) {
            return params;
        }

        const next = params.slice();
        const hints = {};

        for (let key in (params[6] || {})) {
            hints[key] = params[6][key];
        }

        hints.resident = GLib.Variant.new_boolean(false);

        if (this.normalizeCritical) {
            hints.urgency = GLib.Variant.new_byte(URGENCY_NORMAL);
        }

        next[6] = hints;
        next[7] = this._timeoutMs();

        return next;
    }

    _prepareNotification(source, notification) {
        if (!notification) {
            return;
        }

        notification.setResident(false);

        if (this.normalizeCritical && notification.urgency === MessageTray.Urgency.CRITICAL) {
            notification.setUrgency(MessageTray.Urgency.NORMAL);
        }

        this._applyHighlight(source, notification);
    }

    _applyHighlight(source, notification) {
        const actors = this._styleActors(notification);

        if (!actors.length) {
            return;
        }

        this._clearHighlight(notification);

        if (!this._shouldHighlight(source, notification)) {
            return;
        }

        const effect = this._highlightEffect();

        for (let i = 0; i < actors.length; i++) {
            actors[i].add_style_class_name("neo-highlight");
            actors[i].add_style_class_name("neo-highlight-" + effect);
        }

        if (effect === "red-flash") {
            this._startFlash(notification);
        }
    }

    _clearHighlight(notification) {
        const actors = this._styleActors(notification);

        if (!actors.length) {
            return;
        }

        for (let i = 0; i < actors.length; i++) {
            actors[i].remove_style_class_name("neo-highlight");
            actors[i].remove_style_class_name("neo-highlight-red-flash");
            actors[i].remove_style_class_name("neo-highlight-on");
            actors[i].remove_style_class_name("neo-highlight-toxic");
            actors[i].remove_style_class_name("neo-highlight-siren");
            actors[i].remove_style_class_name("neo-highlight-hazard");
        }

        this._clearEffectTimer(notification);
    }

    _styleActors(notification) {
        const actors = [];

        if (notification && notification.actor) {
            actors.push(notification.actor);
        }

        if (notification && notification._table) {
            actors.push(notification._table);
        }

        return actors;
    }

    _shouldHighlight(source, notification) {
        const apps = this._highlightApps();

        if (!apps.length) {
            return false;
        }

        const names = this._notificationNames(source, notification);

        for (let i = 0; i < apps.length; i++) {
            for (let j = 0; j < names.length; j++) {
                if (names[j].indexOf(apps[i]) !== -1) {
                    return true;
                }
            }
        }

        return false;
    }

    _highlightApps() {
        return String(this.highlightApps || "")
            .toLowerCase()
            .split(",")
            .map((app) => app.trim())
            .filter((app) => app.length > 0);
    }

    _notificationNames(source, notification) {
        const names = [];
        this._pushName(names, source && source.title);
        this._pushName(names, source && source.initialTitle);
        this._pushName(names, source && source.desktopEntryHint);
        this._pushName(names, notification && notification.title);

        if (source && source.app) {
            try {
                this._pushName(names, source.app.get_name());
            } catch (e) {
            }

            try {
                this._pushName(names, source.app.get_id());
            } catch (e) {
            }
        }

        return names;
    }

    _pushName(names, name) {
        if (name) {
            names.push(String(name).toLowerCase());
        }
    }

    _highlightEffect() {
        const effect = String(this.highlightEffect || "red-flash");

        if (["red-flash", "toxic", "siren", "hazard"].indexOf(effect) !== -1) {
            return effect;
        }

        return "red-flash";
    }

    _startFlash(notification) {
        const actors = this._styleActors(notification);

        if (!actors.length) {
            return;
        }

        this._clearEffectTimer(notification);
        notification._cnfFlashOn = false;
        notification._cnfEffectTimerId = Mainloop.timeout_add(180, () => {
            const actors = this._styleActors(notification);

            if (!actors.length || notification._destroyed) {
                notification._cnfEffectTimerId = 0;
                return false;
            }

            notification._cnfFlashOn = !notification._cnfFlashOn;

            for (let i = 0; i < actors.length; i++) {
                if (notification._cnfFlashOn) {
                    actors[i].add_style_class_name("neo-highlight-on");
                } else {
                    actors[i].remove_style_class_name("neo-highlight-on");
                }
            }

            return true;
        });

        this._effectTimers.push(notification);
    }

    _clearEffectTimer(notification) {
        if (notification && notification._cnfEffectTimerId) {
            Mainloop.source_remove(notification._cnfEffectTimerId);
            notification._cnfEffectTimerId = 0;
        }

        if (notification) {
            notification._cnfFlashOn = false;
        }
    }

    _clearAllEffectTimers() {
        for (let i = 0; i < this._effectTimers.length; i++) {
            this._clearEffectTimer(this._effectTimers[i]);
        }

        this._effectTimers = [];
    }

    _showPopup(tray, source, notification) {
        if (!notification || !notification.actor) {
            return;
        }

        if (notification._cnfPopup) {
            this._applyHighlight(source, notification);
            this._scheduleDelete(notification);
            this._positionPopups();
            return;
        }

        if (notification.actor._parent_container) {
            notification.actor._parent_container.remove_actor(notification.actor);
        }

        const bin = new St.Bin();
        const monitor = this._notificationMonitor(tray);
        const fullscreen = tray.settings && tray.settings.get_boolean("fullscreen-notifications");

        bin.child = notification.actor;
        bin.opacity = 0;
        notification._cnfPopup = {
            bin: bin,
            monitor: monitor,
            notification: notification,
            positionSignal: 0,
            signal: 0
        };

        notification._cnfPopup.signal = notification.connect("destroy", () => {
            this._removePopup(notification);
        });
        notification._cnfPopup.positionSignal = bin.connect("queue-redraw", () => {
            this._positionPopups();
            return false;
        });

        this._popups.push(notification);
        Main.layoutManager.addChrome(bin);
        Main.layoutManager._chrome.modifyActorParams(bin, {
            visibleInFullscreen: notification.urgency === MessageTray.Urgency.CRITICAL || fullscreen
        });

        if (!notification.silent || notification.urgency >= MessageTray.Urgency.HIGH) {
            Main.soundManager.play("notification");
        }

        bin.show();
        this._positionPopups();
        bin.ease({
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
        this._scheduleDelete(notification);
    }

    _removePopup(notification) {
        const popup = notification && notification._cnfPopup;

        if (!popup) {
            return;
        }

        const index = this._popups.indexOf(notification);

        if (index !== -1) {
            this._popups.splice(index, 1);
        }

        this._clearTimer(notification);
        this._clearHighlight(notification);

        if (popup.positionSignal) {
            popup.bin.disconnect(popup.positionSignal);
        }

        popup.bin.child = null;
        Main.layoutManager.removeChrome(popup.bin);
        popup.bin.destroy();
        notification._cnfPopup = null;
        this._positionPopups();
    }

    _clearPopups() {
        const popups = this._popups.slice();

        for (let i = 0; i < popups.length; i++) {
            if (!popups[i]._destroyed) {
                popups[i].destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
            }

            this._removePopup(popups[i]);
        }

        this._popups = [];
    }

    _scheduleDelete(notification) {
        if (!this.deleteAfterTimeout || !notification) {
            return;
        }

        this._clearTimer(notification);

        notification._cnfTimerId = Mainloop.timeout_add_seconds(this.timeoutSeconds, () => {
            notification._cnfTimerId = 0;

            if (!notification._destroyed) {
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
            }

            return false;
        });

        this._timers.push(notification);
    }

    _clearTimer(notification) {
        if (notification && notification._cnfTimerId) {
            Mainloop.source_remove(notification._cnfTimerId);
            notification._cnfTimerId = 0;
        }
    }

    _clearAllTimers() {
        for (let i = 0; i < this._timers.length; i++) {
            this._clearTimer(this._timers[i]);
        }

        this._timers = [];
    }

    _timeoutMs() {
        return Math.max(1, this.timeoutSeconds) * 1000;
    }

    _notificationMonitor(tray) {
        let monitor = Main.layoutManager.primaryMonitor;

        if (!tray || !tray.settings) {
            return monitor;
        }

        const display = tray.settings.get_string("notification-screen-display");

        if (display === "active-screen") {
            return Main.layoutManager.currentMonitor;
        }

        if (display === "fixed-screen") {
            const number = tray.settings.get_int("notification-fixed-screen");
            const monitors = Main.layoutManager.monitors;

            if (number > 0 && number <= monitors.length) {
                monitor = monitors[number - 1];
            }
        }

        return monitor;
    }

    _positionPopups() {
        const pos = this.position || "top-right";
        const isBottom = pos.indexOf("bottom") !== -1;
        const gap = 10;
        const offsets = {};

        for (let i = 0; i < this._popups.length; i++) {
            const notification = this._popups[i];
            const popup = notification && notification._cnfPopup;

            if (!popup || !popup.bin || !notification.actor) {
                continue;
            }

            const monitor = popup.monitor || Main.layoutManager.primaryMonitor;
            const key = String(monitor.index);
            const base = this._basePosition(monitor, popup.bin, notification.actor);

            if (!offsets[key]) {
                offsets[key] = 0;
            }

            popup.bin.x = base.x;
            popup.bin.y = isBottom
                ? base.y - offsets[key]
                : base.y + offsets[key];

            offsets[key] += popup.bin.height + gap;
        }
    }

    _basePosition(monitor, bin, actor) {
        const pos = this.position || "top-right";
        const topPanel = Main.panelManager.getPanel(monitor.index, 0);
        const bottomPanel = Main.panelManager.getPanel(monitor.index, 1);
        const leftPanel = Main.panelManager.getPanel(monitor.index, 2);
        const rightPanel = Main.panelManager.getPanel(monitor.index, 3);
        const margin = this._notificationMargin(actor);
        let topGap = 10;
        let bottomGap = 10;
        let leftGap = 0;
        let rightGap = 0;

        if (topPanel) {
            topGap += topPanel.actor.get_height();
        }

        if (bottomPanel) {
            bottomGap += bottomPanel.actor.get_height();
        }

        if (leftPanel) {
            leftGap += leftPanel.actor.get_width();
        }

        if (rightPanel) {
            rightGap += rightPanel.actor.get_width();
        }

        const width = bin.width || actor.width;
        const height = bin.height || actor.height;
        const isLeft = pos.indexOf("left") !== -1;
        const isCenter = pos.indexOf("center") !== -1;
        const isBottom = pos.indexOf("bottom") !== -1;
        let x = monitor.x + monitor.width - width - margin - rightGap;

        if (isCenter) {
            x = monitor.x + Math.floor((monitor.width - width + leftGap - rightGap) / 2);
        } else if (isLeft) {
            x = monitor.x + margin + leftGap;
        }

        return {
            x: x,
            y: isBottom
                ? monitor.y + monitor.height - height - bottomGap
                : monitor.y + topGap
        };
    }

    _applyPosition(tray) {
        if (!tray || !tray._notification || !tray._notificationBin || !tray._monitor) {
            return;
        }

        this._disconnectPositionSignal(tray);

        if (tray.bottomPositionSignal) {
            tray._notificationBin.disconnect(tray.bottomPositionSignal);
            tray.bottomPositionSignal = 0;
        }

        const reposition = () => {
            this._setNotificationPosition(tray);
            return false;
        };

        reposition();
        tray._cnfPositionSignal = tray._notificationBin.connect("queue-redraw", reposition);
    }

    _setNotificationPosition(tray) {
        const monitor = tray._monitor;
        const bin = tray._notificationBin;
        const table = tray._notification._table;
        const pos = this.position || "top-right";

        const topPanel = Main.panelManager.getPanel(monitor.index, 0);
        const bottomPanel = Main.panelManager.getPanel(monitor.index, 1);
        const leftPanel = Main.panelManager.getPanel(monitor.index, 2);
        const rightPanel = Main.panelManager.getPanel(monitor.index, 3);

        const margin = this._notificationMargin(table);
        let topGap = 10;
        let bottomGap = 10;
        let leftGap = 0;
        let rightGap = 0;

        if (topPanel) {
            topGap += topPanel.actor.get_height();
        }

        if (bottomPanel) {
            bottomGap += bottomPanel.actor.get_height();
        }

        if (leftPanel) {
            leftGap += leftPanel.actor.get_width();
        }

        if (rightPanel) {
            rightGap += rightPanel.actor.get_width();
        }

        const width = bin.width || table.width;
        const height = bin.height || table.height;
        const isLeft = pos.indexOf("left") !== -1;
        const isCenter = pos.indexOf("center") !== -1;
        const isBottom = pos.indexOf("bottom") !== -1;

        if (isCenter) {
            bin.x = monitor.x + Math.floor((monitor.width - width + leftGap - rightGap) / 2);
        } else if (isLeft) {
            bin.x = monitor.x + margin + leftGap;
        } else {
            bin.x = monitor.x + monitor.width - width - margin - rightGap;
        }

        bin.y = isBottom
            ? monitor.y + monitor.height - height - bottomGap
            : monitor.y + topGap;
    }

    _hideNotification(tray) {
        this._disconnectPositionSignal(tray);

        if (tray.bottomPositionSignal) {
            tray._notificationBin.disconnect(tray.bottomPositionSignal);
            tray.bottomPositionSignal = 0;
        }

        const monitor = tray._monitor || Main.layoutManager.primaryMonitor;
        const pos = this.position || "top-right";
        const isBottom = pos.indexOf("bottom") !== -1;
        const y = isBottom
            ? monitor.y + monitor.height
            : monitor.y - tray._notificationBin.height;

        tray._notificationState = STATE_HIDING;
        tray._notificationBin.ease({
            y: y,
            opacity: 0,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                tray._hideNotificationCompleted();
                tray._updateState();
            }
        });
    }

    _notificationMargin(table) {
        try {
            return table.get_theme_node().get_length("margin-from-right-edge-of-screen");
        } catch (e) {
            return 10;
        }
    }

    _disconnectPositionSignal(tray) {
        if (tray && tray._cnfPositionSignal) {
            tray._notificationBin.disconnect(tray._cnfPositionSignal);
            tray._cnfPositionSignal = 0;
        }
    }

    _repositionCurrent() {
        if (this._enabled && Main.messageTray) {
            this._applyPosition(Main.messageTray);

            if (Main.messageTray._notification) {
                this._applyHighlight(Main.messageTray._notification.source, Main.messageTray._notification);
            }
        }
    }

    _restore() {
        const daemon = Main.notificationDaemon;
        const tray = Main.messageTray;

        if (daemon && this._originals.notifyAsync) {
            daemon.NotifyAsync = this._originals.notifyAsync;
        }

        if (tray) {
            this._disconnectPositionSignal(tray);

            if (this._originals.trayOnNotify) {
                tray._onNotify = this._originals.trayOnNotify;
            }

            if (this._originals.trayShowNotification) {
                tray._showNotification = this._originals.trayShowNotification;
            }

            if (this._originals.trayShowNotificationCompleted) {
                tray._showNotificationCompleted = this._originals.trayShowNotificationCompleted;
            }

            if (this._originals.trayHideNotification) {
                tray._hideNotification = this._originals.trayHideNotification;
            }

            if (this._originals.trayHideNotificationCompleted) {
                tray._hideNotificationCompleted = this._originals.trayHideNotificationCompleted;
            }
        }

        this._originals = {};
    }
}
