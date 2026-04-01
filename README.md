# pi-pimon

A tiny terminal companion for Pi.

## Current features

- `/pimon` command
- Deterministic **bones** for each pimon
  - rarity
  - species
  - shiny chance
  - eyes
  - accessory
  - temperament
  - base stats
- Persistent **soul** stored on hatch
  - name
  - personality
- Small widget below the editor
- XP, levels, mood, and additive stat progression
- Reactive quips based on what you do in Pi
- Global persistence across sessions

## Install

From the project directory:

```bash
pi install ./pi-pimon
```

Or for a one-off test run:

```bash
pi -e ./pi-pimon
```

## Commands

- `/pimon` — hatch your pimon, or open its panel if it already exists
- `/pimon react` — force a fresh quip
- `/pimon pet` — give your pimon a little affection
- `/pimon rename <name>` — rename your pimon
- `/pimon hide` — hide the widget
- `/pimon show` — show the widget again

## Notes

- Identity is split into:
  - **bones**: deterministic rolled traits
  - **soul**: stored name and personality
  - **progress**: stored XP, turns, and stat bonuses
- The companion is UI-local; it does not inject chatter into model context
- This is an early scaffold intended to be expanded with better sprites, cosmetics, and progression
