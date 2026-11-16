// The dusk palette for Harbour Line. One frozen table that every mesh,
// light and HUD element draws from, so the mood holds together: a cold
// blue sky, a low orange sun, warm sodium lamps, wet concrete and rusted
// steel. Teams are told apart by accent alone — Vanguard reads teal,
// Ember reads orange — and the HUD reuses the same inks. Freezing the
// table means no module can drift a colour by accident.
export const DUSK = Object.freeze({
  // Sky and air.
  sky: 0x2b3550,
  haze: 0x232a38,
  sun: 0xd98a4b,
  // Ground and steel.
  concrete: 0x4b515a,
  concreteDark: 0x3a4048,
  metal: 0x5f6d7c,
  metalDark: 0x46525e,
  rust: 0xa06b3e,
  rustBright: 0xc07f45,
  // Team accents.
  vanguard: 0x2fa8a0,
  vanguardDark: 0x1d6f6a,
  ember: 0xe05a2a,
  emberDark: 0x8f3413,
  // Light and ink.
  bulb: 0xffb347,
  paper: 0xf2ede3,
  grey: 0x9aa3ad,
  gold: 0xffb347,
  red: 0xe5484d,
  green: 0x7fd08a,
  ice: 0x8fb8d8,
});
