# Cinnamon Notifications Fixer

Version: `1.0.1`

Small Cinnamon extension for Linux Mint / Cinnamon that enforces predictable notification behavior:

- shows notification popups for a fixed maximum time
- removes notifications after they close, including notification-center entries
- lets you choose the popup position
- restores Cinnamon's original behavior when the extension is disabled

Tested against Cinnamon 6.6.7 on Linux Mint 22.3.

## Settings

The extension exposes these settings in Cinnamon's extension settings UI:

- `Timeout`: number of seconds before notifications close
- `Delete after timeout`: remove notifications from the notification center after closing
- `Normalize critical urgency`: prevents critical notifications from bypassing normal close behavior
- `Position`: top-right, top-center, top-left, bottom-right, bottom-center, or bottom-left

Open the extension's Cinnamon settings window directly:

```bash
./scripts/open-settings.sh
```

## Install

### From GitHub release

Download `cinnamon-notifications-fixer@martinille-v1.0.1.zip` from the latest release and extract it into:

```text
~/.local/share/cinnamon/extensions/
```

Then enable `Cinnamon Notifications Fixer` in Cinnamon Extensions.

### From source

Clone the repository and run:

```bash
./scripts/install.sh
```

Then enable `Cinnamon Notifications Fixer` in Cinnamon Extensions.

### Settings

Open the settings window from Cinnamon Extensions, or run:

```bash
./scripts/open-settings.sh
```

## Disable or revert

Disable the extension in Cinnamon Extensions. The extension restores all patched Cinnamon methods in `disable()`, so disabling it returns notification handling to the original Cinnamon behavior.

To remove the installed files:

```bash
rm -rf ~/.local/share/cinnamon/extensions/cinnamon-notifications-fixer@martinille
```

Restart Cinnamon if the extension UI does not refresh immediately.

## Validation

Run:

```bash
./scripts/test.sh
```

## Release packaging

Create a release ZIP:

```bash
./scripts/package.sh
```
