# Flightradar Radar Card

[![Release](https://img.shields.io/github/v/release/Ehrenholm/flightradar-radar-card)](https://github.com/Ehrenholm/flightradar-radar-card/releases/latest)
[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support%20me-ff5f5f?logo=ko-fi&logoColor=white)](https://ko-fi.com/ehrenholm)

A round, retro radar-scope Lovelace card for Home Assistant that displays live
flights from the [AlexandrErohin/home-assistant-flightradar24](https://github.com/AlexandrErohin/home-assistant-flightradar24)
integration — phosphor sweep, blip decay, dark map underlay, and an ATC-style
contacts board.

![Flightradar Radar Card](assets/screenshot.png)

## Table of contents

- [Features](#features)
- [Preparation](#preparation)
- [Installation](#installation)
- [Add the card](#add-the-card)
- [Options](#options)
- [Examples](#examples)
- [FAQ](#faq)
- [Support](#support)
- [Contribute](#contribute)
- [Credits](#credits)

## Features

- Round CRT-style scope: rotating sweep beam, phosphor blip decay (pings fire
  exactly when the beam passes), scanlines, vignette, bezel with compass and
  labelled range rings
- Dark Leaflet basemap (CARTO tiles), tinted to match the theme
- Live aircraft blips with heading, callsign, and trails (line or
  phosphor-dot style); smooth dead-reckoned motion between sensor updates
- Contacts board: altitude/speed/range plus airline, model, registration and
  route; click a row or a blip to select — shows an ATC data tag on the scope
  and the aircraft photo in the panel
- Helicopters drawn as circle glyphs (detected from aircraft type)
- Privacy-blocked aircraft identified by type (no "BLOCKED" labels) with
  stable anonymous tracks
- Emergency squawks (7700/7600/7500) paint red, pulse, and sort first
- Lost contacts coast on dead reckoning (dimmed) for `linger_time` before
  removal, so momentary signal dropouts don't blink blips away
- Themes: `green`, `amber`, `blue`
- Optional sound alerts — synthesized sonar pings (no audio files) for new
  contacts, proximity, and emergencies, with a tap-to-arm speaker toggle on
  the scope
- Sizes itself to the dashboard column **and** the screen height (wall-tablet
  friendly, works in old Android WebViews); proximity alert, startup
  animation, and more — all configurable
- Visual config editor with every option; running version shown in the map
  attribution corner

## Preparation

The card reads the `flights` attribute of a sensor created by the
[FlightRadar24 integration](https://github.com/AlexandrErohin/home-assistant-flightradar24)
(install it via HACS first). Note down two things from that integration's
configuration:

- the **radius** — set the card's `radius_km` to the same value (it is not
  exposed on the sensor, so the card can't read it automatically)
- the **min/max altitude** filters — these decide which aircraft ever reach
  the card (helicopters fly low: keep min altitude at 0 to see them)

## Installation

### HACS (recommended)

Until the card is in the HACS default store, add it as a custom repository:

1. HACS → ⋮ (top right) → **Custom repositories**
2. Repository: `https://github.com/Ehrenholm/flightradar-radar-card`,
   type: **Dashboard** → Add
3. Search for **Flightradar Radar Card** in HACS and install it
4. HACS registers the dashboard resource automatically — just reload your
   browser when prompted

Updates then appear in HACS like any other card, with correct cache-busting
(no manual version juggling).

### Manual

1. Download `flightradar-radar-card.js` from the
   [latest release](https://github.com/Ehrenholm/flightradar-radar-card/releases/latest)
   and copy it to your Home Assistant `config/www/` folder.
2. Settings → Dashboards → ⋮ → Resources → Add resource:
   - URL: `/local/flightradar-radar-card.js?v=1` — bump the `?v=` number on
     every update to defeat caches (the running version is shown in the
     map's bottom-right corner)
   - Type: **JavaScript module**
3. On tablets running the companion app, use Settings → Companion app →
   Troubleshooting → *Reset frontend cache* after updating if the version
   in the corner looks stale.

## Add the card

It appears in the card picker as "Flightradar Radar Card" with a full visual
editor, or via YAML:

```yaml
type: custom:flightradar-radar-card
entity: sensor.flightradar24_current_in_area
radius_km: 10          # match the radius configured in the FR24 integration
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` | — (required) | FR24 "current in area" sensor |
| `radius_km` | `40` | Scope range; match your FR24 integration radius (not readable from the sensor) |
| `latitude` / `longitude` | HA home | Scope center |
| `site_label` | HA location name | Top-left readout text |
| `contacts_position` | `right` | `right` \| `left` \| `bottom` \| `none` |
| `theme` | `green` | `green` \| `amber` \| `blue` |
| `map_brightness` | `0.55` | 0–1.5, higher = more visible basemap |
| `sweep_period` | `4` | Seconds per sweep revolution (blip decay follows) |
| `trail_length` | `7` | Past positions kept per aircraft (≈ scan interval × N of history) |
| `trail_style` | `line` | `line` \| `dots` (phosphor afterglow dots) |
| `smooth_motion` | `true` | Dead-reckon blips between sensor updates |
| `linger_time` | `45` | Seconds a dropped contact coasts (dimmed) before removal |
| `max_diameter` | `0` | Pixel cap on scope size (0 = fill the column) |
| `fit_height` | `true` | Also cap the scope to the screen height |
| `height_offset` | `150` | Pixels reserved for the HA header when fitting height (≈40 in kiosk mode) |
| `show_details` | `true` | Airline/model/registration/route rows in contacts |
| `show_photo` | `true` | Aircraft photo for the selected contact |
| `show_ring_labels` | `true` | Kilometre labels on the range rings |
| `startup_animation` | `true` | Scope warm-up fade on load |
| `alert_distance_km` | `0` | Pulse blips closer than this (0 = off) |
| `sound_alerts` | `none` | `none` \| `new_contact` \| `proximity` \| `all` — synthesized pings; the speaker toggle on the scope is hidden when `none` |
| `debug` | `false` | On-screen viewport/size diagnostics |

## Examples

Minimal:

```yaml
type: custom:flightradar-radar-card
entity: sensor.flightradar24_current_in_area
radius_km: 10
```

Wall display (landscape panel view, kiosk mode, helicopter watching):

```yaml
type: custom:flightradar-radar-card
entity: sensor.flightradar24_current_in_area
radius_km: 10
contacts_position: left
map_brightness: 0.85
trail_style: dots
trail_length: 60          # ≈10 min of history at a 10 s scan interval
alert_distance_km: 3
height_offset: 40         # no HA header in kiosk mode
```

Amber CRT look:

```yaml
type: custom:flightradar-radar-card
entity: sensor.flightradar24_current_in_area
radius_km: 40
theme: amber
sweep_period: 6
```

## FAQ

**A flight I can see on flightradar24.com doesn't show up.**
The card can only draw what the integration delivers. Check Developer tools →
States → your sensor's `flights` attribute. If the aircraft isn't there, it
was filtered by the integration's radius or min/max altitude options — or it
is one of the aircraft blocked from FR24's public data feed. Remember the
FR24 website shows a much larger area than your configured radius.

**A helicopter/aircraft shows without a callsign.**
Privacy-blocked aircraft carry no identity in the FR24 feed. The card labels
them by type (e.g. `H145`) like the FR24 site does, and keeps a stable
anonymous track for them.

**The card looks outdated after an update.**
Compare the version in the map's bottom-right corner with the release you
installed. With manual installs, bump the `?v=` number on the resource URL;
on the companion app also use *Reset frontend cache*. HACS installs handle
this automatically.

**The scope is cut off at the bottom on my wall tablet.**
`fit_height` (on by default) caps the scope to the screen height minus
`height_offset`. If there's still clipping or a large gap, tune
`height_offset` — and set `debug: true` to see the measured sizes on screen.

**How long is the trail?**
`trail_length` × the integration's scan interval. One position is recorded
per sensor update, starting when the aircraft enters your tracked area.

**Blips jump between positions.**
That's the sensor's update rhythm. Leave `smooth_motion: true` (default) to
glide blips along their track between updates.

**Sound alerts don't play.**
Browsers block audio until you've interacted with the page. Set
`sound_alerts` in the config, then tap the speaker icon on the scope once to
arm it (the setting is remembered, but each page load needs one tap anywhere
on the card). On dedicated wall tablets, Fully Kiosk Browser has an
"Autoplay audio" setting that removes the tap requirement entirely.

## Support

If you enjoy the card, you can support development on
[Ko-fi](https://ko-fi.com/ehrenholm) ☕

## Contribute

Issues and pull requests are welcome — especially additional helicopter type
codes for the glyph detection, theme ideas, and FAQ additions.

## Credits

- [AlexandrErohin/home-assistant-flightradar24](https://github.com/AlexandrErohin/home-assistant-flightradar24)
  — the integration providing the flight data
- [Leaflet](https://leafletjs.com/) — map rendering
- [CARTO](https://carto.com/) dark basemap tiles ·
  [OpenStreetMap](https://www.openstreetmap.org/) contributors — map data
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — the scope typeface
- [fratsloos/fr24_card](https://github.com/fratsloos/fr24_card) — a great
  table-style FR24 card that inspired parts of this README
