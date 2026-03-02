/**
 * Data loading and directory-comparison helpers for the folder-compare view.
 */

import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import { ITextDiff, DiffType, DiffSelection, DiffSelectionType } from '../../models/diff'
import {
  DiffHunk,
  DiffHunkHeader,
  DiffHunkExpansionType,
} from '../../models/diff/raw-diff'
import { DiffLine, DiffLineType } from '../../models/diff/diff-line'
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
 * Load `diff_components.json` and `diff_nodes.json` from the given
 * `diffmagicFolder` directory.  Falls back to the fixed path relative to the
 * webpack bundle when no folder is provided.
 */
export async function loadDiffComponents(
  diffmagicFolder?: string
): Promise<DiffComponentsResult> {
  let diffComponents: any[] = []
  let diffNodes: any[] = []

  const baseDir = diffmagicFolder
    ? diffmagicFolder
    : Path.resolve(__dirname, '../../../../../difftastic/Files')

  try {
    const diffComponentsPath = Path.join(baseDir, 'diff_components.json')
    const content = await FSPromises.readFile(diffComponentsPath, 'utf-8')
    const data = JSON.parse(content)
    if (data.diff_components && Array.isArray(data.diff_components)) {
      diffComponents = data.diff_components
    }
  } catch (error) {
    console.log('No diff_components.json found or error loading it:', error)
  }

  try {
    const diffNodesPath = Path.join(baseDir, 'diff_nodes.json')
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
// Precomputed diff loading
// ---------------------------------------------------------------------------

/** DiffLineType string ↔ enum mapping for JSON deserialization. */
const lineTypeFromString: Record<string, DiffLineType> = {
  Context: DiffLineType.Context,
  Add: DiffLineType.Add,
  Delete: DiffLineType.Delete,
  Hunk: DiffLineType.Hunk,
}

/**
 * Try to load `precomputed_diffs.json` from *diffmagicFolder* and return
 * a ready-to-use map of file id → ITextDiff.  Returns `null` if the file
 * doesn't exist or can't be parsed.
 */
export async function loadPrecomputedDiffs(
  diffmagicFolder: string
): Promise<Map<string, ITextDiff | null> | null> {
  const filePath = Path.join(diffmagicFolder, 'precomputed_diffs.json')
  try {
    const raw = await FSPromises.readFile(filePath, 'utf-8')
    const data: Record<string, any> = JSON.parse(raw)
    const result = new Map<string, ITextDiff | null>()

    for (const [fileId, entry] of Object.entries(data)) {
      if (entry === null) {
        result.set(fileId, null)
        continue
      }

      const hunks: DiffHunk[] = (entry.hunks ?? []).map((h: any) => {
        const header = new DiffHunkHeader(
          h.header.oldStartLine,
          h.header.oldLineCount,
          h.header.newStartLine,
          h.header.newLineCount
        )

        const lines: DiffLine[] = (h.lines ?? []).map(
          (l: any) =>
            new DiffLine(
              l.text,
              lineTypeFromString[l.type] ?? DiffLineType.Context,
              l.originalLineNumber ?? null,
              l.oldLineNumber ?? null,
              l.newLineNumber ?? null,
              l.noTrailingNewLine ?? false
            )
        )

        const expansionType =
          (h.expansionType as DiffHunkExpansionType) ??
          DiffHunkExpansionType.None

        return new DiffHunk(
          header,
          lines,
          h.unifiedDiffStart ?? 0,
          h.unifiedDiffEnd ?? 0,
          expansionType
        )
      })

      const textDiff: ITextDiff = {
        kind: DiffType.Text,
        text: entry.text ?? '',
        hunks,
        maxLineNumber: entry.maxLineNumber ?? 0,
        hasHiddenBidiChars: entry.hasHiddenBidiChars ?? false,
      }

      result.set(fileId, textDiff)
    }

    console.log(
      `Loaded ${result.size} precomputed diff(s) from ${filePath}`
    )
    return result
  } catch {
    // File doesn't exist or is invalid – fall through to on-the-fly computation.
    return null
  }
}

// ---------------------------------------------------------------------------
// Diff loading
// ---------------------------------------------------------------------------

/**
 * Load diffs for all files in parallel (up to `concurrency` at a time),
 * calling `onProgress` in batches so the UI updates incrementally without
 * triggering a React re-render for every single file.
 */
export async function loadAllDiffs(
  beforeFolder: string,
  afterFolder: string,
  files: ReadonlyArray<WorkingDirectoryFileChange>,
  onProgress: (diffs: Map<string, ITextDiff | null>) => void,
  concurrency: number = 10
): Promise<Map<string, ITextDiff | null>> {
  const newDiffs = new Map<string, ITextDiff | null>()

  // Throttle onProgress so we emit at most once per animation frame.
  let progressDirty = false
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null

  function scheduleProgress() {
    progressDirty = true
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (progressDirty) {
          progressDirty = false
          onProgress(new Map(newDiffs))
        }
      })
    }
  }

  let index = 0

  async function worker() {
    while (index < files.length) {
      const i = index++
      const file = files[i]
      try {
        const diff = await computeDiff(beforeFolder, afterFolder, file)
        newDiffs.set(file.id, diff)
      } catch (error) {
        console.error(`Error loading diff for ${file.path}:`, error)
        newDiffs.set(file.id, null)
      }
      scheduleProgress()
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => worker()
  )
  await Promise.all(workers)

  // Final flush to make sure the last batch is emitted.
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
  }
  onProgress(new Map(newDiffs))

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

  // Build a lookup map for afterFiles so the modified-file check is O(1).
  const afterFileMap = new Map<string, FileEntry>()
  for (const af of afterFiles) {
    afterFileMap.set(af.relativePath, af)
  }

  // Check for modified files in parallel.
  const commonFiles = beforeFiles.filter(bf => afterFileSet.has(bf.relativePath))
  const modifiedResults = await Promise.all(
    commonFiles.map(async bf => {
      const af = afterFileMap.get(bf.relativePath)!
      const [beforeContent, afterContent] = await Promise.all([
        FSPromises.readFile(bf.fullPath, 'utf-8').catch(() => null),
        FSPromises.readFile(af.fullPath, 'utf-8').catch(() => null),
      ])
      if (beforeContent !== null && afterContent !== null && beforeContent !== afterContent) {
        return bf.relativePath
      }
      return null
    })
  )

  for (const relPath of modifiedResults) {
    if (relPath !== null) {
      changes.push(createFileChange(relPath, AppFileStatusKind.Modified))
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
