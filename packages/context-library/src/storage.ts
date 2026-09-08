import * as fs from 'node:fs/promises'
import {
  readPaimindManagedBytes,
  resolvePaimindManagedFile,
  writePaimindManagedBytes,
} from '@hansen/harness-compat/managed-files'
/** Storage effects are separate from identity and authorization. Implementations
 * must retain atomic compare-and-swap, traversal rejection and cancellation. */
export interface ContextStorage {
  mkdir: typeof fs.mkdir
  readFile: typeof fs.readFile
  readdir: typeof fs.readdir
  rename: typeof fs.rename
  lstat: typeof fs.lstat
  rm: typeof fs.rm
  read: typeof readPaimindManagedBytes
  resolve: typeof resolvePaimindManagedFile
  write: typeof writePaimindManagedBytes
}
export const localContextStorage: ContextStorage = {
  mkdir: fs.mkdir,
  readFile: fs.readFile,
  readdir: fs.readdir,
  rename: fs.rename,
  lstat: fs.lstat,
  rm: fs.rm,
  read: readPaimindManagedBytes,
  resolve: resolvePaimindManagedFile,
  write: writePaimindManagedBytes,
}
