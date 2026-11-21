/**
 * 云端控制文件的路径约定。
 *
 * 控制文件（同步元数据 istart-sync-meta.json 与跨设备配置 istart-config.json）
 * 统一存放在 {remotePath}/_istart/ 下，与 git 引擎的 _istart-git/ 同属插件
 * 专属命名空间，避免与用户笔记混在远程根目录。
 *
 * 旧版本曾将控制文件放在 remotePath 根目录；读取时回退到旧路径并尽力迁移。
 *
 * 注意：目录名使用下划线前缀而不是点前缀。百度网盘官方客户端与网页版对
 * `.` 开头的文件/文件夹支持不一致，下划线前缀在 PC 与移动端均稳定。
 */

export const SYNC_DIR = "_istart";
export const META_FILENAME = "istart-sync-meta.json";
export const CONFIG_FILENAME = "istart-config.json";

/** 插件在云端保留的命名空间目录（含旧版备份目录），同步、恢复与冲突处理均跳过 */
export const CONTROL_PATH_PATTERN = /^(?:_istart|_istart-git|_plugin|_obsidian-config)(?:\/|$)/;

const rootOf = (remotePath: string): string => remotePath.replace(/\/+$/, "");
const normalize = (path: string): string => path.replace(/\/+/g, "/");

export const controlDir = (remotePath: string): string => normalize(`${rootOf(remotePath)}/${SYNC_DIR}`);

export const metaRemotePath = (remotePath: string): string => `${controlDir(remotePath)}/${META_FILENAME}`;
export const configRemotePath = (remotePath: string): string => `${controlDir(remotePath)}/${CONFIG_FILENAME}`;

/** 旧版本控制文件位置（remotePath 根目录），仅用于读取与迁移 */
export const legacyMetaRemotePath = (remotePath: string): string => normalize(`${rootOf(remotePath)}/${META_FILENAME}`);
export const legacyConfigRemotePath = (remotePath: string): string => normalize(`${rootOf(remotePath)}/${CONFIG_FILENAME}`);
