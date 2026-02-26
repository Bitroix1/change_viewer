/**
 * Data loading and directory-comparison helpers for the folder-compare view.
 */

import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { ITextDiff, DiffSelection, DiffSelectionType } from '../../models/diff'
import { computeDiff } from './diff-generator'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffComponentsResult {
  diffComponents: any[]
  diffNodes: any[]
}

export interface FileEntry {
  fullPath: string
  relativePath: string
}

// ---------------------------------------------------------------------------
// diff_components.json / diff_nodes.json
// ---------------------------------------------------------------------------

/**
 * Load `diff_components.json` and `diff_nodes.json` from the fixed paths
 * relative to the webpack bundle.
 */
export async function loadDiffComponents(): Promise<DiffComponentsResult> {
  let diffComponents: any[] = []
  let diffNodes: any[] = []

  try {
    const diffComponentsPath = Path.resolve(
      __dirname,
      '../../../../../difftastic/Files/diff_components.json'
    )
    const content = await FSPromises.readFile(diffComponentsPath, 'utf-8')
    const data = JSON.parse(content)
    if (data.diff_components && Array.isArray(data.diff_components)) {
      diffComponents = data.diff_components
    }
  } catch (error) {
    console.log('No diff_components.json found or error loading it:', error)
  }

  try {
    const diffNodesPath = Path.resolve(
      __dirname,
      '../../../../../difftastic/Files/diff_nodes.json'
    )
    const nodesContent = await FSPromises.readFile(diffNodesPath, 'utf-8')
    const nodesData = JSON.parse(nodesContent)
    if (nodesData.diff_components && Array.isArray(nodesData.diff_components)) {
      diffNodes = nodesData.diff_components
    }
  } catch (error) {
    console.log('No diff_nodes.json found or error loading it:', error)
  }

  return { diffComponents, diffNodes }
}

// ---------------------------------------------------------------------------
// Diff loading
// ---------------------------------------------------------------------------

/**
 * Load diffs for all files, calling `onProgress` after each file so the UI
 * updates incrementally.
 */
export async function loadAllDiffs(
  beforeFolder: string,
  afterFolder: string,
  files: ReadonlyArray<WorkingDirectoryFileChange>,
  onProgress: (diffs: Map<string, ITextDiff | null>) => void
): Promise<Map<string, ITextDiff | null>> {
  const newDiffs = new Map<string, ITextDiff | null>()

  for (const file of files) {
    try {
      const diff = await computeDiff(beforeFolder, afterFolder, file)
      newDiffs.set(file.id, diff)
    } catch (error) {
      console.error(`Error loading diff for ${file.path}:`, error)
      newDiffs.set(file.id, null)
    }
    onProgress(new Map(newDiffs))
  }

  return newDiffs
}

// ---------------------------------------------------------------------------
// Directory comparison
// ---------------------------------------------------------------------------

/**
 * Recursively enumerate all files in `directoryPath`, returning paths relative
 * to `basePath` (forward-slash separated).
 */
export async function getAllFilesRecursive(
  directoryPath: string,
  basePath: string = directoryPath
): Promise<FileEntry[]> {
  const results: FileEntry[] = []
  try {
    const entries = await FSPromises.readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = Path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        const subFiles = await getAllFilesRecursive(fullPath, basePath)
        results.push(...subFiles)
      } else if (entry.isFile()) {
        const relativePath = Path.relative(basePath, fullPath).replace(/\\/g, '/')
        results.push({ fullPath, relativePath })
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${directoryPath}:`, error)
  }
  return results
}

/**
 * Compare two directory trees and return a list of `WorkingDirectoryFileChange`
 * objects representing added, deleted, and modified files.
 */
export async function compareDirectories(
  beforePath: string,
  afterPath: string
): Promise<ReadonlyArray<WorkingDirectoryFileChange>> {
  const changes: WorkingDirectoryFileChange[] = []

  const [beforeFiles, afterFiles] = await Promise.all([
    getAllFilesRecursive(beforePath),
    getAllFilesRecursive(afterPath),
  ])

  const afterFileSet = new Set(afterFiles.map(f => f.relativePath))
  const beforeFileSet = new Set(beforeFiles.map(f => f.relativePath))

  for (const bf of beforeFiles) {
    if (!afterFileSet.has(bf.relativePath)) {
      changes.push(createFileChange(bf.relativePath, AppFileStatusKind.Deleted))
    }
  }

  for (const af of afterFiles) {
    if (!beforeFileSet.has(af.relativePath)) {
      changes.push(createFileChange(af.relativePath, AppFileStatusKind.New))
    }
  }

  for (const bf of beforeFiles) {
    if (afterFileSet.has(bf.relativePath)) {
      const af = afterFiles.find(f => f.relativePath === bf.relativePath)!
      const [beforeContent, afterContent] = await Promise.all([
        FSPromises.readFile(bf.fullPath, 'utf-8').catch(() => null),
        FSPromises.readFile(af.fullPath, 'utf-8').catch(() => null),
      ])
      if (beforeContent !== null && afterContent !== null && beforeContent !== afterContent) {
        changes.push(createFileChange(bf.relativePath, AppFileStatusKind.Modified))
      }
    }
  }

  return changes
}

export function createFileChange(
  path: string,
  kind: AppFileStatusKind
): WorkingDirectoryFileChange {
  return new WorkingDirectoryFileChange(
    path,
    { kind } as any,
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

// ---------------------------------------------------------------------------
// Source line content lookup
// ---------------------------------------------------------------------------

/**
 * Look up the trimmed content of a source line from the loaded diff data.
 *
 * `fileName` is a bare name (e.g. "Prog.java"); `fileDiffs` is keyed by
 * file id (e.g. "modified+Prog.java"), so we match by suffix.
 */
export function getSourceLineContent(
  fileName: string,
  lineNum: number,
  side: 'before' | 'after',
  fileDiffs: Map<string, ITextDiff | null>
): string {
  let diff: ITextDiff | null | undefined
  for (const [key, value] of fileDiffs.entries()) {
    if (
      key === fileName ||
      key.endsWith('+' + fileName) ||
      key.endsWith('/' + fileName) ||
      key.endsWith('\\' + fileName)
    ) {
      diff = value
      break
    }
  }
  if (!diff) return ''

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const matchLine = side === 'before' ? line.oldLineNumber : line.newLineNumber
      if (matchLine === lineNum) {
        return line.content.trimEnd()
      }
    }
  }
  return ''
}
