"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFileAtomic = writeFileAtomic;
exports.readJsonFile = readJsonFile;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
async function writeFileAtomic(filePath, contents) {
    await promises_1.default.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const directory = node_path_1.default.dirname(filePath);
    const tempPath = node_path_1.default.join(directory, `.${node_path_1.default.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    await promises_1.default.writeFile(tempPath, contents);
    await promises_1.default.rename(tempPath, filePath);
}
async function readJsonFile(filePath) {
    try {
        const raw = await promises_1.default.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
