import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { unzip } from 'react-native-zip-archive';

// Device file access for documents: download into the app's Documents folder, check,
// list, delete, unzip, and hand a file to iOS QuickLook (which previews PDFs, Word,
// Excel and images, and has its own share button).
//
// Paths are stored RELATIVE to Documents (see documents.ts): iOS can move the app's
// container between updates, which made every saved file look missing in BM Pro.

const fs = ReactNativeBlobUtil.fs;

export const files = {
  /** Absolute path for a path relative to the app's Documents folder. */
  abs(rel: string) {
    return `${fs.dirs.DocumentDir}/${rel.replace(/^\/+/, '')}`;
  },

  async ensureDir(absDir: string) {
    if (!(await fs.exists(absDir))) await fs.mkdir(absDir);
  },

  /** Downloads `url` to `absPath`; rejects on a non-2xx answer. Returns the byte size. */
  async download(url: string, absPath: string): Promise<number> {
    const dir = absPath.slice(0, absPath.lastIndexOf('/'));
    await files.ensureDir(dir);
    const res = await ReactNativeBlobUtil.config({ path: absPath }).fetch(
      'GET',
      url,
    );
    const status = res.info().status;
    if (status < 200 || status >= 300) {
      await fs.unlink(absPath).catch(() => {});
      throw new Error(`Download failed (HTTP ${status}).`);
    }
    return files.size(absPath);
  },

  exists: (absPath: string) => fs.exists(absPath),

  async size(absPath: string): Promise<number> {
    try {
      const st = await fs.stat(absPath);
      return Number(st.size) || 0;
    } catch {
      return 0;
    }
  },

  /** Deletes a file or a whole folder. */
  async remove(absPath: string) {
    if (await fs.exists(absPath)) await fs.unlink(absPath);
  },

  /** Copies a file, creating the destination folder. `src` may be a file:// uri. */
  async copy(src: string, destAbs: string) {
    const dir = destAbs.slice(0, destAbs.lastIndexOf('/'));
    await files.ensureDir(dir);
    if (await fs.exists(destAbs)) await fs.unlink(destAbs);
    await fs.cp(decodeURI(src.replace(/^file:\/\//, '')), destAbs);
  },

  /** Every file under `absDir`, with paths relative to it ("folder/file.pdf"). */
  async walk(
    absDir: string,
    prefix = '',
  ): Promise<{ name: string; path: string; size: number }[]> {
    if (!(await fs.exists(absDir))) return [];
    const out: { name: string; path: string; size: number }[] = [];
    for (const entry of await fs.ls(absDir)) {
      if (entry.startsWith('.') || entry === '__MACOSX') continue;
      const p = `${absDir}/${entry}`;
      const label = prefix ? `${prefix}/${entry}` : entry;
      if (await fs.isDir(p)) out.push(...(await files.walk(p, label)));
      else out.push({ name: label, path: p, size: await files.size(p) });
    }
    return out;
  },

  async unzip(zipAbs: string, destAbs: string) {
    await files.ensureDir(destAbs);
    await unzip(zipAbs, destAbs);
  },

  async writeText(absPath: string, text: string) {
    const dir = absPath.slice(0, absPath.lastIndexOf('/'));
    await files.ensureDir(dir);
    await fs.writeFile(absPath, text, 'utf8');
  },

  /** QuickLook preview (iOS), with share / open-in from its toolbar. */
  async open(absPath: string) {
    if (Platform.OS === 'ios')
      await ReactNativeBlobUtil.ios.openDocument(absPath);
    else await ReactNativeBlobUtil.android.actionViewIntent(absPath, '*/*');
  },

  /** The iOS "share / open in" sheet for a file (CSV export). */
  share(absPath: string) {
    if (Platform.OS === 'ios')
      ReactNativeBlobUtil.ios.presentOptionsMenu(absPath);
    else ReactNativeBlobUtil.android.actionViewIntent(absPath, 'text/csv');
  },
};
