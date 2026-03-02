import * as Path from 'path'
import * as FSPromises from 'fs/promises'
import { ITextDiff, DiffType } from '../../models/diff'
import { WorkingDirectoryFileChange } from '../../models/status'
import { AppFileStatusKind } from '../../models/status'
import {
  DiffHunk,
  DiffHunkHeader,
  DiffHunkExpansionType,
} from '../../models/diff/raw-diff'
import { DiffLine, DiffLineType } from '../../models/diff/diff-line'
import { HiddenBidiCharsRegex } from '../../lib/diff-parser'

// ---------------------------------------------------------------------------
// In-process unified diff generation (no git subprocess needed)
// ---------------------------------------------------------------------------

/**
 * Compute a diff between two versions of a file in different folders.
 *
 * This implementation runs entirely in-process using a Myers-like diff
 * algorithm, avoiding the ~100 ms+ overhead of spawning a `git diff`
 * process for every file.
 */
export async function computeDiff(
  beforeFolderPath: string,
  afterFolderPath: string,
  file: WorkingDirectoryFileChange
): Promise<ITextDiff | null> {
  const beforeFilePath = Path.join(beforeFolderPath, file.path)
  const afterFilePath = Path.join(afterFolderPath, file.path)

  try {
    let beforeLines: string[] = []
    let afterLines: string[] = []
    let text = ''

    if (file.status.kind === AppFileStatusKind.New) {
      const afterContent = await readFileSafe(afterFilePath)
      if (afterContent === null) return null
      afterLines = splitLines(afterContent)
      text = afterContent
    } else if (file.status.kind === AppFileStatusKind.Deleted) {
      const beforeContent = await readFileSafe(beforeFilePath)
      if (beforeContent === null) return null
      beforeLines = splitLines(beforeContent)
    } else {
      // Modified
      const [bc, ac] = await Promise.all([
        readFileSafe(beforeFilePath),
        readFileSafe(afterFilePath),
      ])
      if (bc === null || ac === null) return null
      beforeLines = splitLines(bc)
      afterLines = splitLines(ac)
      text = ac
    }

    const hunks = buildUnifiedHunks(beforeLines, afterLines, 3)

    let maxLineNumber = 0
    let hasHiddenBidiChars = false

    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.oldLineNumber !== null && line.oldLineNumber > maxLineNumber) {
          maxLineNumber = line.oldLineNumber
        }
        if (line.newLineNumber !== null && line.newLineNumber > maxLineNumber) {
          maxLineNumber = line.newLineNumber
        }
        if (!hasHiddenBidiChars && HiddenBidiCharsRegex.test(line.text)) {
          hasHiddenBidiChars = true
        }
      }
    }

    return {
      kind: DiffType.Text,
      text,
      hunks,
      maxLineNumber,
      hasHiddenBidiChars,
    }
  } catch (error) {
    console.error('Error computing diff:', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await FSPromises.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/** Split content into lines, keeping the same semantics as git diff. */
function splitLines(content: string): string[] {
  const lines = content.split('\n')
  // If the file ends with a newline the last element is '' – remove it.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

// ---------------------------------------------------------------------------
// Myers diff – edit script
// ---------------------------------------------------------------------------

interface Edit {
  type: 'equal' | 'insert' | 'delete'
  oldIdx: number // index in beforeLines (-1 for inserts)
  newIdx: number // index in afterLines  (-1 for deletes)
}

/**
 * Compute the shortest edit script between two line arrays using Myers'
 * O(ND) algorithm.  For very large inputs we fall back to a simpler
 * greedy approach to avoid memory / time blowup.
 */
function myersDiff(a: string[], b: string[]): Edit[] {
  const N = a.length
  const M = b.length

  if (N === 0 && M === 0) return []
  if (N === 0) {
    return b.map((_, j) => ({ type: 'insert' as const, oldIdx: -1, newIdx: j }))
  }
  if (M === 0) {
    return a.map((_, i) => ({ type: 'delete' as const, oldIdx: i, newIdx: -1 }))
  }

  const MAX = N + M
  if (MAX > 20000) {
    return simpleDiff(a, b)
  }

  const vSize = 2 * MAX + 1
  const v = new Int32Array(vSize)
  v.fill(-1)
  const offset = MAX
  const trace: Int32Array[] = []

  outer:
  for (let d = 0; d <= MAX; d++) {
    trace.push(new Int32Array(v))

    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]
      } else {
        x = v[k - 1 + offset] + 1
      }
      let y = x - k

      while (x < N && y < M && a[x] === b[y]) {
        x++
        y++
      }

      v[k + offset] = x

      if (x >= N && y >= M) {
        break outer
      }
    }
  }

  // Backtrace
  const edits: Edit[] = []
  let x = N
  let y = M
  for (let d = trace.length - 1; d > 0; d--) {
    // trace[d] = snapshot of V taken BEFORE the d-th iteration,
    // i.e. V at the END of iteration d-1.  This is the correct
    // "previous V" for backtracing from step d.
    const vPrev = trace[d]
    const k = x - y

    let prevK: number
    if (k === -d || (k !== d && vPrev[k - 1 + offset] < vPrev[k + 1 + offset])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = vPrev[prevK + offset]
    const prevY = prevX - prevK

    while (x > prevX && y > prevY) {
      x--
      y--
      edits.push({ type: 'equal', oldIdx: x, newIdx: y })
    }

    if (d > 0) {
      if (x === prevX) {
        y--
        edits.push({ type: 'insert', oldIdx: -1, newIdx: y })
      } else {
        x--
        edits.push({ type: 'delete', oldIdx: x, newIdx: -1 })
      }
    }
  }

  while (x > 0 && y > 0) {
    x--
    y--
    edits.push({ type: 'equal', oldIdx: x, newIdx: y })
  }

  edits.reverse()
  return edits
}

/** Simple fallback diff for very large inputs. */
function simpleDiff(a: string[], b: string[]): Edit[] {
  const edits: Edit[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      edits.push({ type: 'equal', oldIdx: i, newIdx: j })
      i++
      j++
    } else {
      let foundA = -1
      let foundB = -1
      const lookAhead = Math.min(500, Math.max(a.length - i, b.length - j))

      for (let d = 1; d < lookAhead; d++) {
        if (i + d < a.length && a[i + d] === b[j]) {
          foundA = i + d
          break
        }
        if (j + d < b.length && a[i] === b[j + d]) {
          foundB = j + d
          break
        }
      }

      if (foundA !== -1) {
        while (i < foundA) {
          edits.push({ type: 'delete', oldIdx: i, newIdx: -1 })
          i++
        }
      } else if (foundB !== -1) {
        while (j < foundB) {
          edits.push({ type: 'insert', oldIdx: -1, newIdx: j })
          j++
        }
      } else {
        edits.push({ type: 'delete', oldIdx: i, newIdx: -1 })
        i++
        edits.push({ type: 'insert', oldIdx: -1, newIdx: j })
        j++
      }
    }
  }

  while (i < a.length) {
    edits.push({ type: 'delete', oldIdx: i, newIdx: -1 })
    i++
  }
  while (j < b.length) {
    edits.push({ type: 'insert', oldIdx: -1, newIdx: j })
    j++
  }

  return edits
}

// ---------------------------------------------------------------------------
// Build unified-diff-style DiffHunks from the edit script
// ---------------------------------------------------------------------------

function buildUnifiedHunks(
  beforeLines: string[],
  afterLines: string[],
  contextLines: number
): DiffHunk[] {
  const edits = myersDiff(beforeLines, afterLines)

  if (edits.length === 0) return []
  if (edits.every(e => e.type === 'equal')) return []

  const groups = groupEdits(edits, contextLines)
  const hunks: DiffHunk[] = []
  let patchLineNumber = 1

  for (const group of groups) {
    const lines: DiffLine[] = []
    let oldStart = Infinity
    let newStart = Infinity
    let oldCount = 0
    let newCount = 0

    for (const edit of group) {
      if (edit.type === 'equal') {
        if (edit.oldIdx + 1 < oldStart) oldStart = edit.oldIdx + 1
        if (edit.newIdx + 1 < newStart) newStart = edit.newIdx + 1
        oldCount++
        newCount++
      } else if (edit.type === 'delete') {
        if (edit.oldIdx + 1 < oldStart) oldStart = edit.oldIdx + 1
        oldCount++
      } else {
        if (edit.newIdx + 1 < newStart) newStart = edit.newIdx + 1
        newCount++
      }
    }

    if (oldStart === Infinity) oldStart = oldCount > 0 ? 1 : 0
    if (newStart === Infinity) newStart = newCount > 0 ? 1 : 0

    const header = new DiffHunkHeader(oldStart, oldCount, newStart, newCount)
    const hunkText = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
    lines.push(
      new DiffLine(hunkText, DiffLineType.Hunk, patchLineNumber, null, null)
    )
    patchLineNumber++

    for (const edit of group) {
      if (edit.type === 'equal') {
        lines.push(
          new DiffLine(
            ' ' + beforeLines[edit.oldIdx],
            DiffLineType.Context,
            patchLineNumber,
            edit.oldIdx + 1,
            edit.newIdx + 1
          )
        )
      } else if (edit.type === 'delete') {
        lines.push(
          new DiffLine(
            '-' + beforeLines[edit.oldIdx],
            DiffLineType.Delete,
            patchLineNumber,
            edit.oldIdx + 1,
            null
          )
        )
      } else {
        lines.push(
          new DiffLine(
            '+' + afterLines[edit.newIdx],
            DiffLineType.Add,
            patchLineNumber,
            null,
            edit.newIdx + 1
          )
        )
      }
      patchLineNumber++
    }

    const unifiedDiffStart = lines[0].originalLineNumber ?? 0
    const unifiedDiffEnd = lines[lines.length - 1].originalLineNumber ?? 0

    hunks.push(
      new DiffHunk(
        header,
        lines,
        unifiedDiffStart,
        unifiedDiffEnd,
        DiffHunkExpansionType.None
      )
    )
  }

  return hunks
}

/**
 * Group edits into hunk-sized chunks.  Consecutive changes separated by
 * fewer than 2 * contextLines equal lines are merged.  Each group is
 * padded with up to contextLines equal lines at both ends.
 */
function groupEdits(edits: Edit[], contextLines: number): Edit[][] {
  const changeIndices: number[] = []
  for (let i = 0; i < edits.length; i++) {
    if (edits[i].type !== 'equal') {
      changeIndices.push(i)
    }
  }

  if (changeIndices.length === 0) return []

  const ranges: Array<{ start: number; end: number }> = []
  let rStart = changeIndices[0]
  let rEnd = changeIndices[0]
  for (let ci = 1; ci < changeIndices.length; ci++) {
    if (changeIndices[ci] === rEnd + 1) {
      rEnd = changeIndices[ci]
    } else {
      ranges.push({ start: rStart, end: rEnd })
      rStart = changeIndices[ci]
      rEnd = changeIndices[ci]
    }
  }
  ranges.push({ start: rStart, end: rEnd })

  const mergedRanges: Array<{ start: number; end: number }> = [ranges[0]]
  for (let ri = 1; ri < ranges.length; ri++) {
    const prev = mergedRanges[mergedRanges.length - 1]
    const gap = ranges[ri].start - prev.end - 1
    if (gap <= 2 * contextLines) {
      prev.end = ranges[ri].end
    } else {
      mergedRanges.push({ ...ranges[ri] })
    }
  }

  const groups: Edit[][] = []
  for (const range of mergedRanges) {
    const ctxStart = Math.max(0, range.start - contextLines)
    const ctxEnd = Math.min(edits.length - 1, range.end + contextLines)
    groups.push(edits.slice(ctxStart, ctxEnd + 1))
  }

  return groups
}
