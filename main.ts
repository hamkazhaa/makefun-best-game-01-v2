// Harbour Line — submission program for the best-game-01 bounty.
//
// Node 22, standard library only. The playable game is the plain static
// files under game/ next to this file; a browser loads them as ES modules
// and resolves three.js through the import map in game/index.html. This
// program does one thing: it packs the submission folder. It copies game/
// and screenshots/ into the output directory ("/output" in the grader, or
// MAKEFUN_OUTPUT_DIR when run by hand) and writes /output/dossier.json,
// the summary the judge reads, through the vendored make.fun library in
// vendor/makefun-game.ts.
//
// Play the game with `node serve.ts`, then http://localhost:8080.
// Build a submission folder by hand with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyInto(relSource, relTarget) {
  cpSync(join(here, relSource), join(outDir, relTarget), { recursive: true });
}

function main() {
  mkdirSync(outDir, { recursive: true });
  copyInto('game', 'game');
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  if (existsSync(join(here, 'screenshots'))) {
    copyInto('screenshots', 'screenshots');
  }

  // The scorer's caps, from the kit's reference/gate.json. Only
  // text_max_bytes changes the dossier's bytes; the rest refuse an entry
  // the scorer would refuse anyway:
  //   - more than 4 screenshots, or one bigger than 256 KiB;
  //   - more than 993 files under game/, or 48 MiB of game files in all.
  // game/ shares /output's own 1,000-entry ceiling with screenshots/ and
  // dossier.json, so the copy above must leave room for them.
  const limits = {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  };

  const text = buildDossier(outDir, limits);
  writeFileSync(join(outDir, 'dossier.json'), text);

  // Report what was built, so a bad run is obvious before submitting:
  // the dossier's byte size and how many screenshots went in. The run is
  // deterministic: building twice from the same tree writes the same bytes.
  const shots = existsSync(join(outDir, 'screenshots'))
    ? readdirSync(join(outDir, 'screenshots'))
    : [];
  console.error(`Harbour Line dossier: ${text.length} bytes, ${shots.length} screenshots`);
}

main();
