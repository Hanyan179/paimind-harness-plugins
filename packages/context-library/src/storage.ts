import * as fs from 'node:fs/promises'
import { CONTEXT_FILE_MAX_BYTES } from './contract.js'
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
  read: (root, path, maxBytes = CONTEXT_FILE_MAX_BYTES) =>
    readPaimindManagedBytes(root, path, maxBytes),
  resolve: resolvePaimindManagedFile,
  write: (root, path, bytes, revision, beforeCommit, signal) =>
    writePaimindManagedBytes(root, path, bytes, revision, beforeCommit, signal, CONTEXT_FILE_MAX_BYTES),
}
