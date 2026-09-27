#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Workbook, Topic, Zipper } = require('xmind');

const INPUT_FORMAT = 'clue-workbench-xmind';
const INPUT_VERSION = 1;

function fail(message) {
  process.stderr.write(`XMind 生成失败：${message}\n`);
  process.exitCode = 1;
}

function plainTitle(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} 必须为字符串`);
  const title = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>&=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || title === 'undefined' || title === 'null') throw new Error(`${name} 不能为空`);
  return title;
}

const ENTITY_COLORS = {
  subject: '#DCEAF0', qq: '#E9E4F6', wechat: '#E3F1E9', phone: '#F7ECD9', ip: '#F8E3E1',
  group: '#F4E3EB', location: '#DDF1F2', datacenter: '#EFE6DD', device: '#E8E9EA', platform: '#E2E9F5',
  organization: '#EEE7DC', custom: '#ECEEF1'
};

function nodeStyle(node, depth) {
  if (node.id.startsWith('relation_')) return { 'svg:fill': '#F5F6F5', 'fo:color': '#66757A', 'fo:font-size': '9pt', 'line-color': '#BAC6C7', 'line-width': '1pt' };
  if (node.id.startsWith('reference_') || node.id.startsWith('cycle_reference_')) return { 'svg:fill': '#FAFAF8', 'fo:color': '#879194', 'fo:font-size': '9pt' };
  if (node.id === 'unconnected_objects') return { 'svg:fill': '#F3EEE5', 'fo:color': '#735B37', 'fo:font-weight': '600' };
  const match = /^entity_/.test(node.id) && node.title.match(/^([^·]+)\s*·/);
  const kindByTitle = { '主体簇':'subject','QQ号':'qq','微信号':'wechat','手机号':'phone','IP':'ip','群聊':'group','活跃位置':'location','机房信息':'datacenter','设备':'device','平台账号':'platform','个人/团伙':'organization','团伙/组织':'organization','自定义对象':'custom' };
  const kind = match ? kindByTitle[match[1].trim()] : node.id.startsWith('entity_') && node.title.startsWith('主体簇') ? 'subject' : undefined;
  return kind ? { 'svg:fill': ENTITY_COLORS[kind], 'fo:color': '#26383D', 'fo:font-size': depth <= 1 ? '12pt' : '10pt', 'fo:font-weight': depth <= 1 ? '600' : '500', 'border-line-color': '#9FB2B5', 'border-line-width': '1pt' } : {};
}

function validateNode(value, path, ids) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} 必须为对象`);
  const keys = Object.keys(value);
  if (keys.some((key) => !['id', 'title', 'note', 'children'].includes(key))) throw new Error(`${path} 含未定义字段`);
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.id) || ids.has(value.id)) throw new Error(`${path}.id 无效或重复`);
  ids.add(value.id);
  const node = { id: value.id, title: plainTitle(value.title, `${path}.title`), children: [] };
  if (value.note !== undefined) {
    if (typeof value.note !== 'string') throw new Error(`${path}.note 必须为字符串`);
    node.note = value.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  }
  if (!Array.isArray(value.children)) throw new Error(`${path}.children 必须为数组`);
  node.children = value.children.map((child, index) => validateNode(child, `${path}.children[${index}]`, ids));
  return node;
}

function validateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('输入必须为对象');
  const keys = Object.keys(value);
  if (keys.some((key) => !['format', 'version', 'case', 'branches'].includes(key))) throw new Error('输入含未定义字段');
  if (value.format !== INPUT_FORMAT || value.version !== INPUT_VERSION) throw new Error('不支持的 XMind 输入契约版本');
  if (!value.case || typeof value.case !== 'object' || Array.isArray(value.case) || Object.keys(value.case).some((key) => key !== 'title')) throw new Error('case 必须仅包含 title');
  if (!Array.isArray(value.branches)) throw new Error('branches 必须为数组');
  const ids = new Set();
  return { title: plainTitle(value.case.title, 'case.title'), branches: value.branches.map((node, index) => validateNode(node, `branches[${index}]`, ids)) };
}

function createTopic(topic, sheet, parentId, node, depth = 1) {
  topic.on(parentId).add({ title: node.title, customId: node.id });
  const id = topic.cid();
  if (!id) throw new Error(`无法创建主题：${node.id}`);
  const model = sheet.findComponentById(id);
  for (const [key, value] of Object.entries(nodeStyle(node, depth))) model.changeStyle(key, value);
  if (node.note) topic.on(id).note(node.note);
  for (const child of node.children) createTopic(topic, sheet, id, child, depth + 1);
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('用法：export-xmind.cjs <input.json> <output.xmind>');
  const input = validateInput(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  const destination = path.resolve(outputPath);
  const outputDir = path.dirname(destination);
  fs.mkdirSync(outputDir, { recursive: true });

  const workbook = new Workbook();
  const sheet = workbook.createSheet(input.title, input.title);
  const topic = new Topic({ sheet });
  const rootId = topic.rootTopicId;
  const rootModel = sheet.getRootTopic();
  rootModel.changeStyle('svg:fill', '#285F70');
  rootModel.changeStyle('fo:color', '#FFFFFF');
  rootModel.changeStyle('fo:font-size', '16pt');
  rootModel.changeStyle('fo:font-weight', '700');
  rootModel.changeStyle('structure-class', 'org.xmind.ui.logic.right');
  for (const branch of input.branches) createTopic(topic, sheet, rootId, branch);
  const validation = workbook.validate();
  if (!validation.status) throw new Error(`官方 SDK 校验失败：${JSON.stringify(validation.errors)}`);

  const filename = path.basename(destination, '.xmind');
  const zipper = new Zipper({ path: outputDir, workbook, filename });
  const saved = await zipper.save();
  const generated = path.join(outputDir, `${filename}.xmind`);
  if (!saved || !fs.existsSync(generated) || fs.statSync(generated).size === 0) throw new Error('官方 SDK 未生成有效文件');
  if (generated !== destination) fs.renameSync(generated, destination);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
