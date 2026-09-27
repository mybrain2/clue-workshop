import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceModules = join(root, 'node_modules');
const resourceRoot = join(root, 'src-tauri', 'resources', 'xmind');
const targetModules = join(resourceRoot, 'node_modules');
const copied = new Set();

function packagePath(name, modules = sourceModules) {
  return join(modules, ...name.split('/'));
}

function copyPackage(name) {
  if (copied.has(name)) return;
  const source = packagePath(name);
  if (!existsSync(source)) throw new Error(`缺少 XMind 运行时依赖：${name}`);
  copied.add(name);
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies || {})) copyPackage(dependency);
  cpSync(source, packagePath(name, targetModules), { recursive: true, force: true });
}

mkdirSync(targetModules, { recursive: true });
copyPackage('xmind');
// Windows 上 Node 可执行文件名必须是 node.exe（Rust 侧 xmind_sidecar_dir 按平台查找）
const nodeTarget = process.platform === 'win32' ? 'node.exe' : 'node';
cpSync(process.execPath, join(resourceRoot, nodeTarget), { force: true });
writeFileSync(join(resourceRoot, 'package.json'), '{"private":true,"type":"commonjs"}\n');
console.log(`已准备 XMind 官方 SDK sidecar（${copied.size} 个包，node → ${nodeTarget}）`);
