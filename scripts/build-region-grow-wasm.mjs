import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const output = resolve(rootDir, 'src/algorithms/regionGrow/generated/regionGrowWasm.js');

mkdirSync(dirname(output), { recursive: true });

const args = [
  resolve(rootDir, 'native/region-grow/src/region_grow.cpp'),
  resolve(rootDir, 'native/region-grow/src/region_grow_wasm.cpp'),
  '-I',
  resolve(rootDir, 'native/region-grow/include'),
  '-std=c++17',
  '-O3',
  '-s',
  'MODULARIZE=1',
  '-s',
  'EXPORT_ES6=1',
  '-s',
  'SINGLE_FILE=1',
  '-s',
  'ENVIRONMENT=web,worker',
  '-s',
  'ALLOW_MEMORY_GROWTH=1',
  '-s',
  "EXPORTED_FUNCTIONS=['_malloc','_free','_rg_run_reassign_slice_region_grow_2d']",
  '-s',
  "EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU16','HEAP32','HEAPF32']",
  '-o',
  output,
];

let result = spawnSync('emcc', args, {
  cwd: rootDir,
  stdio: 'inherit',
});

if (result.error?.code === 'ENOENT' && process.platform === 'win32') {
  result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'emcc.bat', ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
